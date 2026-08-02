/**
 * Calendar sync & trigger orchestration for Google Calendar Sync (PRA-8).
 *
 * This is the single seam that decides *when* Google Calendar data is fetched
 * and evaluated for status updates, and *whether* a given sync should do any
 * downstream work. It owns three things and nothing else:
 *
 *   1. The trigger / cadence model — `decideSync` answers "should we sync now?"
 *      for a given trigger and the user's last-sync state, enforcing a hard
 *      floor so repeated triggers don't cause repeated sync activity.
 *   2. Change detection — `computeSignalFingerprint` lets a completed fetch be
 *      compared against the last successful one, so an unchanged calendar skips
 *      the expensive inference / status-write / notification path entirely.
 *   3. Failure detection — every `runSync` returns a typed `SyncRun`, and the
 *      persisted `SyncState` records last success/failure, consecutive
 *      failures, and the last error, so a broken sync path is observable.
 *
 * It deliberately does NOT know:
 *   - how to obtain a Google token or call the Calendar API  → PRA-7 (`fetchSignals`)
 *   - which events count as "out of town"                    → PRA-6 (signal contents)
 *   - how to interpret signals into in/out status            → PRA-9 (`infer`)
 *   - how to write in/out status into the product            → PRA-10 (`applyStatus`)
 *   - how failures are surfaced to users / dashboards        → PRA-11 (`onRun`)
 *
 * Following the `services/analytics.ts` precedent, every one of those boundaries
 * is an injected dependency, so this module is pure, framework-free, and fully
 * testable on its own while the real providers are built in their own issues.
 * The behaviour here is the source of truth for docs/calendar-sync-and-trigger.md
 * — keep the two in sync.
 */

import { addDays, format } from 'date-fns';
import { CalendarStatus } from '../lib/types';

// `__DEV__` is injected by the React Native / Expo runtime.
declare const __DEV__: boolean;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

// --- Triggers & configuration ---------------------------------------------

/** What caused a sync to be requested. Drives `decideSync`. */
export type SyncTrigger =
  | 'scheduled' // periodic cadence tick (background task / server cron)
  | 'app_foreground' // user brought the app to the foreground
  | 'connect' // user just completed the Google connection (PRA-7)
  | 'reconnect' // token was re-authorized after a failure
  | 'manual'; // user tapped an explicit "refresh now"

/** Triggers that reflect fresh user intent and bypass the scheduled cadence. */
const FORCED_TRIGGERS: ReadonlySet<SyncTrigger> = new Set<SyncTrigger>([
  'connect',
  'reconnect',
  'manual',
]);

export interface SyncConfig {
  /**
   * Hard dedup floor: two syncs for the same user never run closer together
   * than this, regardless of trigger. This is what keeps foreground/manual
   * triggers from causing repeated sync activity. The one exception is
   * `connect` (a brand-new account must reflect immediately).
   */
  minIntervalMs: number;
  /** Target cadence for the `scheduled` trigger — the routine refresh rate. */
  scheduledIntervalMs: number;
  /**
   * Once a user's last successful sync is older than this, any eligible trigger
   * forces a sync even if it is otherwise not "due" — a staleness backstop.
   */
  maxStalenessMs: number;
  /** How many days ahead of "today" the sync window covers. */
  lookaheadDays: number;
}

/**
 * Proposed defaults. The cadence/trigger model is an explicit open question on
 * the project ("What sync cadence or event-driven trigger model is expected?");
 * these are the doc's recommendation, not a settled decision. See
 * docs/calendar-sync-and-trigger.md §"Cadence".
 */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  minIntervalMs: 15 * 60_000, // 15 minutes
  scheduledIntervalMs: 6 * 60 * 60_000, // 6 hours
  maxStalenessMs: 24 * 60 * 60_000, // 24 hours
  lookaheadDays: 14,
};

// --- Sync window -----------------------------------------------------------

