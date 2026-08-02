# Friend Status-Change Notifications

**Issue:** PRA-4 · **Project:** Reminders & Notifications · **Status:** Detection + enqueue implemented; delivery pending

Specifies when a change to a friend's in/out status triggers a coordination
notification, whose preferences gate it, and which delivery channels carry it —
and calls out, explicitly, every case where "what counts as a notifiable status
change" is a judgement call rather than an obvious yes/no.

This is the source-of-truth spec. It has **two enforcement points that must stay
in agreement**:

- **Runtime (authoritative today):** the Postgres trigger
  `enqueue_coordination_notifications` (`database/schema.sql:570`), which fires
  on `calendar_entries` writes and upserts rows into
  `coordination_notification_batches` (`database/schema.sql:125`).
- **Application seam:** the pure, typed rules in
  `services/friendStatusNotifications.ts` — the same ruleset in TypeScript, for
  reuse by a future delivery worker / server function and for readable review of
  the edge cases.

If you change a rule, change it in all three places (trigger, seam, this doc).

---

## 1. Current state

**What exists today**

- **Detection + enqueue** — the trigger fires `AFTER INSERT OR UPDATE OF status,
  date ON calendar_entries` (`database/schema.sql:675`), fans out over the
  changed user's accepted friends, checks each friend's
  `notification_preferences`, and upserts a batched alert
  (`upsert_coordination_notification_batch`, `database/schema.sql:490`).
- **Preferences** — `notification_preferences` (`database/schema.sql:88`), read
  and written through `coordinationNotificationsService`
  (`services/coordinationNotifications.ts:78`) and edited on the profile screen.
- **Batch queue** — `coordination_notification_batches` (`database/schema.sql:125`),
  carrying the recipient, type, window, contributing `friend_ids`, `channels`,
  `deep_link`, `send_after`, and a `status` of `queued`/`sent`/`suppressed`.

**What does not exist yet**

- **A delivery worker.** Batches are enqueued but nothing marks them `sent` or
  pushes to a channel. Channel *selection* is wired end-to-end; channel
  *delivery* is out of scope for PRA-4.
- **Privacy/visibility gating of notifications** (see §5, Ambiguity A5).

**What this issue adds**

- `services/friendStatusNotifications.ts` — the notifiable-change rules and
  recipient gating as pure, typed, testable functions.
- This spec, including the explicit ambiguity register (§5) that acceptance
  criterion 4 asks for.

---

## 2. What counts as a notifiable status change

A "status change" is a write to a single calendar day
(`calendarService.setEntry`, `services/calendar.ts`). Two notification types can
result, and one change can produce **both**:

| Type | Fires when | Window (`starts_on`…`ends_on`) |
| --- | --- | --- |
| `weekend_in_town` | the resulting status is `in_town` **and** the day is Fri, Sat, or Sun (ISO weekday 5–7) | that whole weekend, Fri–Sun |
| `back_in_town` | the status **transitions** `out_of_town` → `in_town` | the single changed day |

The decision procedure (`classifyStatusChange`,
`services/friendStatusNotifications.ts`):

1. **Only arrivals at `in_town` matter.** Any write whose result is not
   `in_town` is silent (Ambiguity A1).
2. **No-op writes are silent.** Re-saving the same status is not a change.
3. **Weekend presence** → `weekend_in_town`, pointing at the Fri–Sun window the
   day belongs to. The window math mirrors the trigger:
   `weekend_start = date − max(isodow − 5, 0)`, `weekend_end = weekend_start + 2`.
4. **A genuine return** (`out_of_town` → `in_town`) → `back_in_town`. A
   first-ever `in_town` day with no prior entry is **not** a return (Ambiguity
   A2).

---

## 3. Who gets notified (preference gating)

For each notifiable change, the trigger fans out over the changed user's
accepted friends and applies the gate below per recipient
(`selectRecipientNotifications`, `services/friendStatusNotifications.ts`;
trigger loop at `database/schema.sql:601`):

1. **Master opt-in** — `coordination_enabled` must be `true`. Off by default
   (`getDefaultCoordinationNotificationPreferences`,
   `services/coordinationNotifications.ts:25`); the recipient must actively turn
   coordination notifications on. This is acceptance criterion 2.
2. **Scope** — if the recipient set `group_id`, the changed friend must be a
   member of that friend group; with no group, all accepted friends qualify.
3. **Per-type opt-in** — `weekend_in_town_enabled` / `back_in_town_enabled`
   (both default `true`, but only reachable once the master switch is on).

Notifications are per **recipient**, not per changed friend: the sender's own
preferences are irrelevant to whether their friends hear about their change.

---

## 4. Delivery channels

