# Out-of-town inference logic (PRA-9)

How supported Google Calendar signals are interpreted into an automatic in/out
status. This is the rules layer of the [Google Calendar Sync](https://linear.app/rideshare-company/project/google-calendar-sync-5f8b97d822e3)
project. It sits between the calendar sync/trigger (PRA-8, which fetches events)
and the status-integration layer (PRA-10, which writes `calendar_entries`).

Implementation: [`lib/outOfTown.ts`](../lib/outOfTown.ts). Tests:
[`lib/outOfTown.test.ts`](../lib/outOfTown.test.ts).

> **Status of the product decision.** This issue depends on PRA-6 ("Define
> supported out-of-town calendar signals"). At implementation time PRA-6 had no
> published decision (no document, comment, or attachment on the issue). The
> ruleset below is therefore a **conservative, defensible default** derived from
> the project's stated goals, written down here so it is reviewable. Every rule
> is expressed as a tunable constant (`OUT_OF_TOWN_KEYWORDS`,
> `IN_TOWN_KEYWORDS`) or an explicit branch in `classifyEvent` — finalizing
> PRA-6 should mean editing those lists/precedence, not the algorithm. Open
> questions are listed at the end.

## Design principles

- **Deterministic.** The same events always produce the same result,
  independent of input order, the wall clock, or the local timezone. All date
  math is done in UTC on `YYYY-MM-DD` strings.
- **Conservative by default.** An event only ever produces a status when it
  matches an *explicitly supported* signal. Ambiguous or unsupported events
  yield **no** inference for their dates. A date with no inference is left
  exactly as-is by the caller, so unsupported events can never cause an
  unintended status change.
- **Pure and testable.** No I/O and no `googleapis` dependency in the rules; the
  SDK shape is mapped in once via `normalizeGoogleEvent`.

## Supported signals → out-of-town

Only **all-day / multi-day** events are considered (Google `start.date` events).
An event counts as out-of-town evidence when either:

1. It is a native Google **out-of-office** event (`eventType === 'outOfOffice'`), or
2. Its title matches an `OUT_OF_TOWN_KEYWORDS` entry (case-insensitive, whole
   word/phrase): `out of town`, `out of office`, `ooo`, `vacation`, `vacay`,
   `holiday`, `pto`, `on leave`, `annual leave`, `travel`/`traveling`/`travelling`,
   `trip`, `flight`, `away`, `honeymoon`, `cruise`, `retreat`, `offsite`/`off-site`.

A multi-day event is expanded across every date it covers, honoring Google's
**exclusive end date** (a vacation with `end.date` of the 5th does not include
the 5th).

## Explicit in-town signals

An all-day event whose title matches `IN_TOWN_KEYWORDS` — `in town`,
`back in town`, `back home`, `staycation` — is an explicit **in-town** signal.
These exist mainly to let a user correct an over-broad away block (a day at home
in the middle of a long trip). On a single event, an in-town keyword takes
precedence over any out-of-town keyword.

## Unsupported / ambiguous signals (explicitly ignored)

These never change status:

- **Timed events**, regardless of title. A one-hour meeting called "Flight to
  NYC" or a focus block is not day-level evidence of being out of town.
- **Declined events** (`responseStatus === 'declined'`).
- **Cancelled events** (`status === 'cancelled'`).
- **All-day events with no matching keyword** and not out-of-office — e.g.
  "Mom's birthday", "Rent due", "Sprint planning week".
- Event types like `workingLocation`, `focusTime`, `birthday`, `fromGmail` carry
  no travel meaning on their own and only matter if their title matches a
  keyword (rare).

## Conflict handling

When multiple events cover the same date:

1. If any explicit **in-town** signal covers the date → **in town**.
2. Otherwise, if any **out-of-town** signal covers the date → **out of town**.
3. Otherwise → **no inference** (the date is absent from the result).

**In-town wins** on purpose. For a "who's around" social app, falsely marking
someone away — so friends don't reach out — is the more costly error, so an
explicit "back in town" correction always overrides a broad vacation block.
Multiple out-of-town events simply union: the date stays out-of-town and records
every contributing event id for observability.

## Output and the PRA-10 contract

Two entry points:

- `inferOutOfTownStatuses(events, { rangeStart?, rangeEnd? })` → a `Map<date,
  { status, reason, sourceEventIds }>` containing only dates with a definite
  inference. This is the rich, per-date view used for tests and observability.
- `inferOutOfTownResult(events, window, syncedAt)` → the integration contract
  the status layer consumes:

  ```ts
  { outOfTownDates: string[], window: { start, end }, syncedAt: string }
  ```

  It returns only the **out-of-town** dates inside the (inclusive) window,
  sorted, and passes `syncedAt` through as PRA-10's staleness ordering key.
  Because in-town is the default/reverted state in PRA-10's model, an explicit
  in-town day manifests here as the *absence* of that date from
  `outOfTownDates`. `OutOfTownInferenceResult` is structurally identical to
  PRA-10's `InferredOutOfTownResult`, so the two modules meet by structural
  typing without importing each other.

Reconciliation with stored status (manual-vs-calendar ownership, staleness,
idempotency) is **not** done here — that is PRA-10's `planStatusReconciliation`.
PRA-9 stops at "what does the calendar say for this window".

## Open questions for PRA-6 finalization

- Should any **timed** events ever count (e.g. a multi-day timed OOO, or a
  same-day flight)? Current answer: no — day-level only, for determinism.
- Keyword coverage: are work-travel terms like `conference` in scope? Excluded
  for now because conferences are often local/virtual (false-positive risk).
- Should `workingLocation` events (Home vs an office) feed an in-town signal?
  Out of scope for now.
- How should all-day events marked "free"/transparent be treated? Currently not
  used as a filter; revisit if it proves noisy.
