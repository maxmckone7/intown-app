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

