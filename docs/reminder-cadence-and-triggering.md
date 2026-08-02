# Reminder Cadence & Triggering Rules

**Issue:** PRA-1 · **Project:** Reminders & Notifications · **Status:** Definition (no build)

Defines the product and system rules for **when a status-freshness reminder is
sent** — a nudge to a user to keep *their own* in/out status current. Covers the
default cadence, the supported triggers, and the guardrails that keep reminders
from becoming noisy. Aligns with the
[PRD](https://linear.app/rideshare-company/project/reminders-and-notifications-dd5d5db0e81d):
the product is only useful when status data is fresh, and reminders are the lever
for freshness "at appropriate moments … rather than feeling noisy or mandatory."

This is a rules spec, not an implementation. Nothing here is built yet (§1). It
constrains the work that follows — delivery (PRA-2), preferences (PRA-3), and it
consumes the already-defined instrumentation vocabulary (PRA-5).

---

## 1. Current state

**Status-freshness reminders do not exist.** There is no scheduler, no reminder
record, and nothing that decides when to nudge a user. The reminder *event
vocabulary* was defined ahead of the feature by PRA-5 and is the contract this
spec is written against:

- `ReminderType = 'weekly' | 'pre_weekend'` (`services/analytics.ts:39`).
- Lifecycle events `reminder_scheduled` / `_delivered` / `_opened` / `_dismissed`,
  each carrying `reminder_id`, `user_id`, `reminder_type`, `channel`, and
  (for `_scheduled`) `scheduled_for` (`services/analytics.ts:61`). Defined,
  **not yet emitted** — there is nothing to emit them.
- Channels are `push | email` (`DeliveryChannel`, `services/analytics.ts:41`).

**What already exists is a different thing — friend-status coordination
notifications**, and it is worth being precise about the difference because they
are easy to conflate:

| | Status-freshness reminder (this issue) | Friend-status coordination notification |
| --- | --- | --- |
| Recipient | The user themselves | The user's friends |
| Prompts | "Update *your* status" | "*A friend's* status changed" |
| Purpose | Data freshness | Coordination / awareness |
| Owned by | **PRA-1** (rules), PRA-2 (delivery) | PRA-4 |
| Built? | No | Partially — DB enqueue exists |

The coordination pipeline (`enqueue_coordination_notifications` trigger,
`database/schema.sql:589`; `coordination_notification_batches` table,
`schema.sql:139`) already enqueues `weekend_in_town` / `back_in_town` batches
when a friend goes in-town. **We reuse its conventions** for scheduling and
noise-control (§6) rather than inventing new ones, but its rows are not reminders
and its `notification_type` values are not `reminder_type` values.

**Preferences gap.** `notification_preferences` (`schema.sql:102`) covers only
coordination notifications (`coordination_enabled`, `weekend_in_town_enabled`,
`back_in_town_enabled`, `delivery_channels`, `group_id`). There is **no field for
status-freshness reminders** — no opt-in, no cadence control, no channel choice.
Adding those is PRA-3's job; this spec says what they must express (§7).

---

## 2. What this issue owns (and defers)

**Owns:** the decision logic for *whether and when* a status-freshness reminder
should fire for a given user at a given time — cadence (§3), triggers (§4),
suppression (§5), and the timing model those rules assume (§6).

**Defers:**

- **Delivery** — channel fan-out, the send worker, retries, quiet-hours
  *enforcement at send time* → **PRA-2**. This spec defines the quiet-hours
  *rule*; PRA-2 enforces it.
- **User controls** — opt-in/opt-out, per-type toggles, cadence preferences, the
  schema to store them → **PRA-3**. §7 lists the fields PRA-3 must add.
- **Friend-status change notifications** → **PRA-4** (already has the DB enqueue).
- **Instrumentation** — the event taxonomy and reporting → **PRA-5** (done). This
  spec's rules must emit those events (§8).
- **The freshness definition** — "what counts as sufficiently fresh?" is a shared
  open question flagged by both the PRD and PRA-5
  (`docs/reminder-notification-instrumentation.md` §7 Q1). It is a **dependency**
  of the skip-if-fresh guardrail (§5.2), not something PRA-1 resolves alone (§9).

---

## 3. Default reminder cadence

**Default: at most one status-freshness reminder per user per rolling 7 days**,
timed to land just before the weekend.

Rationale: the product's centre of gravity is weekend coordination — the only
positive coordination notification today is `weekend_in_town`
(`schema.sql:647`), and the highest-value moment for fresh data is heading into a
weekend. One well-placed weekly nudge is the smallest cadence that keeps status
fresh for that moment; a hard weekly cap (§5.1) is what keeps "one nudge" from
degrading into noise as more triggers are added.

The default cadence is realised by the **pre-weekend trigger** (§4.2) as the
standard weekly slot. The plain **weekly trigger** (§4.1) is the alternative
scheduled cadence for users/segments where a fixed day/time is preferred over a
weekend-relative one. **Whether the default should be the contextual pre-weekend
trigger or the fixed weekly trigger is the AC's flagged open question** — see §9
Q1. Recommendation: default to **pre-weekend**, keep **weekly** as the
fallback/configurable alternative.

Concrete defaults (all **decisions to confirm**, §9):

| Parameter | Default | Note |
| --- | --- | --- |
| Reminders per user per 7 days | **1** (hard cap) | §5.1 |
| Default trigger | `pre_weekend` | §4.2 |
| Default fire time | **Thursday 18:00, user-local** | Ahead of the weekend, inside quiet-hours window |
| `weekly` alternative fire time | **Sunday 18:00, user-local** | Sets up the coming week |
| Delivery window (quiet hours) | **09:00–21:00 local** | §5.3 |

---

## 4. Supported triggers

Two trigger types, matching the `ReminderType` enum exactly
(`services/analytics.ts:39`). Staying inside the enum keeps the instrumentation
and any future preference schema stable — **new trigger types are out of scope**
for this issue (candidates noted in §4.3).

### 4.1 `weekly` — scheduled recurring

A fixed weekly cadence: same weekday and local time each week (default Sunday
18:00 local, §3). Purely time-based — fires regardless of what is on the horizon.
Predictable and simple; the baseline that guarantees *some* cadence even in weeks
with no salient context.

- **Anchor:** user-local weekday + time.
- **`scheduled_for`:** the next occurrence of that weekday/time.
- Subject to every guardrail in §5 (notably skip-if-fresh and the weekly cap).

### 4.2 `pre_weekend` — contextual (upcoming weekend)

Fires ahead of each weekend to prompt "are you around this weekend?" — the nudge
most aligned with the product's coordination value. Contextual because it is
anchored to the *upcoming weekend*, not a fixed calendar slot.

- **Anchor:** the upcoming weekend. Reuse the coordination trigger's weekend
  definition — ISO day-of-week Fri–Sun (`EXTRACT(ISODOW …) BETWEEN 5 AND 7`,
  `schema.sql:613,647`) so "weekend" means the same thing across the product.
- **`scheduled_for`:** default Thursday 18:00 local of the week containing that
  weekend — early enough to act, late enough to be relevant.
- **Skip-if-fresh is central here (§5.2):** if the user's Sat **and** Sun status
  is already set, the reminder is pointless — suppress it. This is the single
  biggest noise reducer for this trigger.

### 4.3 Out of scope (future contextual triggers)

Noted so the boundary is explicit; **not** part of this issue and **not** in the
`ReminderType` enum. Each would need its own definition + an enum extension:

- **Status-expiry / stale-status** — no update in *N* days.
- **Return-from-out-of-town** — a set `out_of_town` span has ended.
- **Pre-holiday** — long weekends / holidays (needs a calendar source).

---

## 5. Suppression & noise guardrails

Ordered roughly by how much noise each removes. A reminder fires only if it
survives **all** of them. Guardrails marked *(enforced by PRA-2)* are decided
here but applied at delivery time.

### 5.1 Weekly frequency cap (hard)

**At most one status-freshness reminder per user per rolling 7 days**, across
*all* trigger types. If both a `weekly` and a `pre_weekend` reminder resolve for
the same window, they **collapse to one** and `pre_weekend` wins (it is the more
relevant of the two). This cap is what makes "add another trigger later" safe.

### 5.2 Skip-if-already-fresh

**Do not remind a user whose status is already fresh for the horizon the reminder
covers.** A reminder to update data that is already current is pure noise and the
most common way these systems annoy people.

- `pre_weekend`: suppress if the user already has a `calendar_entries` status for
  **both** upcoming Sat and Sun (`schema.sql:51`).
- `weekly`: suppress if the user's status was updated within the cadence window
  (`calendar_entries.updated_at`, `schema.sql:65`).
- **Depends on the shared freshness definition** (§9 Q4). The rules above are the
  interim/coverage-based reading; they tighten once "fresh" is pinned down.
- Count only user-authored freshness. `calendar_entries.source = 'manual'`
  (`schema.sql:60`) is authoritative; `calendar_inferred` rows (Google Calendar
  Sync, PRA-10) should **not** by themselves mark a user "fresh" enough to skip a
  reminder — confirm with PRA-10 (§9 Q5).

### 5.3 Quiet hours *(enforced by PRA-2)*

Never **deliver** outside the local delivery window (default 09:00–21:00, §3). A
reminder that resolves outside the window is **deferred to the next in-window
slot**, not dropped — unless deferring would push it past the moment it was for
(e.g. a `pre_weekend` reminder that can't be delivered before the weekend is
dropped, not sent late). Requires a per-user timezone (§9 Q3).

### 5.4 Respect preferences & opt-out *(schema from PRA-3)*

If the user has disabled status-freshness reminders, **none fire** — master off ⇒
zero reminders. Per-cadence control (e.g. keep pre-weekend, drop weekly) is
honoured if PRA-3 exposes it. No self-reminder preference exists today (§1); until
PRA-3 ships, treat reminders as **off by default** (opt-in), consistent with
`coordination_enabled` defaulting `FALSE` (`schema.sql:104`).

### 5.5 Recent-activity cooldown

Suppress if the user updated *any* status very recently (default: within 24h of
the intended fire time) — they are already engaged; a nudge is redundant. Distinct
from §5.2, which is about the horizon being covered rather than recent activity.

### 5.6 Engagement backoff

After **3 consecutive reminders delivered with no open and no status update**,
reduce that user's cadence (default: pause `weekly`, keep only `pre_weekend`; after
3 more ignored, pause reminders and re-evaluate). **Reset the counter** on any
`reminder_opened` or `status_updated`. Protects against nagging users who have
effectively churned, and shows up as a healthy (not alarming) opt-out rate in M4
(`docs/reminder-notification-instrumentation.md` §5). Needs the ignored-streak
state in §7.