/** Inclusive date range a sync evaluates. Day-granular, matching in/out status. */
export interface SyncWindow {
  /** First day, `YYYY-MM-DD`. */
  start: string;
  /** Last day, `YYYY-MM-DD`. */
  end: string;
}

/**
 * The window is [today, today + lookaheadDays]. Status is a near-term signal,
 * so there is no value in fetching far-future calendar data.
 *
 * NOTE (open question): dates are derived in the host's local time zone. Which
 * zone defines a user's "day" for out-of-town status is a cross-cutting
 * decision shared with PRA-9/PRA-10 — see the doc's "Time zones" note.
 */
export function computeWindow(nowMs: number, config: SyncConfig = DEFAULT_SYNC_CONFIG): SyncWindow {
  const today = new Date(nowMs);
  return {
    start: format(today, 'yyyy-MM-dd'),
    end: format(addDays(today, config.lookaheadDays), 'yyyy-MM-dd'),
  };
}

// --- Signals & inferred status (opaque to PRA-8) ---------------------------

/**
 * A normalized, already-supported calendar signal, represented as a stable
 * string token. PRA-8 treats these as opaque and comparable only: what a token
 * means and which events produce one are owned by PRA-6 (definition) and
 * PRA-9 (interpretation). The source (PRA-7) must emit a deterministic token
 * per signal so change detection is stable across syncs.
 */
export type CalendarSignals = readonly string[];

/** One day of inferred in/out status, produced by PRA-9's interpretation. */
export interface InferredStatus {
  /** `YYYY-MM-DD`. */
  date: string;
  status: CalendarStatus;
}

// --- Sync state (persisted) ------------------------------------------------

/**
 * Per-user sync bookkeeping. Persistence is injected (`SyncStateStore`) rather
 * than hard-wired to a table: the physical home for this state is a
 * coordination point with PRA-7's connection record and PRA-11's observability
 * store — see the doc's "Persistence" note. This shape is the contract either
 * way.
 */
export interface SyncState {
  userId: string;
  /** Epoch ms of the most recent sync attempt (success or failure). */
  lastAttemptAt: number | null;
  /** Epoch ms of the most recent successful sync (incl. unchanged no-ops). */
  lastSuccessAt: number | null;
  /** Epoch ms of the most recent failed sync. */
  lastFailureAt: number | null;
  /** Failures since the last success. A rising count is the alarm signal. */
  consecutiveFailures: number;
  /** Fingerprint of the signal set at the last successful sync (change detection). */
  lastSignalFingerprint: string | null;
  /** Message from the most recent failure, cleared on success. */
  lastError: string | null;
}

export interface SyncStateStore {
  get(userId: string): Promise<SyncState | null>;
  set(state: SyncState): Promise<void>;
}

function initialState(userId: string): SyncState {
  return {
    userId,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastSignalFingerprint: null,
    lastError: null,
  };
}

// --- Decision: should we sync now? -----------------------------------------

export type SyncSkipReason = 'within_min_interval' | 'not_due';
export type SyncGoReason = 'first_sync' | 'forced_trigger' | 'stale' | 'due';

export type SyncDecision =
  | { sync: true; reason: SyncGoReason }
  | { sync: false; reason: SyncSkipReason };

/**
 * Pure trigger/cadence decision. Order matters:
 *   1. Never synced successfully  → always sync (`first_sync`).
 *   2. Inside the min-interval floor → skip (`within_min_interval`), unless the
 *      trigger is `connect` (a new account must reflect immediately). This is
 *      the guard that prevents repeated sync activity from bursty triggers.
 *   3. A forced trigger (manual/connect/reconnect) past the floor → sync.
 *   4. Older than the staleness backstop → sync (`stale`).
 *   5. Past the scheduled cadence → sync (`due`).
 *   6. Otherwise → skip (`not_due`).
 */