Each recipient stores `delivery_channels: ('push' | 'email')[]`
(`lib/types.ts`, `NotificationChannel`). Surviving notifications carry the
recipient's normalised channel set (`normalizeDeliveryChannels`): unknown
channels dropped, de-duplicated, and defaulted to `['push']` if empty — so a
notification always has at least one channel. This satisfies acceptance
criterion 3 ("supports the selected delivery channel or channels").

When several of a friend's changes collapse into one batch (same recipient,
type, and window), the batch's channels are the **union** of the contributing
writes' channels (`database/schema.sql:551`), and `send_after` is the earliest —
so a recipient never misses a channel they'd opted into.

---

## 5. Ambiguities & decisions (acceptance criterion 4)

Every case below is a real judgement call about "what counts as a notifiable
status change." Each records the **decision the current implementation makes**
and whether it needs product confirmation. Items marked **OPEN** should get a
product decision before the delivery worker ships, because once notifications
actually send, the wrong call here is user-visible.

- **A1 — Leaving town / clearing a day is silent (decided).** Only arrivals at
  `in_town` notify. `in_town → out_of_town`, and deleting a day
  (`calendarService.deleteEntry`), produce nothing. Deletion is doubly silent:
  the trigger is `AFTER INSERT OR UPDATE` only, so a retracted plan can never
  fire, nor "cancel" an already-queued batch. Reasonable for a coordination
  ("who's around") product, but means a queued `weekend_in_town` can outlive the
  plan it announced.

- **A2 — First-ever `in_town` insert is a weekend arrival but not a "return"
  (decided).** `back_in_town` needs an `out_of_town → in_town` transition; a
  brand-new `in_town` day (no prior row) yields only `weekend_in_town` (if on a
  weekend), and nothing at all on a weekday. So a friend who fills in a blank
  Tuesday as `in_town` notifies no one. Intentional — "back in town" implies a
  known prior absence — but worth stating.

- **A3 — Weekend window is Fri–Sun, fixed and timezone-free (decided).** ISO
  weekday 5–7; the day is a bare `YYYY-MM-DD` compared with no timezone. A user
  whose local Thursday night is already Friday UTC is treated by the calendar
  day they picked, not their wall clock. Consistent with how the app stores
  days, but the Fri–Sun definition is a product assumption, not a law.

- **A4 — De-dup / re-notify behaviour is driven by the batch key (decided).**
  Batches key on `recipient:type:group:starts_on:ends_on`
  (`database/schema.sql:505`), so multiple friends turning `in_town` for the
  same weekend collapse into one notification, and re-editing merges rather than
  re-alerting — but only while the batch is still `queued`
  (`database/schema.sql:566`). After it sends, an identical later change would
  create a fresh batch. Whether a second `back_in_town` for the same day after
  delivery should re-notify is **OPEN**.

- **A5 — Notifications do not yet respect calendar privacy (OPEN, important).**
  The trigger gates on friendship + notification preferences only. It does
  **not** consult the changed user's privacy settings — `appear_away`,
  `default_visibility`, or per-friend/group `calendar_visibility` rules
  (`services/privacy.ts`, ENG-101). A user who is "appear away", or who has set a
  recipient's visibility to `hidden`, could still trigger a
  "…is back in town" notification to that recipient, leaking presence the
  calendar UI would have hidden. **Recommended follow-up:** before delivery
  ships, gate enqueue (or delivery) on effective viewer visibility — at minimum
  suppress when the changed user is `appear_away` or the recipient's visibility
  of them is `hidden`. (`limited` still exposes `in_town` days, so it is
  compatible with these notifications.)

- **A6 — Calendar-inferred changes are treated like manual ones (OPEN).**
  PRA-10's Google Calendar Sync writes `calendar_inferred` days
  (`StatusSource`, `lib/types.ts`; `services/calendar.ts`). Today those writes
  trip the same trigger, so an *inferred* return could notify friends without the
  user ever asserting it. `StatusChange.source` is carried through the seam for
  exactly this decision but does not yet gate anything. **Recommended:** decide
  whether inferred changes notify, or only manual ones (or notify only after the
  user confirms an inferred day).

- **A7 — Group scope trusts a snapshot of `friend_ids` (decided, minor).** Scope
  membership reads `friend_groups.friend_ids` at write time
  (`database/schema.sql:618`). Changing a group's membership does not
  retroactively add/remove already-queued batches. Acceptable for a nudge.

---

## 6. Mapping to acceptance criteria

| Acceptance criterion | Where satisfied |
| --- | --- |
| Friend status change events can trigger notifications | `enqueue_coordination_notifications` trigger; `classifyStatusChange` (§2) |
| Sent only when the receiving user enabled them | `coordination_enabled` + per-type gate (§3); `selectRecipientNotifications` |
| Supports the selected delivery channel(s) | `delivery_channels` carried through, union-merged per batch (§4) |
| Ambiguity in "notifiable status change" called out | §5 (A1–A7) |
