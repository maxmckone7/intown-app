# Calendar Sync & Trigger Behavior

**Issue:** PRA-8 · **Project:** Google Calendar Sync · **Status:** Definition + seam implementation

Defines *when* a connected Google Calendar is fetched and re-evaluated for
status updates, and *whether* any given sync does downstream work. This is the
[project's](https://linear.app/rideshare-company/project/google-calendar-sync-5f8b97d822e3)
delivery area 3 ("Calendar sync or trigger mechanism") and answers its open
question *"What sync cadence or event-driven trigger model is expected?"*

This is the source-of-truth spec. The trigger/cadence/change-detection logic
lives in `services/calendarSync.ts`; keep the two in sync. Like
`services/analytics.ts` (PRA-5), the module is a **typed seam**: the decision
and change-detection logic is real and tested, while the provider boundaries it
depends on (Google fetch, inference, status write, observability) are injected
and owned by sibling issues.

---

## 1. Current state

**What exists in the app today**

- **Manual in/out status** — the only status mechanism. Days are `in_town` /
  `out_of_town` in `calendar_entries` (`database/schema.sql:56`), read/written
  through `calendarService` (`services/calendar.ts`) and toggled by hand in the
  calendar tab (`components/MyCalendar.tsx`). Nothing updates status
  automatically.
- **Google *authentication*** — `authService.signInWithGoogle`
  (`services/auth.ts:208`) does a Supabase OAuth **login**. It requests only
  sign-in scopes; it does **not** request calendar access and stores no
  calendar token. Connecting a calendar (scopes, token storage) is a separate
  flow owned by **PRA-7**.
- **A status-update analytics seam** — `status_updated`
  (`services/analytics.ts`) with a `source` of `manual_calendar` / `onboarding`
  / `reminder` / `notification`. There is **no** calendar-derived source yet
  (a coordination point for PRA-10, §8).

**What does not exist yet**

- Any Google Calendar **read** (event fetch), token store, sync scheduler,
  inference, or automatic status write. The whole project is at "Idea" stage;
  this issue builds only the trigger/sync spine that the others plug into.

**What this issue adds**

- `services/calendarSync.ts` — the trigger decision (`decideSync`), the sync
  window (`computeWindow`), change detection (`computeSignalFingerprint`), the
  per-user sync state contract (`SyncState` / `SyncStateStore`), and the
  orchestrator (`runSync`) that composes decide → fetch → change-detect → infer
  → apply → persist with typed failure capture.

---

## 2. Scope & boundaries

PRA-8 owns **when and whether** a sync runs. It is deliberately blind to the
content of a sync. Each boundary is an injected dependency of `runSync`:

| Concern | Owner | Seam point |
| --- | --- | --- |
| Which events mean "out of town" | PRA-6 | shape of the signal tokens |
| Google connection, token, event fetch | PRA-7 | `fetchSignals(userId, window)` |
| Interpreting signals → in/out per day | PRA-9 | `infer(signals, window)` |
| Writing inferred status into the product | PRA-10 | `applyStatus(userId, inferred)` |
| Surfacing failures to users / dashboards | PRA-11 | `onRun(userId, run)` hook |
| **When to sync, dedup, change detection, failure capture** | **PRA-8** | **this module** |

Signals reach PRA-8 as opaque, comparable **string tokens** (`CalendarSignals`).
PRA-8 never inspects them — it only fingerprints them for change detection, so
the PRA-6/PRA-9 signal vocabulary can evolve without touching sync logic. The
one requirement on the source: emit a **deterministic** token per signal so the
fingerprint is stable across syncs.

---

## 3. Trigger model

A sync is *requested* by one of five triggers; `decideSync` decides whether the
request actually runs:

| Trigger | Fires when | Intent |
| --- | --- | --- |
| `scheduled` | A periodic background/cron tick | Routine freshness |
| `app_foreground` | User opens/foregrounds the app | Freshen on the surface a user is about to see |
| `connect` | User completes the Google connection (PRA-7) | Reflect the new account immediately |
| `reconnect` | Token is re-authorized after a failure | Recover after an outage |
| `manual` | User taps an explicit "refresh now" | On-demand |

This is a **hybrid** model: an event-driven surface (foreground / connect /
manual) layered on a low-frequency scheduled backstop. The events give timely
updates when a user is active; the schedule covers users who aren't. All of them
pass through the same guard, so no trigger can cause runaway sync activity.

---

## 4. Cadence (proposed — the project's open question)

Defaults in `DEFAULT_SYNC_CONFIG`; every value is a **recommendation to
confirm**, not a settled decision.

| Setting | Default | Meaning |
| --- | --- | --- |
| `minIntervalMs` | **15 min** | Hard floor between any two syncs — the anti-repeat guard. |
| `scheduledIntervalMs` | **6 h** | Routine cadence for the `scheduled` trigger. |
| `maxStalenessMs` | **24 h** | Backstop: past this, an eligible trigger forces a sync. |
| `lookaheadDays` | **14** | How far ahead the window looks. |

`decideSync` precedence (see the doc-comment in the module for the exact order):

1. Never synced successfully → **sync** (`first_sync`).
2. Inside the 15-min floor → **skip** (`within_min_interval`) — *except* a
   brand-new `connect`, which always runs.
3. A forced trigger (`manual` / `connect` / `reconnect`) past the floor →
   **sync** (`forced_trigger`).
4. Older than 24 h → **sync** (`stale`).
5. Past the 6-h cadence → **sync** (`due`).
6. Otherwise → **skip** (`not_due`).

**Rationale.** Out-of-town status is a near-term, day-granular signal; a 6-hour
routine cadence with a same-day staleness backstop keeps it fresh without
polling aggressively, and the foreground/connect/manual triggers cover the
moments a user actually cares. The 15-minute floor is what satisfies the AC
"avoids unnecessary repeated sync activity" for bursty triggers (rapid
foregrounding, repeated manual taps). `nextScheduledSyncAt(state)` lets a
scheduler arm its next timer from the last success.

---

## 5. Change detection (the second anti-repeat guard)

Passing the trigger guard means we *fetch*. It does **not** mean we do the
expensive downstream work (inference, status writes, and the notifications
those cascade into). After each fetch, `computeSignalFingerprint(signals)`
produces an **order-independent** key over the signal set:

- Fingerprint **equals** the last successful sync's → the calendar hasn't
  changed. `runSync` records a successful no-op (`result: 'unchanged'`),
  refreshes `lastSuccessAt`, and **skips infer + apply**.
- Fingerprint **differs** → run inference and apply.

So a user whose calendar is quiet costs one cheap fetch + hash per sync and zero
writes, no matter how many triggers fire. Reordering the same events never
counts as a change; adding, removing, or altering any signal does.

---

## 6. Failure detection

Every path is observable — the AC "failures in the sync path can be detected."

- **`runSync` never throws.** A throw from `fetchSignals`, `infer`, or
  `applyStatus` (or a failed state write) is caught and returned as a typed
  `SyncRun` with `result: 'failed'`, the `stage` it died in (`fetch` | `infer`
  | `apply` | `persist`), and the `error` message.
- **State carries the health signal.** On failure, `SyncState` records
  `lastFailureAt`, increments `consecutiveFailures`, and stores `lastError`; a
  success resets the counter and clears the error. A rising
  `consecutiveFailures` is the alarm a monitor watches (e.g. token revoked →
  every `fetch` fails until `reconnect`).
- **`onRun(userId, run)`** fires once per run — skips, unchanged, applied, and
  failed alike — as the hand-off to **PRA-11**, which owns user-visible error
  states, dashboards, and alerting. PRA-8 makes failures *detectable*; PRA-11
  makes them *visible and recoverable*.

---

## 7. The sync run

`runSync(userId, trigger, deps, config)` composes:

```
decideSync ──skip──▶ SyncRun{skipped, reason}
     │ sync
     ▼
computeWindow ─▶ fetchSignals ──throw──▶ SyncRun{failed, stage:'fetch'}   (PRA-7)
     │ ok
     ▼
computeSignalFingerprint
     │ equals last ──▶ persist success ─▶ SyncRun{unchanged}
     │ differs
     ▼
infer ──throw──▶ SyncRun{failed, stage:'infer'}                           (PRA-9)
     │ ok
     ▼
applyStatus ──throw──▶ SyncRun{failed, stage:'apply'}                     (PRA-10)
     │ ok
     ▼
persist success (fingerprint stored) ─▶ SyncRun{applied, changedDays}
```

---

## 8. Persistence contract

Sync state is reached through an injected `SyncStateStore` (`get` / `set`)
rather than a hard-wired table, for the same reason `analytics.ts` doesn't bundle
a vendor: the **physical home** of this state is a coordination point.

- It most naturally lives next to **PRA-7's** per-user Google connection record
  (one row per connected user: token metadata + sync bookkeeping), or as a
  dedicated `calendar_sync_state` table if PRA-11 wants sync history separate
  from connection.
- **PRA-10** must add a calendar-derived `source` to the `status_updated`
  taxonomy (`services/analytics.ts`) — e.g. `google_calendar` — so
  automatically-applied days are distinguishable from manual ones in reporting.

The `SyncState` / `SyncStateStore` shapes are the stable contract regardless of
where the rows land.

---

## 9. Time zones

The window and inferred `date`s are day-granular and currently derived in the
host's local time zone (`computeWindow`). Which zone defines a user's "day" for
out-of-town status is a **cross-cutting decision** shared with PRA-9/PRA-10 (a
server-run `scheduled` sync has no user device zone). Flagged, not resolved
here — see §10.4.

---

## 10. Open questions

1. **Cadence values (§4).** Confirm 6 h routine / 24 h staleness / 15 min floor
   / 14-day lookahead. These drive freshness vs. API-quota trade-offs and want
   product + Google-quota sign-off.
2. **Scheduled trigger host.** Where does the `scheduled` tick come from —
   Expo background fetch (client, unreliable when the app is closed) or a
   server-side cron over connected users (reliable, but needs server-held
   tokens from PRA-7)? This decision gates whether "often enough" is actually
   achievable and is the biggest dependency on PRA-7.
3. **Persistence home (§8).** Fold sync state into PRA-7's connection row or a
   separate `calendar_sync_state` table (PRA-11's call).
4. **Time zone of record (§9).** Device zone vs. a stored per-user zone vs.
   event-local zones. Must be settled with PRA-9/PRA-10 before inference dates
   are trustworthy.
5. **Failure → user story.** After N consecutive failures (token revoked), what
   does the user see and how do they re-`connect`? Owned by PRA-11; PRA-8
   already exposes the `consecutiveFailures` / `onRun` signal it needs.
6. **Conflict with manual edits.** When a user has manually set a day that a
   later sync would overwrite, does calendar inference win? This is PRA-10's
   apply policy, but it shapes what `applyStatus` reports back as `changedDays`.