export function decideSync(
  trigger: SyncTrigger,
  state: SyncState | null,
  nowMs: number,
  config: SyncConfig = DEFAULT_SYNC_CONFIG
): SyncDecision {
  if (!state || state.lastSuccessAt == null) {
    return { sync: true, reason: 'first_sync' };
  }

  const sinceSuccess = nowMs - state.lastSuccessAt;

  if (sinceSuccess < config.minIntervalMs && trigger !== 'connect') {
    return { sync: false, reason: 'within_min_interval' };
  }
  if (FORCED_TRIGGERS.has(trigger)) {
    return { sync: true, reason: 'forced_trigger' };
  }
  if (sinceSuccess >= config.maxStalenessMs) {
    return { sync: true, reason: 'stale' };
  }
  if (sinceSuccess >= config.scheduledIntervalMs) {
    return { sync: true, reason: 'due' };
  }
  return { sync: false, reason: 'not_due' };
}

/** Epoch ms of the next routine (`scheduled`) sync, for a scheduler to arm a timer. */
export function nextScheduledSyncAt(
  state: SyncState | null,
  config: SyncConfig = DEFAULT_SYNC_CONFIG
): number | null {
  if (!state || state.lastSuccessAt == null) return null; // sync as soon as possible
  return state.lastSuccessAt + config.scheduledIntervalMs;
}

// --- Change detection ------------------------------------------------------

/**
 * Order-independent fingerprint of a signal set. Reordering the same signals
 * produces the same fingerprint, so it never triggers spurious downstream work;
 * adding/removing/changing any signal changes it. djb2 over the sorted, joined
 * tokens — not cryptographic, just a stable change key.
 */
export function computeSignalFingerprint(signals: CalendarSignals): string {
  const joined = [...signals].sort().join(' ');
  let hash = 5381;
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  // Fold in the length so [] and any empty-token permutation stay distinct.
  return `${signals.length}:${(hash >>> 0).toString(16)}`;
}

// --- Orchestration ---------------------------------------------------------

/** Outcome of a single `runSync` call. `result` distinguishes the four paths. */
export interface SyncRun {
  trigger: SyncTrigger;
  startedAt: number;
  finishedAt: number;
  result: 'applied' | 'unchanged' | 'skipped' | 'failed';
  /** Decision reason (`skipped`) or a short detail for the other results. */
  reason?: SyncSkipReason | SyncGoReason | 'unchanged';
  /** Stage a `failed` run died in. */
  stage?: 'fetch' | 'infer' | 'apply' | 'persist';
  /** Error message on a `failed` run. */
  error?: string;
  /** Number of status days written on an `applied` run. */
  changedDays?: number;
}

export interface SyncDeps {
  /**
   * PRA-7 + PRA-6: fetch the normalized, supported out-of-town signal tokens
   * for the window. Throwing here is treated as a `fetch`-stage failure.
   */
  fetchSignals(userId: string, window: SyncWindow): Promise<CalendarSignals>;
  /** PRA-9: interpret signals into per-day inferred in/out status. */
  infer(signals: CalendarSignals, window: SyncWindow): InferredStatus[];
  /** PRA-10: write inferred status into the product's in/out path; returns #days changed. */
  applyStatus(userId: string, inferred: InferredStatus[]): Promise<number>;
  /** Sync-state persistence. */
  store: SyncStateStore;
  /** PRA-11: observability hook, called once per run (incl. skips/failures). */
  onRun?(userId: string, run: SyncRun): void;
  /** Injectable clock for testing. Defaults to `Date.now`. */
  now?(): number;
}

/**
 * Run one sync for a user under a given trigger. Composes the whole path:
 * decide → fetch → change-detect → infer → apply → persist. Never throws: every
 * failure is converted into a `failed` SyncRun and recorded in `SyncState`, so
 * the sync path's health is always observable (AC: "failures can be detected").
 */