### 5.7 Onboarding / no-value guard

Don't remind users for whom a fresh status has no audience yet:

- **Grace period** after signup (default 48h) — let them finish onboarding first.
- **No accepted friends** — with no one to coordinate with, a freshness nudge has
  no payoff. Suppress until the user has ≥1 `accepted` friendship
  (`friendships.status = 'accepted'`, `schema.sql:45`).

---

## 6. Timing & scheduling model

Reuse the coordination trigger's conventions so scheduling behaves consistently
across the product:

- **Horizon-anchored, floored to a minimum lead.** The coordination trigger
  schedules `send_after = GREATEST(NOW() + 15 min, weekend_start − 18h)`
  (`schema.sql:659`). Reminders follow the same shape: compute the intended fire
  time from the anchor (§4), then floor it at `NOW() + short buffer` so a
  late-resolving reminder still goes out promptly rather than being skipped.
- **Idempotent per window.** The coordination queue dedupes on a deterministic
  `batch_key` (`recipient:type:group:start:end`, `schema.sql:524`) so re-runs
  don't double-send. A reminder scheduler needs the same: a deterministic key per
  `(user, reminder_type, window)` so re-evaluation is safe and the §5.1 cap is
  enforceable by construction.

### Timezone — a real gap, not a detail

Every timing rule above is **user-local** ("Thursday 18:00 local", quiet hours).
But **no per-user timezone is stored** — `users` has `location TEXT`
(`schema.sql:13`) but no timezone — and the existing coordination trigger computes
its schedule in **UTC** (`weekend_start::TIMESTAMP AT TIME ZONE 'UTC'`,
`schema.sql:661`). Delivering a "Thursday evening" nudge off a UTC clock lands it
at the wrong local time for most users. Resolving this (store an IANA tz, or infer
from `location`, or pick a sensible default) is a **hard dependency** for correct
cadence — §9 Q3.

