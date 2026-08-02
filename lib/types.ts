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
  | 'suppressed';

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
  batch_key: string;
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

