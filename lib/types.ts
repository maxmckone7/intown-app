export type CalendarStatus = 'in_town' | 'out_of_town';

/**
 * Who last wrote a calendar day's status. This is the source-of-truth marker
 * for the Google Calendar Sync integration (PRA-10): a `manual` day is one the
 * user set themselves and is authoritative — calendar inference must never
 * overwrite it. A `calendar_inferred` day was written by the sync integration
 * and may be updated or cleaned up by a later sync.
 */
export type StatusSource = 'manual' | 'calendar_inferred';

export interface CalendarEntry {
  id: string;
  user_id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  status: CalendarStatus;
  /**
   * Who last wrote this entry. Defaults to `manual` for rows created before the
   * sync integration existed (see database/schema.sql migration).
   */
  source: StatusSource;
  /**
   * For `calendar_inferred` entries only: the ISO timestamp of the calendar
   * snapshot the inference was computed from. Used to reject stale/out-of-order
   * sync runs (never move an entry backwards to an older snapshot). Null for
   * manual entries.
   */
  inferred_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * How much of an owner's calendar a given viewer can see.
 *   full    - every calendar entry (in_town and out_of_town)
 *   limited - only the owner's in_town days; travel/away days stay private
 *   hidden  - nothing
 */
export type VisibilityLevel = 'full' | 'limited' | 'hidden';

export type VisibilityScope = 'friend' | 'group';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  location?: string | null;
  interests?: string[] | null;
  social_accounts?: Record<string, string> | null;
  /** Global "appear away" / invisible toggle — hides your calendar from everyone. */
  appear_away?: boolean;
  /** Visibility applied to friends without a more specific friend/group rule. */
  default_visibility?: VisibilityLevel;
  created_at: string;
}

/** A per-friend or per-group override of the owner's default visibility. */
export interface VisibilityRule {
  id: string;
  owner_id: string;
  scope_type: VisibilityScope;
  scope_id: string;
  level: VisibilityLevel;
  created_at: string;
  updated_at: string;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
}

export interface FriendGroup {
  id: string;
  user_id: string;
  name: string;
  friend_ids: string[];
  created_at: string;
  updated_at: string;
}

export type NotificationChannel = 'push' | 'email';

export type CoordinationNotificationType =
  | 'weekend_in_town'
  | 'back_in_town';

export type CoordinationNotificationStatus =
  | 'queued'
  | 'sent'
  | 'suppressed'
  // The delivery worker (PRA-2) attempted every requested channel and none
  // succeeded. Distinct from 'suppressed' (intentionally not sent).
  | 'failed';

/**
 * Why a delivery attempt for a channel did not succeed. Shared by reminders and
 * coordination notifications so failure detection (PRA-2 AC) is uniform across
 * both delivery paths.
 *
 *   channel_not_configured - no transport wired for the channel (the default
 *                            state until a push/email vendor is chosen; see
 *                            docs/reminder-delivery.md open questions).
 *   no_delivery_address    - recipient has no usable address for the channel
 *                            (no push token registered, no email on file).
 *   provider_error         - the transport ran but the provider rejected or
 *                            errored (network, 4xx/5xx, timeout).
 *   invalid_message        - the message failed validation before sending
 *                            (empty body, missing recipient, …).
 */
export type DeliveryFailureReason =
  | 'channel_not_configured'
  | 'no_delivery_address'
  | 'provider_error'
  | 'invalid_message';

/**
 * Status-freshness reminders that nudge a user to keep their OWN in/out status
 * current — distinct from friend-status ("coordination") notifications, which
 * are about other people. Mirrors `ReminderType` in services/analytics.ts.
 *   weekly      - a recurring nudge to refresh the coming week
 *   pre_weekend - a Thu/Fri nudge to confirm weekend availability
 */
export type ReminderType = 'weekly' | 'pre_weekend';

