/**
 * Friend-status-change notifications (PRA-4).
 *
 * This module is the single, typed definition of *what counts as a notifiable
 * friend status change* and *which of those changes a given recipient should
 * actually be notified about*. It is pure and side-effect free: it decides,
 * it does not deliver.
 *
 * ## Why this exists alongside the DB trigger
 *
 * Detection + enqueue actually runs today inside the Postgres trigger
 * `enqueue_coordination_notifications` (see database/schema.sql). That trigger
 * is the runtime source of truth: it fires on writes to `calendar_entries`,
 * fans out over the changed user's friends, checks each friend's
 * `notification_preferences`, and upserts rows into
 * `coordination_notification_batches`.
 *
 * The rules it encodes, however, only existed as SQL. This module lifts the
 * *same ruleset* into typed, testable application code so that:
 *   - the "notifiable change" decision has one readable, reviewable definition,
 *   - a future delivery worker or server function can reuse it without
 *     re-deriving the logic from the trigger, and
 *   - the deliberately-ambiguous edge cases are encoded as explicit, commented
 *     branches instead of being implicit in a WHERE clause.
 *
 * The prose specification these two enforcement points must agree on lives in
 * docs/friend-status-change-notifications.md. If you change a rule here, change
 * it in the trigger and the doc too.
 *
 * The functions here take no `Date.now()` / timezone dependency: all date math
 * is done on the calendar day itself (a `YYYY-MM-DD` string, interpreted in
 * UTC) so the classification is deterministic and matches the trigger's DATE
 * arithmetic. Send-time scheduling (the `send_after` throttle) is a delivery
 * concern and is intentionally NOT modelled here.
 */

import {
  CalendarStatus,
  CoordinationNotificationPreferences,
  CoordinationNotificationType,
  NotificationChannel,
} from '../lib/types';

// --- Rule constants --------------------------------------------------------

/**
 * ISO-8601 weekday numbers (Mon=1 … Sun=7) that count as "the weekend" for the
 * `weekend_in_town` notification. Matches `day_of_week BETWEEN 5 AND 7` in the
 * trigger: Friday, Saturday, Sunday.
 */
export const WEEKEND_ISO_WEEKDAYS = [5, 6, 7] as const;

const VALID_CHANNELS: readonly NotificationChannel[] = ['push', 'email'];
const DEFAULT_CHANNELS: NotificationChannel[] = ['push'];

// --- Inputs / outputs ------------------------------------------------------

/**
 * Who wrote the status. Mirrors PRA-10's `StatusSource` but is declared locally
 * so this module does not depend on that in-flight change. Used only to flag
 * the calendar-inference open question (see the doc); it does NOT currently
 * gate classification — calendar-inferred changes are treated the same as
 * manual ones until product decides otherwise.
 */
export type StatusChangeSource = 'manual' | 'calendar_inferred';

/**
 * A single day's status transition for one user (the friend whose status
 * changed).
 *
 * `previousStatus` is `null` when the day had no entry before — i.e. a fresh
 * insert. This distinction matters: `back_in_town` requires an actual
 * out_of_town → in_town transition, so a first-ever `in_town` insert is NOT a
 * "back in town" event (see the trigger's `OLD.status = 'out_of_town'` guard).
 */
export interface StatusChange {
  /** Calendar day being set, `YYYY-MM-DD`. Not a wall-clock timestamp. */
  date: string;
  /** Status before this write, or `null` for a new day with no prior entry. */
  previousStatus: CalendarStatus | null;
  /** Status after this write. */
  nextStatus: CalendarStatus;
  /** Provenance of the write. Informational for now — see the doc. */
  source?: StatusChangeSource;
}

/**
 * A notifiable change, independent of any particular recipient's preferences.
 * The `startsOn`/`endsOn` window is the coordination window the notification
 * points at (the whole Fri–Sun weekend for `weekend_in_town`; the single day
 * for `back_in_town`) and matches the batch's `starts_on`/`ends_on`.
 */
export interface NotifiableChange {
  type: CoordinationNotificationType;
  startsOn: string;
  endsOn: string;
}

/** A notifiable change that a specific recipient has opted in to receive. */
export interface RecipientNotification extends NotifiableChange {
  channels: NotificationChannel[];
}

/** Context about the recipient⇄changed-friend relationship. */
export interface RecipientContext {
  /**
   * Whether the changed friend falls inside the recipient's chosen
   * notification scope. When the recipient scopes coordination notifications to
   * a single friend group (`preferences.group_id` is set), this must be `true`
   * only if the changed friend is a member of that group. When the recipient
   * has no group scope (`group_id` is null → all friends), pass `true`.
   *
   * Mirrors the trigger's
   *   `group_id IS NULL OR changed_user = ANY(group.friend_ids)`
   * membership check.
   */
  friendInScope: boolean;
}

// --- Date helpers (UTC, deterministic) -------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toUtcDate = (date: string): Date => {
  if (!DATE_RE.test(date)) {
    throw new Error(`Expected a YYYY-MM-DD calendar date, received "${date}"`);
  }
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatUtcDate = (value: Date): string => value.toISOString().slice(0, 10);

const addDays = (date: string, days: number): string => {
  const next = toUtcDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return formatUtcDate(next);
};

