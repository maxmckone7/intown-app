# Reminder & Notification Delivery

**Issue:** PRA-2 · **Project:** Reminders & Notifications · **Status:** Delivery layer implemented; provider + scheduler pending (see §7)

Implements **delivery** for reminders and coordination notifications across the
selected channels for the first release. This is the transport layer the
[PRD](https://linear.app/rideshare-company/project/reminders-and-notifications-dd5d5db0e81d)
needs so that "prompts that nudge users to keep their in/out status current"
actually reach the user, reliably, once a reminder rule is met.

It is the sibling of the measurement spec in
[`reminder-notification-instrumentation.md`](./reminder-notification-instrumentation.md)
(PRA-5): that doc defines the `reminder_*` / `friend_status_notification_*`
events; this work is the code that **emits** them.

The delivery code lives in `services/reminderDelivery.ts` (channels + worker) and
`services/reminderRules.ts` (the rules that queue reminders). The queue and
failure columns are in `database/schema.sql`.

---

## 1. Acceptance criteria → where they are met

| AC | Where |
| --- | --- |
| Supported delivery channel(s) implemented for reminders | `services/reminderDelivery.ts` — a per-channel transport seam for `push` and `email` (`ChannelTransport`, `configureDeliveryChannels`), delivered over the recipient's selected `channels` (§2). |
| Reminder sends triggered from the defined reminder rules | `services/reminderRules.ts` defines the `weekly` and `pre_weekend` rules and queues reminder rows; the worker delivers what the rules queued (§3, §4). |
| Delivery failures can be detected for supported channels | Every channel attempt returns a typed `ChannelSendOutcome`; failures are aggregated into a `DeliveryResult` and persisted as `failed` / `failure_reason` on the row (§2, §5). |
| Unresolved channel decision flagged | §7 — **no push or email provider is chosen yet**; this is the primary open dependency, and the code degrades to a detectable `channel_not_configured` failure until one is wired. |

---

## 2. Delivery model

**Channels.** The first-release channels are `push` and `email` (mirroring
`NotificationChannel` and the recipient's `delivery_channels` preference). A
message is delivered across *all* channels the recipient selected.

**Transport seam.** Like `services/analytics.ts`, delivery does **not** bundle a
vendor. Each channel is backed by a pluggable `ChannelTransport`:

```ts
interface ChannelTransport {
  readonly channel: NotificationChannel;
  send(message: DeliveryMessage): Promise<ChannelSendOutcome>;
}
configureDeliveryChannels({ push: expoPushTransport, email: emailTransport });
```

Until a transport is attached, that channel reports a **detectable**
`channel_not_configured` failure — it never silently drops the message. This is
what makes "flag the unresolved channel decision" a runtime-visible state rather
than a comment.

**Outcome & failure detection.** A single channel attempt resolves to:

```ts
type ChannelSendOutcome =
  | { ok: true; providerMessageId?: string }
  | { ok: false; reason: DeliveryFailureReason; detail?: string; retryable: boolean };
```

`deliverMessage(base, channels)` runs every selected channel and aggregates into
a `DeliveryResult`:

- `delivered` — **true if any channel accepted** the message (the user is
  reachable). Partial failures are still reported in `failedChannels`.
- `failureReason` — the reason to record when *nothing* was delivered.
- `retryable` — true only when nothing was delivered **and** every failure is
  itself retryable (a transient/`provider_error` or a not-yet-configured
  channel), so the worker can safely leave the row queued for a later pass. An
  `invalid_message` is terminal.

Failure reasons (`DeliveryFailureReason`, shared by both queues):

| Reason | Meaning | Retryable |
| --- | --- | --- |
| `channel_not_configured` | No transport wired (the default today) | yes |
| `no_delivery_address` | No push token / no email on file for the recipient | no¹ |
| `provider_error` | Transport ran but the provider rejected/errored/timed out | yes |
| `invalid_message` | Message failed validation before sending | no |

¹ transports return this; whether it is retryable is a transport decision — a
missing address won't fix itself on the next pass.

---

## 3. Reminder rules (what triggers a send)

`services/reminderRules.ts` defines the rules and is **pure** — given a user and
a reference time it returns the reminder rows that should exist for the current
period:

| Rule | Fires | Nudges | Dedupe period |
| --- | --- | --- | --- |
| `weekly` | Sunday 18:00 (local) | Set your status for the coming week | that week's Monday |
| `pre_weekend` | Thursday 18:00 (local) | Confirm your status for the weekend | that weekend's Friday |

`buildRemindersForUser({ userId, channels, now })` returns one `ReminderDraft`
per rule; `enqueueReminders` upserts them **idempotently on `dedupe_key`**
(`${userId}:${type}:${period}`), so a scheduler that runs more than once inside a
period cannot double-queue. `send_after` on the row gates actual delivery, so
drafts may be enqueued as soon as the period is known.

---

## 4. Worker loop

`runReminderDelivery({ now, limit, store })` and its coordination twin
`runCoordinationDelivery(...)`:

1. **Claim** due rows — `status = 'queued'` and `send_after <= now` (indexed by
   `idx_reminders_status_send_after` / `idx_coordination_batches_status_send_after`).
2. **Deliver** each via `deliverReminder` / `deliverCoordinationBatch`, which map
   the row to messages, send across its channels, and emit analytics (§6).
3. **Persist** the outcome: `sent` (with `sent_at`) if delivered; otherwise
   `failed` + `failure_reason` for a terminal failure, or left `queued` for a
   retryable one. `attempts` is incremented on every pass.

The loop never throws per row — a single bad row is recorded and the pass
continues — and returns a `DeliveryRunSummary` (`claimed / delivered / failed /
retryable`) for health checks.

The `store` is injectable (`ReminderDeliveryStore` / `CoordinationDeliveryStore`)
so the worker is testable without a DB and so the runtime can supply a
**service-role** client (see §7). The default stores use the app's Supabase
client.

This closes the two "delivery worker not yet built" gaps called out in the
instrumentation doc: coordination batches were enqueued but never marked `sent`,
and reminders had no delivery path at all.

---

## 5. Data model changes (`database/schema.sql`)

- **`reminders`** (new) — the reminder queue: `reminder_type`, `channels`,
  `title` / `body` / `deep_link`, `scheduled_for`, `status`
  (`queued`/`sent`/`suppressed`/`failed`), `send_after`, `sent_at`, `attempts`,
  `failed_at`, `failure_reason`, and a unique `dedupe_key`. RLS lets a user read
  their own reminders; queuing/delivery run server-side under the service role.
- **`coordination_notification_batches`** (extended) — added `attempts`,
  `failed_at`, `failure_reason`, and the `failed` status so coordination
  delivery has the same failure observability. The status CHECK is re-created so
  existing databases pick up `failed`.
- Both tables constrain `failure_reason` to the four `DeliveryFailureReason`
  values.

---

## 6. Analytics emitted

Delivery emits the events PRA-5 defined but left pending:

- **`reminder_delivered`** — one event per channel that accepted a reminder
  (`reminder_id`, `user_id`, `reminder_type`, `channel`, `delivered_at`).
- **`friend_status_notification_delivered`** — one event per channel that
  accepted a coordination batch (`batch_key`, `recipient_id`,
  `notification_type`, `channel`, `friend_count`).

These feed M1 (update rate after reminders) and M3 (friend-status engagement).
No delivered event is emitted for a failed channel, so rate denominators count
reach, not attempts — but see the "attempted vs confirmed" question below.

---

## 7. Open questions / dependencies

1. **Channel provider is unchosen — the flagged channel decision (AC).** No push
   or email vendor is wired. Candidates: **push** — Expo Push, or APNs/FCM
   directly; **email** — Resend / Postmark / SES. Blocks real delivery; until it
   lands every channel reports `channel_not_configured`. *This is the primary
   dependency to resolve before the first release ships reminders.*
2. **First-release channel scope.** Is release-one push-only, email-only, or
   both? The code supports both; the product decision determines which
   transports are configured and what preference defaults ship.
3. **Delivery addresses.** Push needs a **device-token store** (not yet built —
   no table, no registration flow). Email needs a verified address source
   (`users.email` exists but isn't verified for sending). Both surface as
   `no_delivery_address` until built.
4. **Scheduler.** This module delivers; it does not run itself. A cron / Edge
   Function must (a) call `buildRemindersForUser` + `enqueueReminders` for
   opted-in users and (b) invoke `runReminderDelivery` / `runCoordinationDelivery`
   on a cadence. Owner + runtime TBD.
5. **Service-role execution.** The production worker must run server-side with a
   service-role key: RLS on `reminders` / `coordination_notification_batches`
   grants recipients read-only access, so the anon client cannot claim or update
   rows. The injectable store exists for exactly this.
6. **Timezone.** Fire times are computed in the runtime's local time. Making
   "Sunday evening" the *user's* evening needs a per-user timezone on the profile
   (not modeled yet).
7. **Retry / backoff policy.** Retryable failures currently stay `queued` and are
   re-attempted on the next pass with no backoff or attempt ceiling. A max-attempt
   cap and backoff (and whether to alert on repeated `provider_error`) should be
   defined before enabling a real provider.
8. **"Delivered" = attempted or confirmed?** `reminder_delivered` fires when a
   transport **accepts** the message (handed to the provider), not on confirmed
   receipt. This mirrors PRA-5 open question §7.5 and sets the denominator of
   every delivery rate — confirm the intended semantics.
