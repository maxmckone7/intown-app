import { supabase } from '../lib/supabase';
import {
  CoordinationNotificationPreferences,
  NotificationChannel,
  ReminderType,
} from '../lib/types';

export type CoordinationNotificationPreferenceUpdate = Partial<
  Pick<
    CoordinationNotificationPreferences,
    | 'coordination_enabled'
    | 'weekend_in_town_enabled'
    | 'back_in_town_enabled'
    | 'delivery_channels'
    | 'group_id'
    | 'reminders_enabled'
    | 'weekly_reminder_enabled'
    | 'pre_weekend_reminder_enabled'
  >
>;

type DeepLinkTarget = {
  date: string;
  groupId?: string | null;
};

const DEFAULT_CHANNELS: NotificationChannel[] = ['push'];

export const getDefaultCoordinationNotificationPreferences = (
  userId: string
): CoordinationNotificationPreferences => {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    coordination_enabled: false,
    weekend_in_town_enabled: true,
    back_in_town_enabled: true,
    delivery_channels: DEFAULT_CHANNELS,
    group_id: null,
    // Reminders default ON (opt-out): keeping status fresh is the point of the
    // feature. These mirror the DB defaults in database/schema.sql.
    reminders_enabled: true,
    weekly_reminder_enabled: true,
    pre_weekend_reminder_enabled: true,
    created_at: now,
    updated_at: now,
  };
};

/**
 * The single gate every status-freshness reminder send must pass through. A
 * reminder of `reminderType` may fire for a user only when the master
 * `reminders_enabled` switch is on AND that type's own toggle is on.
 *
 * The reminder scheduler/delivery worker does not exist yet (see the PRD and
 * docs/notification-preferences.md); it MUST call this rather than reading the
 * booleans directly, so preference semantics stay in one place — the friend
 * status/coordination side already centralises the same decision in the
 * `enqueue_coordination_notifications` trigger.
 */
export const isReminderEnabled = (
  preferences: Pick<
    CoordinationNotificationPreferences,
    'reminders_enabled' | 'weekly_reminder_enabled' | 'pre_weekend_reminder_enabled'
  >,
  reminderType: ReminderType
): boolean => {
  if (!preferences.reminders_enabled) return false;

  switch (reminderType) {
    case 'weekly':
      return preferences.weekly_reminder_enabled;
    case 'pre_weekend':
      return preferences.pre_weekend_reminder_enabled;
    default:
      return false;
  }
};

const normalizeChannels = (
  channels?: NotificationChannel[] | null
): NotificationChannel[] => {
  if (!Array.isArray(channels) || channels.length === 0) {
    return DEFAULT_CHANNELS;
  }

  const uniqueChannels = Array.from(
    new Set(channels.filter((channel) => channel === 'push' || channel === 'email'))
  );

  return uniqueChannels.length > 0 ? uniqueChannels : DEFAULT_CHANNELS;
};

const normalizePreferences = (
  userId: string,
  preferences?: Partial<CoordinationNotificationPreferences> | null
): CoordinationNotificationPreferences => ({
  ...getDefaultCoordinationNotificationPreferences(userId),
  ...preferences,
  user_id: userId,
  delivery_channels: normalizeChannels(preferences?.delivery_channels),
  group_id: preferences?.group_id ?? null,
});

const encodeQuery = (params: Record<string, string | null | undefined>) =>
  Object.entries(params)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`)
    .join('&');

export const buildCoordinationDeepLink = ({ date, groupId }: DeepLinkTarget) => {
  const query = encodeQuery({ date, groupId });
  return query ? `intown:///?${query}` : 'intown:///';
};

export const coordinationNotificationsService = {
  async getPreferences(userId: string): Promise<CoordinationNotificationPreferences> {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return normalizePreferences(userId, data);
  },

  async updatePreferences(
    userId: string,
    updates: CoordinationNotificationPreferenceUpdate
  ): Promise<CoordinationNotificationPreferences> {
    const payload = {
      user_id: userId,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    if (updates.delivery_channels) {
      payload.delivery_channels = normalizeChannels(updates.delivery_channels);
    }

    if ('group_id' in updates) {
      payload.group_id = updates.group_id ?? null;
    }

    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*')
      .single();

    if (error) throw error;

    return normalizePreferences(userId, data);
  },
};
