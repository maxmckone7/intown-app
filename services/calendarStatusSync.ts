/**
 * Calendar inference → in/out status integration (PRA-10).
 *
 * This module is the single seam that connects an *inferred out-of-town result*
 * (produced by the inference logic in PRA-9, from calendar data fetched by the
 * sync trigger in PRA-8) to the product's real in/out status path
 * (`calendar_entries` via `calendarService`). It is deliberately decoupled from
 * how the inference is computed: give it a set of out-of-town dates for an
 * evaluated window plus the snapshot timestamp they came from, and it reconciles
 * the user's calendar automatically.
 *
 * The interesting part is not the writing — it's *what not to write*. All of the
 * source-of-truth, staleness, and idempotency rules live in the pure
 * `planStatusReconciliation` function so they can be reasoned about and tested
 * without a database. `applyInferredStatus` is the thin I/O wrapper.
 *
 * Source-of-truth model (see docs/calendar-status-integration.md):
 *   1. Manual wins.        A day the user set themselves (`source = 'manual'`) is
 *                          never overwritten or deleted by the calendar. If the
 *                          user says they are in town, the calendar cannot argue.
 *   2. Calendar owns its own. Only entries the calendar wrote
 *                          (`source = 'calendar_inferred'`) are updated or cleaned
 *                          up by a later sync.
 *   3. Never move backward. A sync computed from an older snapshot than the one
 *                          that last wrote a day is ignored for that day (stale).
 *   4. No churn.           A day already at the desired state is left untouched,
 *                          so we don't re-fire status triggers or bump timestamps.
 */

import { calendarService } from './calendar';
import { track } from './analytics';
import { CalendarEntry } from '../lib/types';

// --- Input contract (fulfilled by PRA-9 inference) -------------------------

/** Inclusive date window, `YYYY-MM-DD` bounds. */
export interface DateWindow {
  start: string;
  end: string;
}

/**
 * The output of out-of-town inference for one sync run. Reconciliation only ever
 * touches calendar-owned entries *inside* `window`; anything outside was not
 * evaluated this run and is left alone.
 */
export interface InferredOutOfTownResult {
  /** Days (`YYYY-MM-DD`) the inference concluded the user is out of town. */
  outOfTownDates: string[];
  /** The date range the inference actually evaluated. */
  window: DateWindow;
  /**
   * ISO timestamp of the calendar snapshot this result was computed from. This
   * is the ordering key for the staleness guard — NOT the wall-clock time the
   * sync ran, which can differ under retries/replays.
   */
  syncedAt: string;
}

// --- Reconciliation plan (pure) --------------------------------------------

export type ReconcileOpKind = 'set_out_of_town' | 'revert_to_in_town';

export type SkipReason =
  | 'manual_owned' // user authored this day; calendar must not touch it
  | 'stale' // inference is older than the snapshot that last wrote this day
  | 'unchanged' // already at the desired state; writing would only add churn
  | 'outside_window'; // inferred date fell outside its own evaluated window

export interface ReconcileOp {
  date: string;
  kind: ReconcileOpKind;
}

export interface SkippedDate {
  date: string;
  reason: SkipReason;
}

export interface ReconciliationPlan {
  ops: ReconcileOp[];
  skipped: SkippedDate[];
}

const isWithin = (date: string, window: DateWindow): boolean =>
  date >= window.start && date <= window.end;

/** True if `candidate`'s snapshot is strictly older than the entry's. */
const isStaleAgainst = (candidateSyncedAt: string, entry: CalendarEntry): boolean => {
  if (entry.source !== 'calendar_inferred' || !entry.inferred_synced_at) return false;
  return new Date(candidateSyncedAt).getTime() < new Date(entry.inferred_synced_at).getTime();
};

/**
 * Decide, per day, what the integration should do — without performing any I/O.
 *
 * Considers the union of (a) the dates the inference marked out-of-town and
 * (b) the calendar-owned entries already present in the window (so trips that
 * disappeared from the calendar get cleaned up). Manual entries are only ever
 * observed to be skipped; they are never emitted as an op.
 */
