export type CalendarStatus = 'in_town' | 'out_of_town';

export interface CalendarEntry {
  id: string;
  user_id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  status: CalendarStatus;
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

export interface CoordinationNotificationPreferences {
  user_id: string;
  coordination_enabled: boolean;
  weekend_in_town_enabled: boolean;
  back_in_town_enabled: boolean;
  delivery_channels: NotificationChannel[];
  group_id: string | null;
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

