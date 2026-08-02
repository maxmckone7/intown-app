import type { CalendarStatus } from './types';

/**
 * Out-of-town inference (PRA-9).
 *
 * Translates supported Google Calendar signals into a deterministic in/out
 * status per calendar date. This module is intentionally pure and free of any
 * I/O or SDK dependency so the rules are unit-testable with representative event
 * scenarios (see `outOfTown.test.ts`) and reusable from whatever sync/trigger
 * layer eventually drives it.
 *
 * The supported/ignored signals and conflict precedence encoded here follow the
 * product decision in PRA-6 ("Define supported out-of-town calendar signals").
 * PRA-6 was not yet finalized when this was written, so the specific keyword
 * lists and precedence below are documented in `docs/out-of-town-inference.md`
 * and deliberately isolated as tunable constants — adjusting the decision should
 * mean editing the lists/precedence, not the algorithm.
 *
 * Design guarantees that map directly to the PRA-9 acceptance criteria:
 *   - Deterministic: the same events always yield the same result, independent
 *     of input order, wall clock, or local timezone (all date math is UTC).
 *   - Conservative: an event only ever produces a change when it matches an
 *     explicitly supported signal. Ambiguous or unsupported events yield NO
 *     inference for their dates, so they can never cause an unintended status
 *     change (a date absent from the result is left exactly as-is by the caller).
 */

// ---------------------------------------------------------------------------
// Normalized event model
// ---------------------------------------------------------------------------

/**
 * Google Calendar `event.eventType` values we care about. Unknown/other values
 * are fine — they simply fall through to keyword classification.
 */
export type CalendarEventType =
  | 'default'
  | 'outOfOffice'
  | 'workingLocation'
  | 'focusTime'
  | 'birthday'
  | 'fromGmail';

/** The connected user's own RSVP to an event. */
export type EventResponseStatus = 'accepted' | 'tentative' | 'declined' | 'needsAction';

/**
 * A provider-agnostic calendar event. The sync layer maps raw Google events into
 * this shape (see `normalizeGoogleEvent`); the inference rules only ever see
 * this, which keeps them decoupled from the `googleapis` types and trivial to
 * construct in tests.
 */
export interface NormalizedCalendarEvent {
  id: string;
  /** Event title / summary. May be empty. */
  summary: string;
  eventType: CalendarEventType;
  /** True for all-day / multi-day date events (Google `start.date`). */
  isAllDay: boolean;
  /**
   * All-day: 'YYYY-MM-DD' start date (inclusive).
   * Timed: ISO datetime string. Only all-day events drive inference, so the
   * exact timed format is unused beyond being carried through.
   */
  start: string;
  /**
   * All-day: 'YYYY-MM-DD' end date, EXCLUSIVE — this is Google's semantics, e.g.
   * a single-day all-day event on the 1st has end '...-02'. Timed: ISO datetime.
   */
  end: string;
  /** Overall event status. 'cancelled' events are ignored. Defaults to confirmed. */
  status?: 'confirmed' | 'tentative' | 'cancelled';
  /** The connected user's RSVP. 'declined' events are ignored. */
  responseStatus?: EventResponseStatus;
}

// ---------------------------------------------------------------------------
// Signal decision (PRA-6) — tunable constants
// ---------------------------------------------------------------------------

/**
 * Title keywords/phrases that, on an all-day event, count as evidence the user
 * is OUT of town. Matched case-insensitively on word boundaries so "trip" does
 * not fire on "triple". Kept conservative and travel-specific to avoid false
 * positives; extend here as PRA-6 evolves.
 */
export const OUT_OF_TOWN_KEYWORDS: readonly string[] = [
  'out of town',
  'out of office',
  'ooo',
  'vacation',
  'vacay',
  'holiday',
  'pto',
  'on leave',
  'annual leave',
  'travel',
  'traveling',
  'travelling',
  'trip',
  'flight',
  'away',
  'honeymoon',
  'cruise',
  'retreat',
  'offsite',
  'off-site',
];

