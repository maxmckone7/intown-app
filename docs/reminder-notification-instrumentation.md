# Reminder & Notification Instrumentation

**Issue:** PRA-5 · **Project:** Reminders & Notifications · **Status:** Definition + partial implementation

Defines the analytics events, reporting requirements, and measurement model
needed to evaluate whether reminders and notifications are working — i.e. to
answer the [PRD's success measures](https://linear.app/rideshare-company/project/reminders-and-notifications-dd5d5db0e81d):
does reminding people lead to fresher status, and do users engage with
friend-status notifications.

This is the source-of-truth spec. The typed event definitions live in
`services/analytics.ts`; keep the two in sync. Where an event is emitted today,
this doc says so; where it is *defined but not yet emitted* (because the
underlying feature isn't built), it says that too.

---

## 1. Current state

**What exists in the app today**

- **Friend-status ("coordination") notifications** — a queue
  (`coordination_notification_batches`, `database/schema.sql:125`) of batched
  `weekend_in_town` / `back_in_town` alerts with a `status`
  (`queued`/`sent`/`suppressed`), `sent_at`, and a `deep_link`
  (`services/coordinationNotifications.ts:73`). A delivery worker to actually
  send them is **not yet built** — batches are enqueued but nothing marks them
  `sent`.
- **Notification preferences** — opt-in/opt-out and channel selection
  (`notification_preferences`, `database/schema.sql:88`), edited in the profile
  screen (`app/(tabs)/profile.tsx:331`).
- **Status updates** — the user's in/out day toggles, persisted through
  `calendarService.setEntry` (`services/calendar.ts:25`) from the calendar
  (`components/MyCalendar.tsx`).
- **Deep links** — `intown:///?date=…&groupId=…`
  (`services/coordinationNotifications.ts:73`), consumed on the friends
  calendar screen (`app/(tabs)/index.tsx:157`).

**What does not exist yet (and therefore can't be emitted client-side)**

- **Status-freshness reminders** (weekly / pre-weekend nudges) — the core of the
  PRD but unbuilt. No scheduler, no reminder record, no delivery.
- **Any product-analytics SDK.** There was no instrumentation seam at all before
  this issue.

**What this issue adds**

- `services/analytics.ts` — a typed event taxonomy and a `track()` seam with a
  pluggable sink (no vendor chosen; see §6).
- Live instrumentation on the three flows that exist today (§3, marked
  **Implemented**).
- Definitions for the reminder-lifecycle and delivery events so the future
  worker/scheduler emit a stable shape (§3, marked **Defined (pending feature)**).

---

## 2. Event families

Three families map directly onto PRA-5's acceptance criteria, plus a preferences
family the PRD counts as a success measure:

| # | Family | Purpose | Success measure it feeds |
| --- | --- | --- | --- |
| 1 | `reminder_*` | Reminder scheduled → delivered → opened/dismissed | Reminder reach; funnel denominator |
| 2 | `status_updated` | A status day was refreshed, with attribution | Update rate after reminders; status freshness |
| 3 | `friend_status_notification_*` | Friend-status alert delivered → opened/dismissed | Engagement with friend-status notifications |
| — | `notification_preferences_changed` | Opt-in / opt-out and channel changes | Understandable, controllable settings |

Every event carries a `timestamp` (epoch ms, set by `track()`); the tables below
list the domain properties only.

---

## 3. Event definitions

### 3.1 Reminder lifecycle — `reminder_*` · *Defined (pending feature)*

Emitted by the (future) reminder scheduler and delivery worker, and by the
client when a reminder is opened. `reminder_id` correlates the whole lifecycle
and links a reminder to the update it drives (§4).

| Event | Fires when | Key properties |
| --- | --- | --- |
| `reminder_scheduled` | A reminder is queued for a user | `reminder_id`, `user_id`, `reminder_type` (`weekly`\|`pre_weekend`), `channel`, `scheduled_for` |
| `reminder_delivered` | Delivery worker sends it | `reminder_id`, `user_id`, `reminder_type`, `channel`, `delivered_at` |
| `reminder_opened` | User taps the reminder | `reminder_id`, `user_id`, `reminder_type`, `channel` |
| `reminder_dismissed` | User dismisses without opening | `reminder_id`, `user_id`, `reminder_type`, `channel` |

### 3.2 Reminder-driven status update — `status_updated` · *Implemented*

Fires whenever a calendar day's status is **persisted** (server-confirmed).
Emitted at `components/MyCalendar.tsx` in the save-success path with
`source: 'manual_calendar'`. Reminder attribution is done in reporting by a
delivery→update time window (§4), so an unset `reminder_id` does **not** mean
"not reminder-driven."

| Property | Meaning |
| --- | --- |
| `user_id` | Who changed their status |
| `date` | The calendar day set (`YYYY-MM-DD`) — not the event time |
| `status` | `in_town` \| `out_of_town` |
| `source` | `manual_calendar` \| `onboarding` \| `reminder` \| `notification` |
| `reminder_id?` | Set only for a direct, same-session continuation of a reminder |

`source` values other than `manual_calendar` are wired as their flows ship (the
onboarding bulk-set and any reminder/notification deep link into the user's own
calendar).

### 3.3 Friend-status notification engagement — `friend_status_notification_*`

| Event | Status | Fires when | Key properties |
| --- | --- | --- | --- |
| `friend_status_notification_delivered` | *Defined (pending worker)* | Delivery worker marks a batch `sent` | `batch_key`, `recipient_id`, `notification_type`, `channel`, `friend_count` |
| `friend_status_notification_opened` | **Implemented** | A `?date=` deep link opens the friends calendar | `recipient_id`, `date`, `group_id`, `batch_key?`, `notification_type?` |
| `friend_status_notification_dismissed` | *Defined (pending client handler)* | User dismisses the alert | `batch_key`, `recipient_id`, `notification_type` |

`_opened` is emitted at `app/(tabs)/index.tsx` on arrival of a `?date=` deep
link (guarded to count each distinct link once). **Caveat:** the deep link
carries only `date`/`groupId`, not the originating `batch_key`, so `_opened`
cannot yet be joined to a specific `_delivered` on a stable key — see §5.

### 3.4 Preference controls — `notification_preferences_changed` · *Implemented*

Emitted at `app/(tabs)/profile.tsx` after a successful preference save.

| Property | Meaning |
| --- | --- |
| `user_id` | Who changed settings |
| `changed` | Which preference keys changed in this save |
| `coordination_enabled` | Master friend-status opt-in |
| `weekend_in_town_enabled` / `back_in_town_enabled` | Per-type opt-in |
| `delivery_channels` | `push` / `email` selection after the change |

---

## 4. Reminder-attribution model

"Did the reminder cause the update?" is answered by a **time-window join**, not
by client-side threading:

> A `status_updated` event is **attributed** to a `reminder_delivered` event for
> the same `user_id` when it occurs within an **attribution window** of the
> delivery, and no later reminder to that user intervenes.

- **Proposed window: 24 hours.** Rationale: weekly/pre-weekend reminders target
  "refresh soon," not "this minute"; a same-day window captures the intended
  behaviour without over-crediting. **This is a decision to confirm** — see §7.
- When an update is a *direct* in-session continuation of a reminder open
  (deep link → the same calendar), the client sets `source` and `reminder_id`
  on `status_updated` for exact attribution; the window covers everything else
  (user comes back later, opens the app cold, etc.).
- The same window model applies to `friend_status_notification_opened` vs
  `_delivered` once a shared key exists (§5).

---

## 5. Reporting requirements

Each PRD success measure, the events it needs, and a concrete definition.

### M1 — Update rate after reminders (primary)
*"Improved rate of status updates after reminders are sent."*

- **Events:** `reminder_delivered`, `status_updated`.
- **Definition:** of users who received a reminder in a period, the share who
  produced ≥1 attributed `status_updated` (§4) within the window.
- **Formula:** `attributed_updaters / users_with_reminder_delivered`.
- **Slice by:** `reminder_type`, `channel`.

### M2 — Share of active users with fresh status
*"Improved share of active users with recently updated status data."*

- **Events:** none directly — this is a **state** metric over
  `calendar_entries.updated_at`, with `status_updated` as the corroborating
  event stream. Requires a **freshness definition** (§7, the flagged open
  question).
- **Definition (pending that decision):** share of active users whose status is
  "fresh" by the agreed rule, tracked over time and correlated against reminder
  rollout.

### M3 — Engagement with friend-status notifications
*"Meaningful engagement with … friend status changes."*

- **Events:** `friend_status_notification_delivered`,
  `friend_status_notification_opened`.
- **Definition:** open rate = `opened / delivered`.
- **Blocker:** needs a shared join key between delivered and opened (§5 caveat).
  Interim: an aggregate open **volume** trend from `_opened` alone.

### M4 — Understandable, controllable settings
*"Acceptable opt-in and opt-out behavior."*

- **Events:** `notification_preferences_changed`.
- **Definition:** opt-in and opt-out rates for `coordination_enabled` and each
  per-type toggle; watch opt-out spikes after cadence/volume changes as a
  noise-tolerance signal.

**Cross-cutting requirements**

- **Identity:** every event carries a `user_id` / `recipient_id` for per-user
  joins.
- **Delivered→opened join key:** add `batch_key` to coordination deep links so
  `_opened` joins `_delivered` (needed for M3; §7).
- **Sink:** events must reach a queryable store (warehouse / analytics DB) —
  `services/analytics.ts` is the seam; the destination is unchosen (§6).

---

## 6. Instrumentation implementation

- `services/analytics.ts` — typed `AnalyticsEventMap`, a `track(name, props)`
  function (typed, non-throwing), and `configureAnalytics(sink)` to attach a
  destination. No vendor is bundled: the app has no analytics SDK and choosing
  one is out of scope. Default behaviour is a dev-only console log plus a small
  in-memory buffer; production with no sink drops events.
- **Wired today:** `status_updated` (calendar save), 
  `friend_status_notification_opened` (deep-link arrival),
  `notification_preferences_changed` (profile save).
- **To finish the picture, a follow-up must:** choose + configure a sink; emit
  `reminder_*` from the reminder scheduler/worker when reminders ship; emit
  `friend_status_notification_delivered` from the delivery worker; add
  `batch_key` to deep links.

---

## 7. Open questions

1. **What counts as "sufficiently fresh" status? (flagged per AC — blocks M2.)**
   The PRD's own open question. Freshness needs an explicit rule before M2 can
   be computed. Candidate definitions:
   - **Recency:** status touched within the last *N* days (e.g. 7). Simple but
     penalizes a correct, unchanged "in town."
   - **Coverage:** the user has a status set for the current/upcoming period
     (e.g. today + the coming weekend), regardless of when it was last edited.
   - **Hybrid:** covered for the relevant horizon **and** edited within *N* days.

   Recommendation: **coverage of the upcoming weekend** as the primary freshness
   rule (it matches what the product actually needs — reliable near-term data),
   with recency as a secondary health metric. Needs product sign-off, and it
   determines what `calendar_entries` history/telemetry we must retain.
2. **Attribution window length** (§4) — confirm 24h, and the tie-break when a
   user gets multiple reminders before updating.
3. **Delivered↔opened join key** — add `batch_key` to coordination deep links so
   M3 is measurable on a stable key rather than by time window.
4. **Analytics destination** (§6) — which sink (PostHog / Segment / Amplitude /
   a Supabase `analytics_events` table)? Governs identity, retention, and PII
   handling before real user data flows.
5. **Delivery attempted vs. succeeded** — should `reminder_delivered` /
   `_delivered` mean "handed to the channel" or "confirmed delivered"? Affects
   the denominator of every rate above.
