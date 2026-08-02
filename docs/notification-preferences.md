# Notification Preferences

**Issue:** PRA-3 · **Project:** Reminders & Notifications · **Status:** Definition + implementation (reminder delivery deferred)

Defines the user-facing controls for **notification behavior** and the model
behind them, so both notification families are optional and understandable, per
the [PRD](https://linear.app/rideshare-company/project/reminders-and-notifications-dd5d5db0e81d).

There are two notification families, and this doc is the source of truth for the
preference model that governs both:

| Family | Who it's about | Example |
| --- | --- | --- |
| **Friend-status ("coordination") notifications** | *Other people* — a friend became available | "Friends are in town this weekend" |
| **Status-freshness reminders** | *You* — nudging you to keep your own status current | "Refresh your status for the week ahead" |

Both are stored in a single row per user in `notification_preferences`
(`database/schema.sql`), typed as `CoordinationNotificationPreferences` in
`lib/types.ts`. (The type name predates reminders and is kept for continuity;
it represents the whole `notification_preferences` row, not just coordination.)

---

## 1. The preference model

One row per user, keyed by `user_id`. Columns by family:

### Friend-status ("coordination") controls — *pre-existing (PRA-5)*

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `coordination_enabled` | bool | `FALSE` | Master opt-in for friend-status notifications |
| `weekend_in_town_enabled` | bool | `TRUE` | Per-type: "friends in town this weekend" |
| `back_in_town_enabled` | bool | `TRUE` | Per-type: "a friend is back in town" |
| `delivery_channels` | text[] | `{push}` | `push` / `email` fan-out for these alerts |
| `group_id` | uuid | `NULL` | Restrict to one friend group (`NULL` = all friends) |

### Status-freshness reminder controls — *added by PRA-3*

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `reminders_enabled` | bool | `TRUE` | Master opt-in for status reminders |
| `weekly_reminder_enabled` | bool | `TRUE` | Per-type: recurring weekly "refresh your week" nudge |
| `pre_weekend_reminder_enabled` | bool | `TRUE` | Per-type: Thu/Fri "confirm your weekend" nudge |

The two reminder types mirror `ReminderType` (`weekly` | `pre_weekend`) in
`services/analytics.ts` and `lib/types.ts` — the same vocabulary the (future)
scheduler and the reminder-lifecycle analytics events already use.

**Defaults rationale.** Friend-status notifications default **off** (opt-in):
they expose one user's availability to others, so silence-by-default is the
privacy-forward choice. Reminders default **on** (opt-out): they go only to the
user about their own data, and keeping status fresh is the reminder feature's
entire purpose — a reminders-off default would ship the feature switched off for
everyone. Both defaults are set identically in the DB (`schema.sql`) and the app
(`getDefaultCoordinationNotificationPreferences`) so a user with no row yet and a
user with a freshly-created row behave the same. The opt-in-vs-opt-out default
for reminders is a **flagged open question** (§5).

---

## 2. Where preferences are set

Both families are edited on the profile screen
(`app/(tabs)/profile.tsx`) as two cards — **Coordination Notifications** and
**Status Reminders** — each with a master switch that disables its own per-type
sub-toggles when off. Every change is persisted through
`coordinationNotificationsService.updatePreferences` and emits a
`notification_preferences_changed` analytics event carrying the full post-save
state of both families (feeds PRA-5's opt-in/opt-out success measure, M4).

---

## 3. How preferences are respected downstream

The AC requires settings be "respected consistently by downstream notification
behavior." The two families reach that guarantee differently because one feature
is built and one is not:

### Friend-status — enforced today, in the database

`enqueue_coordination_notifications` (a trigger on `calendar_entries`,
`database/schema.sql`) is the *only* producer of coordination notifications, and
it reads preferences inline before enqueueing anything: it joins
`notification_preferences`, filters on `coordination_enabled = TRUE`, checks the
matching per-type toggle (`weekend_in_town_enabled` / `back_in_town_enabled`),
scopes to `group_id`, and stamps the batch's `channels` from `delivery_channels`.
There is no second code path, so the preference is honoured by construction.

### Reminders — enforced by contract, pending the feature

The reminder scheduler/delivery worker **does not exist yet** (confirmed in
`docs/reminder-notification-instrumentation.md` §1 — no scheduler, no reminder
record, no delivery). So there is no runtime path to gate today. To make
"respected consistently" a property the feature inherits the moment it ships
rather than an afterthought, PRA-3 provides a **single decision point**:

```ts
// services/coordinationNotifications.ts
isReminderEnabled(preferences, reminderType): boolean
//   -> preferences.reminders_enabled
//      && the per-type toggle for `reminderType`
```

The scheduler/worker **MUST** call `isReminderEnabled(...)` immediately before
scheduling or sending each reminder, rather than reading the booleans directly —
mirroring how the coordination trigger centralises its own decision. This keeps
the master-then-per-type semantics in one tested place and prevents the two
callers (schedule-time and send-time) from drifting.

When the worker lands it should also emit the already-defined `reminder_*`
events (`services/analytics.ts`) so opt-out actually shows up as reduced
delivery volume.

---

## 4. Implemented vs. deferred

**Implemented in this issue**
- Reminder preference columns + backfill migration (`database/schema.sql`).
- `reminders_enabled` / `weekly_reminder_enabled` / `pre_weekend_reminder_enabled`
  on `CoordinationNotificationPreferences` (`lib/types.ts`) with matching
  service defaults and update surface (`services/coordinationNotifications.ts`).
- `isReminderEnabled()` gate helper — the single downstream decision point.
- Profile UI: a **Status Reminders** card with master + per-type toggles.
- Reminder fields added to the `notification_preferences_changed` event.

**Deferred (out of scope — the feature doesn't exist yet)**
- The reminder scheduler and delivery worker themselves. PRA-3 defines and
  implements the *controls*; the *delivery* that reads them is a separate piece
  of work, exactly as the coordination delivery worker is still unbuilt.
- Reminder-specific delivery channels (see §5) and any timing/quiet-hours
  controls (see §5).

---

## 5. Open questions (flagged per AC)

1. **Opt-in vs opt-out for reminders.** This issue ships reminders **on by
   default** (opt-out). If product prefers an explicit opt-in, flip the default
   in both `schema.sql` and `getDefaultCoordinationNotificationPreferences` and
   reconsider the backfill for existing rows. Needs product sign-off.
2. **Channel selection for reminders.** Coordination notifications have their own
   `delivery_channels` (push/email). Reminders currently have **no channel
   control** — the assumption is push-only until the delivery worker exists. Open
   question: do reminders reuse `delivery_channels`, or get their own column
   (e.g. `reminder_channels`) so a user can, say, get friend alerts by email but
   reminders by push? Deferred until the worker forces the decision; the model
   can add a column without disturbing existing rows.
3. **Timing / cadence / quiet hours.** No control over *when* reminders fire
   (day, time-of-day, frequency) or a global quiet-hours window. Likely needed
   for "understandable" reminders but depends entirely on the unbuilt scheduler,
   so deferred. Flagging so it isn't mistaken for an oversight.
4. **Granularity of the friend-status master vs per-type toggles.** Today a user
   can disable coordination entirely or per-type, but the per-type toggles have
   no effect while the master is off (matching the UI). Confirm this is the
   intended hierarchy rather than independent switches.