---

## 7. State the scheduler will need (informs PRA-2 / PRA-3)

Not built here, but the rules above imply state a future reminder record /
scheduler must hold. Called out so PRA-2 (build) and PRA-3 (preferences) design
for it:

- **Per reminder:** `reminder_id` (correlates the PRA-5 lifecycle), `user_id`,
  `reminder_type`, `scheduled_for`, `channel`, status (`scheduled`/`delivered`/
  `opened`/`dismissed`/`suppressed`) and a suppression reason for §5 auditing.
- **Deterministic window key** per `(user, reminder_type, window)` for idempotency
  + the §5.1 cap (§6).
- **Per user (freshness/backoff):** `last_reminded_at` (weekly cap, cooldown) and
  `consecutive_ignored` (§5.6 backoff, reset on open/update).
- **Preferences PRA-3 must add** to `notification_preferences`: a master
  `status_reminders_enabled` (opt-in), optional per-cadence toggles
  (`weekly_enabled` / `pre_weekend_enabled`), and a reminder channel selection
  (reuse the `push | email` `delivery_channels` shape / constraint,
  `schema.sql:107,111`).

---

## 8. Instrumentation hooks

The rules here are the source of the PRA-5 reminder funnel; no new events are
needed. When the scheduler is built it must emit
(`docs/reminder-notification-instrumentation.md` §3.1):