/** ISO-8601 weekday: Monday=1 … Sunday=7. */
export const isoWeekday = (date: string): number => {
  // getUTCDay: Sunday=0 … Saturday=6. Rotate so Monday=1 … Sunday=7.
  return ((toUtcDate(date).getUTCDay() + 6) % 7) + 1;
};

/**
 * The Fri–Sun weekend window that `date` belongs to, or `null` if `date` is a
 * weekday (Mon–Thu). Matches the trigger:
 *   weekend_start = date - GREATEST(isodow - 5, 0)
 *   weekend_end   = weekend_start + 2
 */
export const weekendWindowFor = (
  date: string
): { startsOn: string; endsOn: string } | null => {
  const weekday = isoWeekday(date);
  if (!WEEKEND_ISO_WEEKDAYS.includes(weekday as (typeof WEEKEND_ISO_WEEKDAYS)[number])) {
    return null;
  }
  const startsOn = addDays(date, -Math.max(weekday - 5, 0));
  return { startsOn, endsOn: addDays(startsOn, 2) };
};

// --- Core classification ---------------------------------------------------

/**
 * The heart of PRA-4: given one day's status change, what — if anything — is
 * notifiable about it? Recipient-independent; preference gating happens in
 * {@link selectRecipientNotifications}.
 *
 * Rules (kept in lockstep with the trigger and the doc):
 *   1. Only a change *to* `in_town` is ever notifiable. Going out_of_town, or
 *      any non-in_town result, produces nothing.
 *   2. A no-op write (status unchanged) produces nothing.
 *   3. `weekend_in_town` fires when the resulting `in_town` day lands on a
 *      Fri/Sat/Sun, pointing at that whole weekend.
 *   4. `back_in_town` fires only on a genuine out_of_town → in_town transition.
 *      A first-ever `in_town` insert (no prior entry) does NOT qualify.
 * A single change can yield BOTH (e.g. out_of_town → in_town on a Saturday).
 */
export const classifyStatusChange = (change: StatusChange): NotifiableChange[] => {
  const { previousStatus, nextStatus, date } = change;

  // Rule 1: only arriving at in_town matters. (AMBIGUITY: retractions/deletes
  // and → out_of_town are intentionally silent — see doc §"Ambiguities".)
  if (nextStatus !== 'in_town') {
    return [];
  }

  // Rule 2: a no-op re-write of the same status is not a change.
  if (previousStatus === nextStatus) {
    return [];
  }

  const notifiable: NotifiableChange[] = [];

  // Rule 3: weekend presence.
  const weekend = weekendWindowFor(date);
  if (weekend) {
    notifiable.push({ type: 'weekend_in_town', ...weekend });
  }

  // Rule 4: "back in town" requires an explicit out_of_town → in_town flip.
  // A brand-new in_town day (previousStatus === null) is NOT a return.
  if (previousStatus === 'out_of_town') {
    notifiable.push({ type: 'back_in_town', startsOn: date, endsOn: date });
  }

  return notifiable;
};

// --- Preference gating -----------------------------------------------------

/**
 * Normalise a recipient's delivery channels the same way the preferences
 * service does: keep only known channels, de-dupe, and fall back to push if the
 * result is empty. Ensures a notification always has at least one channel.
 */
export const normalizeDeliveryChannels = (
  channels?: NotificationChannel[] | null
): NotificationChannel[] => {
  if (!Array.isArray(channels)) return [...DEFAULT_CHANNELS];
  const unique = Array.from(
    new Set(channels.filter((channel) => VALID_CHANNELS.includes(channel)))
  );
  return unique.length > 0 ? unique : [...DEFAULT_CHANNELS];
};

const isTypeEnabled = (
  type: CoordinationNotificationType,
  preferences: CoordinationNotificationPreferences
): boolean =>
  type === 'weekend_in_town'
    ? preferences.weekend_in_town_enabled
    : preferences.back_in_town_enabled;

/**
 * Given the notifiable changes for a friend's status write and one recipient's
 * preferences, return the notifications that recipient should actually get
 * (empty if none). This is the "only notify users who enabled it, on the
 * channels they chose" acceptance criterion, expressed as a pure function.
 *
 * Gating order mirrors the trigger's WHERE + IF clauses:
 *   1. Master switch: `coordination_enabled` must be true.
 *   2. Scope: if the recipient scoped to a group, the changed friend must be in
 *      it (`context.friendInScope`).
 *   3. Per-type switch: `weekend_in_town_enabled` / `back_in_town_enabled`.
 * Surviving notifications carry the recipient's normalised delivery channels.
 */
export const selectRecipientNotifications = (
  changes: NotifiableChange[],
  preferences: CoordinationNotificationPreferences,
  context: RecipientContext
): RecipientNotification[] => {
  if (!preferences.coordination_enabled) return [];
  if (!context.friendInScope) return [];

  const channels = normalizeDeliveryChannels(preferences.delivery_channels);

  return changes
    .filter((change) => isTypeEnabled(change.type, preferences))
    .map((change) => ({ ...change, channels }));
};

/**
 * Convenience one-shot: classify a raw status change and immediately filter it
 * down to what a single recipient should receive. Equivalent to
 * `selectRecipientNotifications(classifyStatusChange(change), prefs, context)`.
 */
export const notifiableNotificationsForRecipient = (
  change: StatusChange,
  preferences: CoordinationNotificationPreferences,
  context: RecipientContext
): RecipientNotification[] =>
  selectRecipientNotifications(classifyStatusChange(change), preferences, context);