/**
 * A user's row in `notification_preferences` — the single source of truth for
 * every notification opt-in/opt-out. Despite the name it covers BOTH families:
 *
 *   - friend-status ("coordination") notifications: `coordination_enabled`
 *     (master) plus the per-type `weekend_in_town_enabled` /
 *     `back_in_town_enabled`, `delivery_channels`, and `group_id` scope. These
 *     are respected today by the `enqueue_coordination_notifications` trigger
 *     (database/schema.sql).
 *   - status-freshness reminders (PRA-3): `reminders_enabled` (master) plus the
 *     per-type `weekly_reminder_enabled` / `pre_weekend_reminder_enabled`. The
 *     reminder scheduler/delivery worker is not built yet (see the PRD and
 *     docs/notification-preferences.md); these controls define the contract it
 *     must honour. Gate any reminder send through `isReminderEnabled()` in
 *     services/coordinationNotifications.ts so there is one place that decides.
 */
export interface CoordinationNotificationPreferences {
  user_id: string;
  coordination_enabled: boolean;
  weekend_in_town_enabled: boolean;
  back_in_town_enabled: boolean;
  delivery_channels: NotificationChannel[];
  group_id: string | null;
  /** Master switch for status-freshness reminders (PRA-3). */
  reminders_enabled: boolean;
  /** Per-type toggle: recurring weekly "refresh your status" nudge. */
  weekly_reminder_enabled: boolean;
  /** Per-type toggle: pre-weekend "confirm your weekend" nudge. */
  pre_weekend_reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoordinationNotificationBatch {
  id: string;
  recipient_id: string;
  notification_type: CoordinationNotificationType;
  group_id: string | null;
  starts_on: string;
  ends_on: string;
  friend_ids: string[];
  title: string;
  body: string;
  deep_link: string;
  channels: NotificationChannel[];
  status: CoordinationNotificationStatus;
  send_after: string;
  sent_at: string | null;
  /** Number of delivery attempts made by the worker (PRA-2). */
  attempts: number;
  /** When the batch was last marked `failed`. Null unless status is 'failed'. */
  failed_at: string | null;
  /** Reason for the most recent failed attempt, for observability/alerting. */
  failure_reason: DeliveryFailureReason | null;
  batch_key: string;
  created_at: string;
  updated_at: string;
}

/** Status-freshness reminder kinds — prompts to keep your own status current. */
export type ReminderType = 'weekly' | 'pre_weekend';

export type ReminderStatus =
  | 'queued'
  | 'sent'
  | 'suppressed'
  | 'failed';

/**
 * A status-freshness reminder (PRA-2 · Reminders & Notifications). Unlike a
 * coordination notification — which is triggered by a *friend's* status change —
 * a reminder nudges the recipient to refresh *their own* in/out status. Rows are
 * queued from the reminder rules (services/reminderRules.ts) and dispatched
 * across `channels` by the delivery worker (services/reminderDelivery.ts).
 *
 * `dedupe_key` makes queuing idempotent for a given (user, type, period) so a
 * scheduler that runs more than once in a window cannot double-send.
 */
export interface Reminder {
  id: string;
  user_id: string;
  reminder_type: ReminderType;
  channels: NotificationChannel[];
  title: string;
  body: string;
  /** Deep link into the user's own calendar for the period being nudged. */
  deep_link: string;
  /** ISO timestamp the reminder is intended to fire at. */
  scheduled_for: string;
  status: ReminderStatus;
  /** Earliest time the worker may attempt delivery (usually == scheduled_for). */
  send_after: string;
  sent_at: string | null;
  attempts: number;
  failed_at: string | null;
  failure_reason: DeliveryFailureReason | null;
  /** Idempotency key: `${user_id}:${reminder_type}:${period}`. */
  dedupe_key: string;
  created_at: string;
  updated_at: string;
}

export interface Invite {
  id: string;
  inviter_id: string;
  token: string;
  invitee_email: string | null;
  invitee_phone: string | null;
  status: 'pending' | 'accepted' | 'revoked';
  accepted_by: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendWithStatus extends User {
  friendship_id: string;
  friendship_status: 'pending' | 'accepted';
  calendar_entries?: CalendarEntry[];
}

