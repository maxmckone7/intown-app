# Calendar Sync — Error Handling & Observability

**Issue:** PRA-11 · **Project:** [Google Calendar Sync](https://linear.app/rideshare-company/project/google-calendar-sync-5f8b97d822e3) · **Status:** Definition (feature unbuilt)

Defines the reliability work for Google Calendar sync: how connection and sync
**failures** are captured for troubleshooting, which failures are shown to the
user, how **revoked access** and **recurring** failures are identified, and the
observability needed to validate the integration's health after launch.

This is delivery area 6 (*Reliability, error handling, and observability*) of the
project. It owns the *failure* and *health* surface across the other areas — it
does **not** define the OAuth flow itself ([PRA-7](https://linear.app/rideshare-company/issue/PRA-7)),
the sync/trigger model ([PRA-8](https://linear.app/rideshare-company/issue/PRA-8)),
which events count as out-of-town ([PRA-6](https://linear.app/rideshare-company/issue/PRA-6)),
the inference logic ([PRA-9](https://linear.app/rideshare-company/issue/PRA-9)),
or the status write-back ([PRA-10](https://linear.app/rideshare-company/issue/PRA-10)).
It specifies the error taxonomy, capture records, user-visible states, and
telemetry those areas must emit into.

Like [the reminder-notification instrumentation spec](./reminder-notification-instrumentation.md),
the typed events belong in `services/analytics.ts`; keep the two in sync. Where a
signal can be emitted today it says so — but almost nothing here can be, because
the sync feature is not built yet (§1).

---

## 1. Current state

**What exists in the app today**

- **Manual status only.** In/out status is a user-tapped calendar day persisted
  through `calendarService.setEntry` (`services/calendar.ts:25`) into
  `calendar_entries` (`database/schema.sql:51`). There is no `source` column, so
  a sync-written status is today indistinguishable from a manual one — a gap
  [PRA-10](https://linear.app/rideshare-company/issue/PRA-10) must close and this
  spec depends on (§3, §7).
- **An analytics seam.** `services/analytics.ts` exposes a typed `track()` with a
  pluggable sink (dev-only console + in-memory buffer until a sink is wired). This
  is where the `calendar_sync_*` family in §6 must be defined.
- **Precedent for a "revoked" lifecycle state.** `invites.status` and
  `friendships.status` already model `revoked`/lifecycle states in
  `database/schema.sql`; the OAuth-connection record ([PRA-7](https://linear.app/rideshare-company/issue/PRA-7))
  should follow the same convention (§5).
- **User-visible state primitives.** `components/StateFeedback.tsx` (title + body
  + primary/secondary actions) and `components/ToastProvider.tsx` are the two
  building blocks the failure states in §4 reuse — no new UI framework is needed.

**What does not exist yet (so nothing here is emitted today)**

- No Google OAuth connection, no stored calendar credentials, no connection
  record (PRA-7).
- No sync worker, scheduler, or trigger — nothing fetches calendar data (PRA-8).
- No inference or status write-back (PRA-9 / PRA-10).
- No error store, no sync-run log, no health dashboard, no `calendar_sync_*`
  events.

**What this issue adds**

- A **failure taxonomy** (§2) both the connection and sync paths raise into.
- A **capture model** (§3) — the `calendar_sync_runs` record + a correlation id —
  that makes a failure troubleshootable.
- **User-visible failure states** (§4), defined only where a user must act.
- **Revoked-access and recurring-failure detection** rules (§5).
- The **observability** definition — health metrics, `calendar_sync_*` events,
  and alerts — to validate the integration after launch (§6).

---

## 2. Failure taxonomy

Every connection or sync failure maps to exactly one `failure_code`. The code is
what gets logged (§3), what decides whether the user sees anything (§4), and what
the health dashboard groups by (§6). Codes are stable strings — new causes get a
new code rather than overloading an existing one.

Dimensions carried on each failure:

- **`stage`** — `connect` (OAuth/authorization) or `sync` (fetch/evaluate). Owned
  by PRA-7 and PRA-8 respectively; this spec defines the shared shape.
- **`retryable`** — can an automatic retry plausibly succeed without the user?
- **`terminal`** — does this stop future syncs until the user re-acts (re-auth /
  reconnect)?
- **`user_visible`** — does the user see a state now (§4), or is it captured
  silently until it recurs (§5)?

### 2.1 Connection failures (`stage: connect`) — owned by PRA-7

| `failure_code` | Cause | Retryable | Terminal | User-visible |
| --- | --- | --- | --- | --- |
| `connect_user_denied` | User declined the OAuth consent screen | no | n/a | yes — inline on the connect screen |
| `connect_missing_scope` | User granted sign-in but **not** calendar read scope | no | n/a | yes — must re-consent with scope |
| `connect_oauth_error` | Google returned an OAuth error / invalid exchange | yes (bounded) | no | yes — "couldn't connect, try again" |
| `connect_network` | Network/timeout during the token exchange | yes | no | yes — transient retry |
| `connect_token_persist_failed` | Token obtained but our store write failed | yes | no | yes — treated as connect failure |

### 2.2 Sync failures (`stage: sync`) — owned by PRA-8

| `failure_code` | Cause | Retryable | Terminal | User-visible |
| --- | --- | --- | --- | --- |
| `sync_auth_revoked` | Google returns 401/`invalid_grant` — access revoked or credentials expired past refresh | no | **yes** | yes — via §5 (reconnect banner) |
| `sync_scope_downgraded` | Token still valid but calendar scope no longer present | no | **yes** | yes — reconnect with scope |
| `sync_rate_limited` | Google 429 / quota exhausted | yes (backoff) | no | no (unless recurring, §5) |
| `sync_google_5xx` | Google Calendar API 5xx / unavailable | yes (backoff) | no | no (unless recurring, §5) |
| `sync_network` | Network/timeout reaching Google | yes | no | no (unless recurring, §5) |
| `sync_partial` | Some calendars/pages fetched, others failed | yes (next run) | no | no |
| `sync_evaluate_error` | Inference (PRA-9) threw on the fetched data | no | no | no — logged for us, not the user |
| `sync_writeback_failed` | Inference produced a result but the status write (PRA-10) failed | yes | no | no (unless recurring, §5) |
| `sync_internal` | Uncaught/unclassified error in the sync path | yes | no | no |

**Design rules**

- A **transient** sync failure (`rate_limited`, `google_5xx`, `network`,
  `partial`, `writeback_failed`) is **not** shown on first occurrence — it is
  captured and left to retry. It becomes user-visible only when it **recurs**
  past the threshold in §5. This is the "recurring sync failures can be
  identified" acceptance criterion.
- A **terminal** failure (`auth_revoked`, `scope_downgraded`) is surfaced
  promptly (§4/§5) because no retry can fix it — only the user can.
- `sync_evaluate_error` / `sync_internal` are **our** bugs, not the user's; they
  are logged and alerted (§6) but never shown as "your calendar failed."

---

## 3. Capture model — making a failure troubleshootable

> **Acceptance criterion:** *Connection and sync failures are captured in a way
> that supports troubleshooting.*

Every sync attempt writes one **`calendar_sync_runs`** record — success or
failure — so a failure is never a bare log line but a queryable row with enough
context to reproduce it. (Table proposed here; PRA-8 owns the migration, matching
the `TIMESTAMP WITH TIME ZONE DEFAULT NOW()` conventions in `database/schema.sql`.)

| Field | Purpose |
| --- | --- |
| `id` | PK |
| `run_id` | **Correlation id** stamped on every log line, event, and (if any) status write for this attempt. The single string you search on to trace one run end to end. |
| `user_id` | Whose connection ran |
| `connection_id` | The OAuth connection used (FK to PRA-7's record) |
| `trigger` | What started it: `scheduled` \| `event_push` \| `manual_reconnect` \| `initial_backfill` (mirrors PRA-8's trigger model) |
| `started_at` / `finished_at` | Timing; `finished_at - started_at` is the latency metric in §6 |
| `outcome` | `success` \| `no_change` \| `failed` |
| `failure_code` | One code from §2 when `outcome = failed`, else null |
| `failure_detail` | Redacted provider message / HTTP status — **never** tokens or event contents (§7) |
| `http_status` | Upstream status when applicable (401/429/5xx) |
| `events_scanned` | How many calendar events were evaluated (0 on early failure) |
| `statuses_written` | How many `calendar_entries` this run changed (feeds §6) |
| `attempt` / `retry_of` | Retry depth and the `run_id` this retries, so a retry chain is reconstructable |

**Correlation.** `run_id` is generated at the start of a run and threaded through
`track()` calls (§6) and the eventual status write (`status_updated.source =
'calendar_sync'`, `run_id` — the counterpart PRA-10 must set). This is what lets
"a user's status flipped unexpectedly" be traced back to the run, the events it
saw, and the rule that fired.

**Retention & failure surface.** Keep run rows for a bounded window (§7); a
`failed` run should also emit `calendar_sync_failed` (§6) so alerting doesn't
depend on scanning the table. `failure_detail` is captured **redacted** — status
codes and provider error identifiers, never bearer tokens or calendar content.

---

## 4. User-visible failure states

> **Acceptance criterion:** *User-visible failure states are defined where needed.*

Defined **only where the user must act or would otherwise be misled**. Transient,
self-healing failures get no UI (§2 rules). All states reuse
`components/StateFeedback.tsx` (blocking) or `components/ToastProvider.tsx`
(transient), living on a *Connected calendar* section of the profile screen
(`app/(tabs)/profile.tsx`, alongside the existing notification settings).

| State | Trigger (`failure_code`) | Surface | Primary action | Intent |
| --- | --- | --- | --- | --- |
| **Connection failed** | `connect_oauth_error`, `connect_network`, `connect_token_persist_failed` | Inline on connect screen | *Try again* | Transient — retry connect |
| **Calendar access needed** | `connect_missing_scope`, `connect_user_denied` | Inline on connect screen | *Grant calendar access* | Re-run consent asking for the read scope; explain why it's needed |
| **Reconnect required** | `sync_auth_revoked`, `sync_scope_downgraded` (terminal) | Persistent banner on profile + status area | *Reconnect Google Calendar* | Access is gone; auto-sync is paused until reconnect (§5) |
| **Sync having trouble** | Any transient sync code **recurring** past threshold (§5) | Non-blocking notice on the connected-calendar section | *Retry now* / *See details* | We're retrying; your status may be stale. Not alarming, honest |
| **Auto-sync paused** | Recurring failure disabled sync (§5) | Same banner as *Reconnect required*, worded for the transient case | *Resume auto-sync* | Sync was paused after repeated failures; let the user re-enable |

**Cross-cutting UX rules**

- **Never silently show wrong status.** A sync-written status must be
  distinguishable (`source`, §3/§7) so the UI can label it and, when sync is
  known-broken, indicate the status may be stale rather than presenting it as
  fresh truth. Aligns with the project's "avoid stale or obviously incorrect
  status" non-functional requirement.
- **One nag, not many.** The terminal/paused banner is shown once and persists;
  it does not re-alert per failed run.
- **Manual override always wins.** A user can still set status by hand regardless
  of sync state; sync failing must never block the manual path
  (`calendarService.setEntry`).

---

## 5. Revoked access & recurring failure detection

> **Acceptance criteria:** *Revoked access and recurring sync failures can be
> identified.*

### 5.1 Revoked / expired access (terminal)

- **Signal:** any run failing `sync_auth_revoked` or `sync_scope_downgraded`
  (Google `401` / `invalid_grant`, or a token whose scope no longer covers
  calendar read).
- **Identification:** the OAuth connection record (PRA-7) carries a `status`
  following the existing `revoked` precedent
  (`invites`/`friendships` in `database/schema.sql`):
  `active` → `needs_reauth` → `revoked`. The first terminal sync failure moves it
  to `needs_reauth` and **pauses scheduling** for that connection.
- **Response:** show *Reconnect required* (§4); stop scheduling further syncs (no
  point retrying a revoked token — also serves the "avoid excessive sync
  activity" NFR); on successful reconnect (PRA-7), return to `active` and resume.

### 5.2 Recurring transient failures

A single transient failure is noise; a *streak* is a problem worth surfacing and
alerting.

- **Per-connection counter:** track `consecutive_failures` on the connection.
  Reset to 0 on any `success`/`no_change` run; increment on any `failed` run.
- **User-visible threshold — proposed ≥ 3 consecutive failed runs** (or no
  success in ~24h, whichever first): show *Sync having trouble* (§4). Numbers to
  confirm in §7 once PRA-8 sets the sync cadence.
- **Auto-pause threshold — proposed ≥ 8 consecutive** (or ~72h with no success):
  pause auto-sync, show *Auto-sync paused* (§4), and emit the health alert (§6).
  Prevents an indefinitely broken connection from syncing (and burning quota)
  forever.
- **Fleet-wide recurrence** (many connections failing at once) points at *our*
  side or a Google outage, and is detected in §6, not per-user.

---

## 6. Observability — validating integration health

> **Acceptance criterion:** *Observability is sufficient to validate the health
> of the integration after launch.*

### 6.1 Telemetry events (`calendar_sync_*`)

Added to `AnalyticsEventMap` in `services/analytics.ts` (typed, non-throwing;
mirror them in this doc). Every event carries `run_id` (§3) for correlation.

| Event | Fires when | Key properties |
| --- | --- | --- |
| `calendar_connection_started` | User begins OAuth connect | `user_id`, `trigger` |
| `calendar_connection_result` | Connect resolves | `user_id`, `outcome` (`success`\|`failed`), `failure_code?` |
| `calendar_sync_started` | A sync run begins | `run_id`, `user_id`, `connection_id`, `trigger` |
| `calendar_sync_succeeded` | Run completes | `run_id`, `user_id`, `events_scanned`, `statuses_written`, `duration_ms` |
| `calendar_sync_failed` | Run fails | `run_id`, `user_id`, `stage`, `failure_code`, `http_status?`, `attempt` |
| `calendar_sync_recovered` | First success after a failure streak | `run_id`, `user_id`, `previous_consecutive_failures` |
| `calendar_access_revoked` | Connection → `needs_reauth`/`revoked` (§5.1) | `user_id`, `connection_id`, `failure_code` |
| `calendar_sync_auto_paused` | Auto-pause threshold hit (§5.2) | `user_id`, `connection_id`, `consecutive_failures` |

`calendar_sync_started/succeeded/failed` are the emitted twin of the
`calendar_sync_runs` row (§3): the table is the queryable system of record, the
events are the low-latency stream feeding dashboards and alerts without scanning
the table.

### 6.2 Health metrics (post-launch dashboard)

Each success measure the project needs to trust the integration, and how to
compute it from the above:

- **Connection success rate** — `connection_result{success} / connection_started`.
  Sliced by `failure_code` to see *why* connects fail (denied vs missing scope vs
  transient). Validates "a user can complete connection successfully."
- **Sync success rate** — `sync_succeeded / (sync_succeeded + sync_failed)`, over
  time and by `failure_code`. The top-line health number.
- **Sync latency** — distribution of `duration_ms` (p50/p95). Watches the
  "within the expected sync window" success measure alongside PRA-8's cadence.
- **Time-to-status / freshness** — `started_at` → status write, and share of
  active connections with a successful run in the last cadence window. Catches
  silently-stale connections that aren't erroring but aren't updating either.
- **Revocation & pause rates** — `access_revoked` and `sync_auto_paused` per
  active connection. A rising trend means users are losing sync without noticing.
- **Recovery** — `sync_recovered` vs `sync_failed`: are streaks self-healing or
  sticking?
- **Write volume** — `statuses_written` per run: near-zero everywhere may mean
  broken inference (PRA-9); spikes may mean over-eager rules.

### 6.3 Alerts

- **Fleet failure spike** — `sync_failed` rate crosses a baseline (esp.
  `sync_google_5xx` / `sync_rate_limited` clustering) → likely Google outage or
  our quota/credential problem. Distinguishes systemic from per-user.
- **Internal-error alert** — any `sync_evaluate_error` / `sync_internal` above a
  low floor → our bug; page us, don't wait for users.
- **Connection-success cliff** — connect success rate drops → OAuth
  config/credential regression (PRA-7).
- **Auto-pause surge** — spike in `sync_auto_paused` → widespread breakage.

Thresholds are set once baselines exist post-launch; the events above are the
prerequisite.

---

## 7. Open questions

1. **`source` on `calendar_entries` (blocks §3/§4).** There is no way today to
   tell a sync-written status from a manual one. PRA-10 must add a `source`
   (`manual` \| `calendar_sync`) and carry `run_id`, or observability can't
   attribute status changes and the UI can't label them. Confirm ownership:
   PRA-10 writes it, PRA-11 consumes it.
2. **Recurrence thresholds (§5.2).** Proposed ≥3 (notify) / ≥8 (auto-pause), or
   24h/72h without success. These depend on PRA-8's sync cadence — a 15-minute
   sync and a 6-hour sync imply very different "3 in a row." Confirm once cadence
   lands.
3. **Retry/backoff policy (§2).** Owned by PRA-8, but the taxonomy assumes bounded
   exponential backoff for `rate_limited`/`5xx`/`network`. Confirm max attempts
   and backoff so `attempt`/`retry_of` (§3) mean something consistent.
4. **`failure_detail` redaction (§3).** Confirm the redaction rule (status codes +
   provider error ids only; never tokens or event titles/attendees). Ties into the
   project's "credentials handled securely" NFR and to PRA-7's token storage.
5. **Sync-run retention.** How long to keep `calendar_sync_runs` — long enough to
   troubleshoot, short enough to bound PII (calendar-derived) exposure. Proposed:
   ~30 days of run metadata, no event contents ever stored.
6. **Analytics sink.** Same open item as the reminder spec: no sink is wired
   (`configureAnalytics`), so `calendar_sync_*` events buffer/log only until a
   destination (PostHog / Segment / a Supabase `analytics_events` table) is
   chosen. Health dashboards (§6) can't exist until then.
7. **Do we notify on terminal failure out-of-app?** §4 covers in-app banners. If
   a user rarely opens the app, a revoked connection could sit broken for weeks.
   Should `calendar_access_revoked` also send a push/email (reusing the
   notification infrastructure)? Product decision.