/**
 * Title keywords/phrases that, on an all-day event, count as an explicit IN-town
 * signal. These exist mainly to let a user correct an over-broad away block
 * (e.g. a mid-vacation day at home) — see conflict precedence below.
 */
export const IN_TOWN_KEYWORDS: readonly string[] = [
  'in town',
  'back in town',
  'back home',
  'staycation',
];

// ---------------------------------------------------------------------------
// Per-event classification
// ---------------------------------------------------------------------------

export type SignalKind = 'out_of_town' | 'in_town' | 'ignored';

export interface EventSignal {
  kind: SignalKind;
  /** Human-readable rationale, surfaced for observability/debugging. */
  reason: string;
}

/** Build a case-insensitive, word-boundary matcher for a keyword/phrase. */
function keywordRegex(keyword: string): RegExp {
  // Escape regex metacharacters (e.g. the '-' in "off-site") and require a word
  // boundary on both sides so keywords match whole words/phrases only.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

const OUT_OF_TOWN_RE = OUT_OF_TOWN_KEYWORDS.map(keywordRegex);
const IN_TOWN_RE = IN_TOWN_KEYWORDS.map(keywordRegex);

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * Classify a single event into an in/out/ignored signal per the PRA-6 decision.
 *
 * Order matters and encodes the documented rules:
 *   1. Cancelled events and events the user declined are never evidence.
 *   2. Only all-day / day-level events are considered. A timed event (an hour
 *      long meeting titled "Flight to NYC", a 2-hour focus block) is treated as
 *      ambiguous and ignored — it is not day-level evidence of being out of town.
 *   3. An explicit in-town keyword wins over out-of-town keywords ON THE SAME
 *      EVENT, so "Back in town (working)" is an in-town signal.
 *   4. Google's native all-day out-of-office events are out-of-town evidence.
 *   5. Otherwise, out-of-town keywords make it out-of-town evidence.
 *   6. Anything else (an all-day "Mom's birthday", "Rent due") is ignored.
 */
export function classifyEvent(event: NormalizedCalendarEvent): EventSignal {
  if (event.status === 'cancelled') {
    return { kind: 'ignored', reason: 'cancelled event' };
  }
  if (event.responseStatus === 'declined') {
    return { kind: 'ignored', reason: 'user declined the event' };
  }
  if (!event.isAllDay) {
    return { kind: 'ignored', reason: 'timed event is not day-level evidence' };
  }

  const title = event.summary ?? '';

  if (matchesAny(title, IN_TOWN_RE)) {
    return { kind: 'in_town', reason: `all-day event "${title}" indicates in town` };
  }
  if (event.eventType === 'outOfOffice') {
    return { kind: 'out_of_town', reason: 'all-day Google out-of-office event' };
  }
  if (matchesAny(title, OUT_OF_TOWN_RE)) {
    return { kind: 'out_of_town', reason: `all-day event "${title}" indicates out of town` };
  }

  return { kind: 'ignored', reason: 'no supported out-of-town signal' };
}

// ---------------------------------------------------------------------------
// Date helpers (UTC, deterministic)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Largest span (in days) we will expand a single all-day event across. Guards
 * against a malformed multi-year event blowing up the result. */
export const MAX_EVENT_SPAN_DAYS = 366;

function isValidDate(value: string | undefined | null): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

/** Days since the epoch for a 'YYYY-MM-DD' date, computed in UTC. */
function toEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Inverse of `toEpochDay` — 'YYYY-MM-DD' for a UTC epoch-day count. */
function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Expand an all-day event to the list of dates it covers, honoring Google's
 * EXCLUSIVE end date. A single-day event (start '..-01', end '..-02') covers
 * just the 1st. A malformed/missing end (<= start) collapses to the start day.
 * The span is capped at `MAX_EVENT_SPAN_DAYS`.
 */
export function expandAllDayDates(start: string, end: string): string[] {
  if (!isValidDate(start)) return [];

  const startDay = toEpochDay(start);
  let endDay = isValidDate(end) ? toEpochDay(end) : startDay + 1;
  // End is exclusive; anything not strictly after start means a single day.
  if (endDay <= startDay) endDay = startDay + 1;
  endDay = Math.min(endDay, startDay + MAX_EVENT_SPAN_DAYS);

  const dates: string[] = [];
  for (let day = startDay; day < endDay; day += 1) {
    dates.push(fromEpochDay(day));
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export interface DateInference {
  date: string; // YYYY-MM-DD
  status: CalendarStatus;
  /** Why this status was inferred, for observability. */
  reason: string;
  /** Ids of the events that drove the winning status on this date. */
  sourceEventIds: string[];
}

export interface InferenceOptions {
  /** Inclusive lower bound ('YYYY-MM-DD'); dates before it are dropped. */
  rangeStart?: string;
  /** Inclusive upper bound ('YYYY-MM-DD'); dates after it are dropped. */
  rangeEnd?: string;
}

interface DateAccumulator {
  outOfTown: { ids: string[]; reason: string } | null;
  inTown: { ids: string[]; reason: string } | null;
}

/**
 * Infer an in/out status for every date touched by a supported signal.
 *
 * Returns a Map keyed by 'YYYY-MM-DD'. Only dates with a definite inference are
 * present — dates with no supported signal are simply absent, which is the
 * caller's cue to leave any existing status untouched.
 *
 * Conflict handling (PRA-6): when multiple events cover one date, an explicit
 * IN-town signal wins over out-of-town. Rationale for a "who's around" social
 * app: falsely marking someone away (so friends don't reach out) is the more
 * costly error, so an explicit "back in town" correction always takes
 * precedence over a broad vacation block. Multiple out-of-town events simply
 * union — the date stays out-of-town and records every contributing event.
 */
export function inferOutOfTownStatuses(
  events: readonly NormalizedCalendarEvent[],
  options: InferenceOptions = {}
): Map<string, DateInference> {
  const byDate = new Map<string, DateAccumulator>();

  for (const event of events) {
    const signal = classifyEvent(event);
    if (signal.kind === 'ignored') continue;

    for (const date of expandAllDayDates(event.start, event.end)) {
      let acc = byDate.get(date);
      if (!acc) {
        acc = { outOfTown: null, inTown: null };
        byDate.set(date, acc);
      }

      const bucket = signal.kind === 'in_town' ? 'inTown' : 'outOfTown';
      const existing = acc[bucket];
      if (existing) {
        existing.ids.push(event.id);
      } else {
        acc[bucket] = { ids: [event.id], reason: signal.reason };
      }
    }
  }

  const result = new Map<string, DateInference>();
  const { rangeStart, rangeEnd } = options;

  // Emit dates in chronological order so the output is fully deterministic —
  // independent of the order events were passed in.
  const sortedDates = [...byDate.keys()].sort();

  for (const date of sortedDates) {
    if (rangeStart && date < rangeStart) continue;
    if (rangeEnd && date > rangeEnd) continue;

    const acc = byDate.get(date)!;

    // Precedence: explicit in-town wins over out-of-town.
    const winner = acc.inTown
      ? { status: 'in_town' as CalendarStatus, source: acc.inTown }
      : acc.outOfTown
        ? { status: 'out_of_town' as CalendarStatus, source: acc.outOfTown }
        : null;

    if (!winner) continue;

    result.set(date, {
      date,
      status: winner.status,
      reason: winner.source.reason,
      sourceEventIds: [...winner.source.ids],
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Integration contract (consumed by PRA-10)
// ---------------------------------------------------------------------------

/** Inclusive date window, 'YYYY-MM-DD' bounds. */
export interface DateWindow {
  start: string;
  end: string;
}

/**
 * The result PRA-9 hands to the status-integration layer (PRA-10's
 * `planStatusReconciliation`). It intentionally carries only the OUT-of-town
 * dates for the evaluated window: in PRA-10's source-of-truth model, in-town is
 * the default/reverted state, so the calendar only ever asserts out-of-town
 * days. An explicit in-town signal therefore manifests here as the absence of
 * that date from `outOfTownDates` (the in-town-wins precedence removed it).
 *
 * This is a structural contract — PRA-10 declares its own identically-shaped
 * `InferredOutOfTownResult`; the two meet via structural typing, so neither
 * module has to import the other.
 */
export interface OutOfTownInferenceResult {
  /** Days ('YYYY-MM-DD') inferred out-of-town, within `window`, sorted. */
  outOfTownDates: string[];
  /** The date range that was actually evaluated. */
  window: DateWindow;
  /**
   * ISO timestamp of the calendar snapshot this was computed from. Passed
   * straight through so PRA-10 can use it as the staleness ordering key — it is
   * the snapshot time, not the wall-clock time the sync ran.
   */
  syncedAt: string;
}

/**
 * Top-level PRA-9 entry point for the sync pipeline: interpret a window of
 * calendar events into the out-of-town date set PRA-10 consumes.
 *
 * `window` bounds are inclusive on both ends. Only out-of-town dates inside the
 * window are returned; explicit in-town signals and unsupported/ambiguous events
 * never appear, which is what keeps them from causing unintended status changes
 * downstream.
 */
export function inferOutOfTownResult(
  events: readonly NormalizedCalendarEvent[],
  window: DateWindow,
  syncedAt: string
): OutOfTownInferenceResult {
  const inferences = inferOutOfTownStatuses(events, {
    rangeStart: window.start,
    rangeEnd: window.end,
  });

  const outOfTownDates: string[] = [];
  for (const [date, inference] of inferences) {
    if (inference.status === 'out_of_town') outOfTownDates.push(date);
  }
  outOfTownDates.sort();

  return { outOfTownDates, window, syncedAt };
}

// ---------------------------------------------------------------------------
// Google event normalization
// ---------------------------------------------------------------------------

/** Minimal structural subset of `googleapis` calendar_v3.Schema$Event we read. */
export interface RawGoogleEventLike {
  id?: string | null;
  summary?: string | null;
  eventType?: string | null;
  status?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  /** Attendee list; we look for the one flagged `self` to read the user's RSVP. */
  attendees?: Array<{ self?: boolean | null; responseStatus?: string | null }> | null;
}

const KNOWN_EVENT_TYPES: readonly CalendarEventType[] = [
  'default',
  'outOfOffice',
  'workingLocation',
  'focusTime',
  'birthday',
  'fromGmail',
];

function coerceEventType(value: string | null | undefined): CalendarEventType {
  return KNOWN_EVENT_TYPES.includes(value as CalendarEventType)
    ? (value as CalendarEventType)
    : 'default';
}

function coerceResponseStatus(
  value: string | null | undefined
): EventResponseStatus | undefined {
  return value === 'accepted' ||
    value === 'tentative' ||
    value === 'declined' ||
    value === 'needsAction'
    ? value
    : undefined;
}

/**
 * Map a raw Google Calendar event into a `NormalizedCalendarEvent`. Returns null
 * for events with no id or no start, which cannot be reasoned about. This is the
 * single seam between the `googleapis` SDK shape and the pure inference rules.
 */
export function normalizeGoogleEvent(
  raw: RawGoogleEventLike
): NormalizedCalendarEvent | null {
  if (!raw.id) return null;

  const isAllDay = Boolean(raw.start?.date);
  const start = raw.start?.date ?? raw.start?.dateTime ?? null;
  const end = raw.end?.date ?? raw.end?.dateTime ?? null;
  if (!start) return null;

  const self = raw.attendees?.find((attendee) => attendee?.self);

  return {
    id: raw.id,
    summary: raw.summary ?? '',
    eventType: coerceEventType(raw.eventType),
    isAllDay,
    start,
    end: end ?? start,
    status:
      raw.status === 'cancelled' || raw.status === 'tentative' || raw.status === 'confirmed'
        ? raw.status
        : undefined,
    responseStatus: coerceResponseStatus(self?.responseStatus),
  };
}
