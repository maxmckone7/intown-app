# Calendar Inference → In/Out Status Integration

**Issue:** PRA-10 · **Project:** Google Calendar Sync · **Status:** Definition + integration seam

Defines how an *inferred out-of-town result* becomes a real change to a user's
in/out status, and — more importantly — the source-of-truth, staleness, and
idempotency rules that keep those automatic changes from being wrong. This is
delivery area #5 ("In/out status update integration") of the
[Google Calendar Sync](https://linear.app/rideshare-company/project/google-calendar-sync-5f8b97d822e3)
project.

This is the source-of-truth spec for the behavior. The logic lives in
`services/calendarStatusSync.ts`; keep the two in sync.

---

## 1. Where this sits in the project

The project splits into six delivery areas. This issue is the last hop — it does
**not** decide what "out of town" means or how the calendar is read:

| Area | Issue | Produces |
| --- | --- | --- |
| Supported signals | PRA-6 | Which calendar events count as out-of-town |
| OAuth connection | PRA-7 | A connected Google account |
| Sync / trigger | PRA-8 | *When* the calendar is fetched and evaluated |
| Inference logic | PRA-9 | An **`InferredOutOfTownResult`** for a window |
| **Status integration** | **PRA-10 (this)** | Applies that result to `calendar_entries` |
| Reliability / observability | PRA-11 | Failure surfacing, retries, dashboards |

Because PRA-9's inference logic is still being built, this issue delivers the
**integration seam and its contract** — a typed `InferredOutOfTownResult` input
and the reconciliation that consumes it — so PRA-9 can plug in without
renegotiating the boundary. The seam is exercised by calling `applyInferredStatus`.

---

## 2. The status model this integrates with

The product already has a manual in/out status path:

- Days live in `calendar_entries` (`database/schema.sql:51`), one row per
  `(user_id, date)`, `status ∈ {in_town, out_of_town}`. A day with **no row is
  in town by default** (see the calendar grid, `components/MyCalendar.tsx`).
- The write path is `calendarService.setEntry` (`services/calendar.ts:38`),
  driven from the calendar tab's tap-to-toggle
  (`components/MyCalendar.tsx:205`).
- A status change also feeds friend-coordination notifications via the
  `enqueue_coordination_notifications` trigger
  (`database/schema.sql:694`) — so a spurious auto-update is not just wrong on
  screen, it can notify friends. That raises the bar on "prevent incorrect or
  stale updates."

### What PRA-10 adds to the model

Two columns on `calendar_entries` (`database/schema.sql:60`, migration at `:71`):

- **`source`** `∈ {manual, calendar_inferred}` — who last wrote the day. Existing
  rows and every current call site default to `manual`, so nothing changes for
  days the user owns.
- **`inferred_synced_at`** — for `calendar_inferred` rows, the timestamp of the
  calendar snapshot the inference came from. This is the ordering key for the
  staleness guard (§4), not the wall-clock sync time.

`StatusSource` and the extended `CalendarEntry` are in `lib/types.ts:10`.

---

## 3. Source-of-truth behavior

The reconciliation (`planStatusReconciliation`, `services/calendarStatusSync.ts:102`)
resolves every day by four rules, in order:

1. **Manual wins.** If a day's `source = 'manual'`, the calendar never overwrites
   or deletes it. A user who explicitly marked themselves *in town* on a day a
   trip appears on their calendar stays in town — the human is the ultimate
   authority for their own presence. Manual entries only ever show up in the plan
   as `skipped: manual_owned`.
2. **Calendar owns its own.** Only `calendar_inferred` days are updated or cleaned
   up by a later sync. Re-tapping an auto-set day in the app writes `source =
   'manual'` and clears `inferred_synced_at` (`services/calendar.ts:38`), handing
   that day back to the user permanently.
3. **Never move backward** (staleness — §4).
4. **No churn** (idempotency — §5).

### Reverting is cleanup, not override

When a trip disappears from the calendar (event deleted, declined, moved), the
day is no longer in the inferred set. The integration reverts it by **deleting
the `calendar_inferred` row** — returning the day to the in-town default —
rather than writing `in_town`. It only ever cleans up days *it* created, so a
manual *out of town* day is never reverted by a canceled calendar event.

---

## 4. Preventing stale / out-of-order updates

Syncs can arrive late, be retried, or replay an old snapshot. The `syncedAt`
timestamp on `InferredOutOfTownResult` is the calendar snapshot's point-in-time,
and each `calendar_inferred` row records the `inferred_synced_at` it was written
from. The rule (`isStaleAgainst`, `services/calendarStatusSync.ts`):

> A change to a calendar-owned day is applied only if the incoming `syncedAt` is
> **newer than or equal to** the snapshot that last wrote it. A strictly older
> snapshot is skipped as `stale`.

This holds for both directions: an old snapshot can neither re-mark a day away
that a newer sync already cleared, nor clear a day a newer sync just set. Manual
days are exempt from this comparison entirely — rule 1 already stops the calendar
touching them.

Timestamps are compared numerically (`new Date(...).getTime()`) so
timezone-format differences between the stored value and the incoming ISO string
don't matter.

---

## 5. Idempotency and scope

- **No-op writes are skipped.** A day already `out_of_town` and calendar-owned is
  left untouched (`skipped: unchanged`) — no write, no `updated_at` bump, and
  crucially no re-fire of the coordination-notification trigger. Reconciliation
  is safe to run every sync cycle.
- **Only the evaluated window is touched.** `InferredOutOfTownResult.window` is
  the date range the inference actually looked at. Reconciliation ignores
  entries outside it and skips inferred dates that fall outside their own window
  (`skipped: outside_window`). A sync that only evaluated the next 30 days can't
  disturb a trip you hand-entered for next year.
- **Best-effort application.** A single failed write is collected into
  `summary.failed` and the run continues, so one bad day can't strand the rest.
  Surfacing and retrying those failures is PRA-11's job.

---

## 6. The seam

Input contract PRA-9 fulfills (`services/calendarStatusSync.ts`):

```ts
interface InferredOutOfTownResult {
  outOfTownDates: string[];   // YYYY-MM-DD the user is inferred out of town
  window: { start: string; end: string }; // the range actually evaluated
  syncedAt: string;           // ISO snapshot time — the staleness ordering key
}
```

Entry points:

- `planStatusReconciliation(existing, inference) → { ops, skipped }` — **pure**,
  no I/O. All of §3–§5 lives here, so the rules can be unit-tested against
  hand-built `CalendarEntry[]` without a database.
- `applyInferredStatus(userId, inference, deps?) → ReconciliationSummary` — loads
  the window's entries, plans, and applies only the necessary changes. `deps` is
  injectable (`getEntries` / `setEntry` / `deleteEntry` / `track`) for tests and
  for an instrumented sync worker.

Each applied change emits the existing `status_updated` analytics event with
`source: 'calendar_sync'` (`services/analytics.ts:36`), so auto-updates land in
the same reporting as manual ones and can be told apart. The returned
`ReconciliationSummary` (counts of set / reverted / skipped-by-reason / failed)
is what a sync worker or PRA-11 dashboard logs per run.

### A worker calls it like this

```ts
const inference = await inferOutOfTown(userId);      // PRA-9
const summary = await applyInferredStatus(userId, inference);
// summary.set / summary.reverted / summary.skipped / summary.failed
```

No user interaction is involved — that is the point. The user connects their
calendar once (PRA-7); status then tracks their trips on its own.

---

## 7. Acceptance criteria → where met

| Criterion | Met by |
| --- | --- |
| A supported inferred result updates status automatically | `applyInferredStatus` writes `out_of_town` via `setEntry` (§6) |
| Status changes follow expected source-of-truth behavior | Manual-wins + calendar-owns-its-own rules (§3) |
| No manual intervention for normal cases | Worker-driven apply; zero UI in the path (§6) |
| Incorrect or stale updates prevented as much as possible | Staleness guard (§4) + idempotency + window scoping (§5) |

---

## 8. Open questions (defer to siblings / product)

- **Snapshot vs. wall-clock time.** `syncedAt` must be the *snapshot's* time for
  the staleness guard to order correctly. PRA-8 owns producing it; this doc
  assumes it does.
- **Should the user see that a day was auto-set?** Distinguishing `calendar_inferred`
  cells in `MyCalendar` (a badge, an undo) is a UX follow-up, not required by the
  integration. `source` is already on the row to support it.
- **Whole-day only.** This integration operates on day-level status, matching the
  `calendar_entries` grain. Partial-day / timezone-of-travel nuance is out of
  scope and belongs to PRA-6's signal definition.