export async function runSync(
  userId: string,
  trigger: SyncTrigger,
  deps: SyncDeps,
  config: SyncConfig = DEFAULT_SYNC_CONFIG
): Promise<SyncRun> {
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const state = (await deps.store.get(userId).catch(() => null)) ?? initialState(userId);

  const decision = decideSync(trigger, state, startedAt, config);
  if (!decision.sync) {
    return report(deps, userId, {
      trigger,
      startedAt,
      finishedAt: now(),
      result: 'skipped',
      reason: decision.reason,
    });
  }

  const window = computeWindow(startedAt, config);
  const attempted: SyncState = { ...state, lastAttemptAt: startedAt };

  // 1. Fetch (PRA-7 / PRA-6)
  let signals: CalendarSignals;
  try {
    signals = await deps.fetchSignals(userId, window);
  } catch (error) {
    return fail(deps, userId, attempted, trigger, startedAt, now(), 'fetch', error);
  }

  // 2. Change detection — skip all downstream work if nothing changed.
  const fingerprint = computeSignalFingerprint(signals);
  if (fingerprint === state.lastSignalFingerprint) {
    const persistError = await persist(deps, {
      ...attempted,
      lastSuccessAt: startedAt,
      consecutiveFailures: 0,
      lastError: null,
    });
    if (persistError) {
      return fail(deps, userId, attempted, trigger, startedAt, now(), 'persist', persistError);
    }
    return report(deps, userId, {
      trigger,
      startedAt,
      finishedAt: now(),
      result: 'unchanged',
      reason: 'unchanged',
    });
  }

  // 3. Infer (PRA-9)
  let inferred: InferredStatus[];
  try {
    inferred = deps.infer(signals, window);
  } catch (error) {
    return fail(deps, userId, attempted, trigger, startedAt, now(), 'infer', error);
  }

  // 4. Apply (PRA-10)
  let changedDays: number;
  try {
    changedDays = await deps.applyStatus(userId, inferred);
  } catch (error) {
    return fail(deps, userId, attempted, trigger, startedAt, now(), 'apply', error);
  }

  // 5. Persist success (fingerprint recorded so the next sync can change-detect).
  const persistError = await persist(deps, {
    userId,
    lastAttemptAt: startedAt,
    lastSuccessAt: startedAt,
    lastFailureAt: state.lastFailureAt,
    consecutiveFailures: 0,
    lastSignalFingerprint: fingerprint,
    lastError: null,
  });
  if (persistError) {
    return fail(deps, userId, attempted, trigger, startedAt, now(), 'persist', persistError);
  }

  return report(deps, userId, {
    trigger,
    startedAt,
    finishedAt: now(),
    result: 'applied',
    changedDays,
  });
}

// --- internals -------------------------------------------------------------

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown sync error';
}

/** Persist state, swallowing the throw and returning an error message on failure. */
async function persist(deps: SyncDeps, state: SyncState): Promise<string | null> {
  try {
    await deps.store.set(state);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

/** Record a failure into SyncState (best-effort) and return a `failed` run. */
async function fail(
  deps: SyncDeps,
  userId: string,
  attempted: SyncState,
  trigger: SyncTrigger,
  startedAt: number,
  finishedAt: number,
  stage: NonNullable<SyncRun['stage']>,
  error: unknown
): Promise<SyncRun> {
  const message = errorMessage(error);
  // A persist-stage failure means the store is unavailable; don't try again.
  if (stage !== 'persist') {
    await persist(deps, {
      ...attempted,
      lastFailureAt: finishedAt,
      consecutiveFailures: attempted.consecutiveFailures + 1,
      lastError: message,
    });
  }
  return report(deps, userId, {
    trigger,
    startedAt,
    finishedAt,
    result: 'failed',
    stage,
    error: message,
  });
}

/** Emit to the observability hook (never throwing) and return the run. */
function report(deps: SyncDeps, userId: string, run: SyncRun): SyncRun {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log(`[calendarSync] ${run.result}`, { userId, ...run });
  }
  if (deps.onRun) {
    try {
      deps.onRun(userId, run);
    } catch (error) {
      if (isDev) {
        // eslint-disable-next-line no-console
        console.warn('[calendarSync] onRun threw', error);
      }
    }
  }
  return run;
}
