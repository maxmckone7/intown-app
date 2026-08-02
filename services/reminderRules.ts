/**
 * Reminder rules (PRA-2 · Reminders & Notifications).
 *
 * The "defined reminder rules" that decide *when* a status-freshness reminder
 * should exist for a user. These are the rules PRA-2's acceptance criterion
 * "reminder sends are triggered from the defined reminder rules" refers to:
 *
 *   - `weekly`       — a Sunday-evening nudge to set the coming week.
 *   - `pre_weekend`  — a Thursday-evening nudge to confirm the coming weekend.
 *
 * This module is pure: given a user and a reference time it returns the reminder
 * rows that should be enqueued for the current period. Enqueuing is idempotent
 * via `dedupe_key`, so a scheduler may call `buildRemindersForUser` repeatedly
 * within a period without double-sending. Delivery of the queued rows is handled
 * by services/reminderDelivery.ts; the scheduler that runs both on a cadence is
 * an external dependency (see docs/reminder-delivery.md).
 *
 * NOTE on timezone: fire times are computed in the runtime's local time because
 * the profile has no per-user timezone yet. Making "Sunday evening" mean the
 * user's own evening is a flagged dependency in the doc.
 */

import { addDays, format, getDay, setHours, startOfDay } from 'date-fns';
import { NotificationChannel, ReminderType } from '../lib/types';
import { supabase } from '../lib/supabase';

/** The insertable shape of a reminder — everything the queue row needs. */
export interface ReminderDraft {
  user_id: string;
  reminder_type: ReminderType;
  channels: NotificationChannel[];
  title: string;
  body: string;
  deep_link: string;
  scheduled_for: string;
  send_after: string;
  dedupe_key: string;
}

/** Static metadata describing a rule, for docs/tests and admin surfaces. */
export interface ReminderRuleDefinition {
  reminder_type: ReminderType;
  description: string;
}

export const REMINDER_RULES: ReminderRuleDefinition[] = [
  {
    reminder_type: 'weekly',
    description: 'Sunday 18:00 — nudge to set your status for the coming week.',
  },
  {
    reminder_type: 'pre_weekend',
    description: 'Thursday 18:00 — nudge to confirm your status for the weekend.',
  },
];

/** Hour of day (local) reminders fire at. */
const FIRE_HOUR = 18;

const ISO_DATE = 'yyyy-MM-dd';

/** The given weekday (0=Sun … 6=Sat) on or after `from` (date-only). */
const onOrAfterWeekday = (from: Date, weekday: number): Date => {
  const start = startOfDay(from);
  const delta = (weekday - getDay(start) + 7) % 7;
  return addDays(start, delta);
};

const deepLinkForDate = (date: Date): string =>
  `intown:///?date=${format(date, ISO_DATE)}`;

/**
 * Build the reminder rows that should exist for `user` given `now`. Returns one
 * draft per rule for the current period. Callers upsert these by `dedupe_key`
 * (see `enqueueReminders`); the delivery worker gates actual send on
 * `send_after`, so drafts may be enqueued as soon as the period is known.
 */
export function buildRemindersForUser(input: {
  userId: string;
  channels: NotificationChannel[];
  now: Date;
}): ReminderDraft[] {
  const { userId, channels, now } = input;

  // weekly: the Monday on/after now begins the week we're nudging about; the
  // reminder fires the Sunday evening before it.
  const weekStart = onOrAfterWeekday(now, 1); // Monday
  const weeklyFire = setHours(addDays(weekStart, -1), FIRE_HOUR); // Sunday 18:00
  const weekly: ReminderDraft = {
    user_id: userId,
    reminder_type: 'weekly',
    channels,
    title: 'Set your week in InTown',
    body: "Let friends know which days you're around this week.",
    deep_link: deepLinkForDate(weekStart),
    scheduled_for: weeklyFire.toISOString(),
    send_after: weeklyFire.toISOString(),
    dedupe_key: `${userId}:weekly:${format(weekStart, ISO_DATE)}`,
  };

  // pre_weekend: the Friday on/after now starts the weekend; fire Thursday eve.
  const weekendStart = onOrAfterWeekday(now, 5); // Friday
  const preWeekendFire = setHours(addDays(weekendStart, -1), FIRE_HOUR); // Thu 18:00
  const preWeekend: ReminderDraft = {
    user_id: userId,
    reminder_type: 'pre_weekend',
    channels,
    title: 'Around this weekend?',
    body: "Update your status so friends know if you're in town.",
    deep_link: deepLinkForDate(weekendStart),
    scheduled_for: preWeekendFire.toISOString(),
    send_after: preWeekendFire.toISOString(),
    dedupe_key: `${userId}:pre_weekend:${format(weekendStart, ISO_DATE)}`,
  };

  return [weekly, preWeekend];
}

/**
 * Upsert reminder drafts into the queue, idempotent on `dedupe_key`. A row that
 * already exists for the period is left untouched (never revived once sent).
 * Returns the number of drafts written.
 */
export async function enqueueReminders(drafts: ReminderDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;

  const { error } = await supabase
    .from('reminders')
    .upsert(drafts, { onConflict: 'dedupe_key', ignoreDuplicates: true });

  if (error) throw error;
  return drafts.length;
}