export function planStatusReconciliation(
  existing: CalendarEntry[],
  inference: InferredOutOfTownResult
): ReconciliationPlan {
  const { window, syncedAt } = inference;
  const ops: ReconcileOp[] = [];
  const skipped: SkippedDate[] = [];

  // Index existing entries within the evaluated window by date.
  const byDate = new Map<string, CalendarEntry>();
  for (const entry of existing) {
    if (isWithin(entry.date, window)) byDate.set(entry.date, entry);
  }

  // Desired out-of-town set, clamped to the declared window.
  const wantOutOfTown = new Set<string>();
  for (const date of inference.outOfTownDates) {
    if (isWithin(date, window)) {
      wantOutOfTown.add(date);
    } else {
      skipped.push({ date, reason: 'outside_window' });
    }
  }

  // Every date we might act on: what the calendar wants now, plus what the
  // calendar owns already (candidates for cleanup).
  const candidates = new Set<string>(wantOutOfTown);
  for (const [date, entry] of byDate) {
    if (entry.source === 'calendar_inferred') candidates.add(date);
  }

  for (const date of candidates) {
    const entry = byDate.get(date);
    const wantAway = wantOutOfTown.has(date);

    // Rule 1: manual days are the user's; the calendar never overwrites them.
    if (entry && entry.source === 'manual') {
      skipped.push({ date, reason: 'manual_owned' });
      continue;
    }

    // Rule 3: don't let an older snapshot move a calendar-owned day.
    if (entry && isStaleAgainst(syncedAt, entry)) {
      skipped.push({ date, reason: 'stale' });
      continue;
    }

    if (wantAway) {
      // Rule 4: already away and calendar-owned → nothing to do.
      if (entry && entry.status === 'out_of_town') {
        skipped.push({ date, reason: 'unchanged' });
      } else {
        ops.push({ date, kind: 'set_out_of_town' });
      }
    } else {
      // Not out of town anymore. Clean up only what the calendar itself set;
      // a bare (no-entry) day is already in town, so there's nothing to revert.
      if (entry && entry.source === 'calendar_inferred' && entry.status === 'out_of_town') {
        ops.push({ date, kind: 'revert_to_in_town' });
      } else {
        skipped.push({ date, reason: 'unchanged' });
      }
    }
  }

  return { ops, skipped };
}

// --- Apply (I/O) -----------------------------------------------------------

export interface ReconciliationSummary {
  window: DateWindow;
  syncedAt: string;
  /** Days newly set / kept as out-of-town by this run. */
  set: number;
  /** Days cleaned back to in-town because the trip disappeared. */
  reverted: number;
  /** Days deliberately left alone, grouped by reason. */
  skipped: Record<SkipReason, number>;
  /** Days whose write failed; the run continues past them (best-effort). */
  failed: { date: string; error: string }[];
}

/**
 * Dependencies the apply step needs. Injected so the reconciliation can be
 * driven against a fake in tests and so the caller (a sync worker) can supply
 * its own instrumented calendar client if needed.
 */
export interface ApplyDeps {
  getEntries: typeof calendarService.getEntries;
  setEntry: typeof calendarService.setEntry;
  deleteEntry: typeof calendarService.deleteEntry;
  track: typeof track;
}

const defaultDeps: ApplyDeps = {
  getEntries: calendarService.getEntries.bind(calendarService),
  setEntry: calendarService.setEntry.bind(calendarService),
  deleteEntry: calendarService.deleteEntry.bind(calendarService),
  track,
};

const emptySkipCounts = (): Record<SkipReason, number> => ({
  manual_owned: 0,
  stale: 0,
  unchanged: 0,
  outside_window: 0,
});

/**
 * Apply an inferred out-of-town result to a user's in/out status. Loads the
 * user's current entries for the evaluated window, plans the reconciliation,
 * and writes only the necessary changes. Never requires manual intervention for
 * the normal case; individual write failures are collected rather than aborting
 * the whole run, so one bad day can't strand the rest.
 */
export async function applyInferredStatus(
  userId: string,
  inference: InferredOutOfTownResult,
  deps: ApplyDeps = defaultDeps
): Promise<ReconciliationSummary> {
  const existing = await deps.getEntries(
    userId,
    inference.window.start,
    inference.window.end
  );

  const plan = planStatusReconciliation(existing, inference);

  const summary: ReconciliationSummary = {
    window: inference.window,
    syncedAt: inference.syncedAt,
    set: 0,
    reverted: 0,
    skipped: emptySkipCounts(),
    failed: [],
  };

  for (const skip of plan.skipped) {
    summary.skipped[skip.reason] += 1;
  }

  for (const op of plan.ops) {
    try {
      if (op.kind === 'set_out_of_town') {
        await deps.setEntry(userId, op.date, 'out_of_town', {
          source: 'calendar_inferred',
          inferredSyncedAt: inference.syncedAt,
        });
        summary.set += 1;
        deps.track('status_updated', {
          user_id: userId,
          date: op.date,
          status: 'out_of_town',
          source: 'calendar_sync',
        });
      } else {
        // Reverting a calendar-owned away day means deleting the entry: a day
        // with no entry is in town by default, which keeps the table free of
        // stale calendar_inferred rows.
        await deps.deleteEntry(userId, op.date);
        summary.reverted += 1;
        deps.track('status_updated', {
          user_id: userId,
          date: op.date,
          status: 'in_town',
          source: 'calendar_sync',
        });
      }
    } catch (err: any) {
      summary.failed.push({ date: op.date, error: err?.message ?? String(err) });
    }
  }

  return summary;
}