- `reminder_scheduled` when a reminder survives §5 and is queued — with the
  `reminder_type` and `scheduled_for` this spec computes.
- `reminder_delivered` at send (PRA-2).
- `reminder_opened` / `reminder_dismissed` on user action.
- A **suppression** signal is worth adding so §5 is measurable (how often
  skip-if-fresh / cap / quiet-hours fire) — flagged for PRA-5/PRA-2, since
  suppression rate is the direct evidence that the noise guardrails work (feeds
  M4). Not adding it silently: it's a small gap in the current taxonomy.

---

## 9. Open questions & dependencies

1. **Scheduled vs. contextual as the default (the AC's flagged choice).** Should
   the default cadence be the contextual `pre_weekend` trigger or the fixed
   `weekly` one? Both are supported (§4); the question is which is on by default.
   **Recommendation: `pre_weekend`** — it targets the product's actual
   coordination moment — with `weekly` as the configurable alternative. Needs
   product sign-off; it also shapes PRA-3's default preference values.
2. **Concrete cadence numbers** (§3): confirm Thursday 18:00 / Sunday 18:00 fire
   times, the 09:00–21:00 quiet window, the 1-per-7-days cap, the 24h cooldown,
   and the 3-strikes backoff thresholds. All are defensible defaults, none are
   validated — the PRD notes there is *no customer evidence yet* for cadence.
3. **Per-user timezone (hard dependency, §6).** No timezone is stored and the
   existing enqueue runs in UTC (`schema.sql:661`). Local-time cadence is wrong
   until this is resolved: store an IANA tz / infer from `users.location` / pick a
   default. Blocks correct delivery timing.
4. **Freshness definition (shared dependency).** Skip-if-fresh (§5.2) needs the
   "sufficiently fresh status" rule that the PRD and
   `docs/reminder-notification-instrumentation.md` §7 Q1 leave open. Interim rule:
   pre-weekend = Sat+Sun covered; weekly = updated within the window. Confirm the
   canonical definition so this guardrail and PRA-5's M2 metric agree.
5. **Do `calendar_inferred` entries count as "fresh"? (§5.2)** Should a status
   auto-written by Google Calendar Sync (PRA-10, `source = 'calendar_inferred'`,
   `schema.sql:60`) suppress a reminder, or only user-authored `manual` status?
   Recommendation: only `manual` suppresses — inferred data is exactly what we
   might want the user to confirm. Confirm with PRA-10.
6. **Preferences ownership handoff (§7).** PRA-3 owns adding the self-reminder
   preference fields; until then reminders are **opt-in / off by default**. Confirm
   PRA-3 will model per-cadence toggles, not just a single master switch.
7. **Suppression telemetry (§8).** Add a suppression/`reminder_suppressed`
   signal to the PRA-5 taxonomy so the §5 guardrails are measurable? Recommended —
   without it, "are reminders too noisy?" can only be inferred from opt-outs.
