/**
 * Analytics instrumentation for Reminders & Notifications (PRA-5).
 *
 * This is the single, typed seam every reminder/notification event flows
 * through. It intentionally does NOT bundle a specific analytics vendor —
 * the app has no product-analytics SDK yet, and picking one is out of scope
 * for this issue. Instead it exposes:
 *
 *   - a strongly-typed event taxonomy (see `AnalyticsEvent`), so call sites
 *     can only emit defined events with well-formed properties, and
 *   - a pluggable sink (`configureAnalytics`) that a real provider (PostHog,
 *     Segment, Amplitude, a Supabase `analytics_events` table, …) can be wired
 *     into later without touching any call site.
 *
 * Until a sink is configured the default behaviour is a dev-only console log
 * plus a small in-memory ring buffer (useful for tests and manual QA). In
 * production with no sink, events are dropped — instrumentation is best-effort
 * and must never throw into a user flow.
 *
 * The event definitions here are the source of truth for the reporting spec in
 * docs/reminder-notification-instrumentation.md. Keep the two in sync.
 */

// `__DEV__` is injected by the React Native / Expo runtime.
declare const __DEV__: boolean;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

// --- Shared property vocabularies -----------------------------------------

/** How a status change was initiated. Drives reminder-attribution reporting. */
export type StatusUpdateSource =
  | 'manual_calendar' // user tapped a day in their calendar, unprompted
  | 'onboarding' // first-run "set this week" availability flow
  | 'reminder' // opened directly from a status-freshness reminder
  | 'notification' // opened from a friend-status coordination notification
  | 'calendar_sync'; // auto-applied by Google Calendar Sync (PRA-10), no user action

/** Status-freshness reminders that nudge a user to refresh their own status. */
export type ReminderType = 'weekly' | 'pre_weekend';

/** Delivery channels supported by the project (mirrors NotificationChannel). */
export type DeliveryChannel = 'push' | 'email';

/** Coordination-notification kinds (mirrors CoordinationNotificationType). */
export type FriendStatusNotificationType = 'weekend_in_town' | 'back_in_town';

// --- Event taxonomy --------------------------------------------------------
//
// Three families, matching PRA-5's acceptance criteria:
//   1. Reminder delivery + lifecycle          (reminder_*)
//   2. Reminder-driven status updates         (status_updated)
//   3. Friend-status notification engagement  (friend_status_notification_*)
// Plus preference opt-in/opt-out, which the PRD counts as a success measure.

export type AnalyticsEventMap = {
  // -- 1. Reminder lifecycle ------------------------------------------------
  // NOTE: reminders themselves are not built yet (see the PRD). These are
  // defined now so the delivery worker and any client handler emit a stable
  // shape from day one. `reminder_id` correlates the whole lifecycle and, via
  // `status_updated.reminder_id`, ties a reminder to the update it drove.
  reminder_scheduled: {
    reminder_id: string;
    user_id: string;
    reminder_type: ReminderType;
    channel: DeliveryChannel;
    /** ISO timestamp the reminder is intended to fire at. */
    scheduled_for: string;
  };
  reminder_delivered: {
    reminder_id: string;
    user_id: string;
    reminder_type: ReminderType;
    channel: DeliveryChannel;
    delivered_at: string;
  };
  reminder_opened: {
    reminder_id: string;
    user_id: string;
    reminder_type: ReminderType;
    channel: DeliveryChannel;
  };
  reminder_dismissed: {
    reminder_id: string;
    user_id: string;
    reminder_type: ReminderType;
    channel: DeliveryChannel;
  };

  // -- 2. Reminder-driven status update ------------------------------------
  // Fires whenever a calendar day's status is persisted. `source` carries the
  // attribution; `reminder_id` is set only when the update is a direct,
  // in-session continuation of a reminder/notification open. Window-based
  // attribution (updates within N hours of a delivery) is handled in
  // reporting — see the doc — so an unset `reminder_id` does not mean
  // "not reminder-driven".
  status_updated: {
    user_id: string;
    /** The calendar day being set (YYYY-MM-DD), not the event time. */
    date: string;
    status: 'in_town' | 'out_of_town';
    source: StatusUpdateSource;
    /** Present when directly attributable to a reminder in the same session. */
    reminder_id?: string;
  };

  // -- 3. Friend-status notification engagement ----------------------------
  friend_status_notification_delivered: {
    /** `batch_key` from coordination_notification_batches. */
    batch_key: string;
    recipient_id: string;
    notification_type: FriendStatusNotificationType;
    channel: DeliveryChannel;
    /** How many friends' changes were bundled into this batch. */
    friend_count: number;
  };
  friend_status_notification_opened: {
    recipient_id: string;
    /** The day the deep link targets (YYYY-MM-DD). */
    date: string;
    /** Group the notification was scoped to, or 'all'. */
    group_id: string;
    /** Known only if the deep link carries it; batches don't today. */
    batch_key?: string;
    notification_type?: FriendStatusNotificationType;
  };
  friend_status_notification_dismissed: {
    batch_key: string;
    recipient_id: string;
    notification_type: FriendStatusNotificationType;
  };

  // -- Preference controls (opt-in / opt-out success measure) --------------
  notification_preferences_changed: {
    user_id: string;
    /** Which preference keys changed in this save. */
    changed: string[];
    coordination_enabled: boolean;
    weekend_in_town_enabled: boolean;
    back_in_town_enabled: boolean;
    delivery_channels: DeliveryChannel[];
  };
};

export type AnalyticsEventName = keyof AnalyticsEventMap;

/** A concrete tracked event: its name plus its typed properties. */
export type AnalyticsEvent = {
  [K in AnalyticsEventName]: {
    name: K;
    properties: AnalyticsEventMap[K];
    /** Epoch ms the event was recorded. */
    timestamp: number;
  };
}[AnalyticsEventName];

/** A destination for tracked events (a vendor SDK, an HTTP endpoint, …). */
export type AnalyticsSink = (event: AnalyticsEvent) => void;

// --- Runtime ---------------------------------------------------------------

let sink: AnalyticsSink | null = null;

const BUFFER_LIMIT = 100;
const buffer: AnalyticsEvent[] = [];

/**
 * Wire a real analytics destination. Call once at app startup. Passing `null`
 * detaches the current sink (events fall back to buffer + dev logging).
 */
export function configureAnalytics(nextSink: AnalyticsSink | null): void {
  sink = nextSink;
}

/**
 * Record an event. Strongly typed: `properties` is inferred from `name`.
 * Never throws — a broken sink or serialization must not break a user flow.
 */
export function track<K extends AnalyticsEventName>(
  name: K,
  properties: AnalyticsEventMap[K]
): void {
  const event = {
    name,
    properties,
    timestamp: Date.now(),
  } as AnalyticsEvent;

  buffer.push(event);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();

  if (isDev) {
    // eslint-disable-next-line no-console
    console.log(`[analytics] ${name}`, properties);
  }

  if (sink) {
    try {
      sink(event);
    } catch (error) {
      if (isDev) {
        // eslint-disable-next-line no-console
        console.warn('[analytics] sink threw', error);
      }
    }
  }
}

/** Recent events, oldest first. For tests and manual QA only. */
export function getBufferedEvents(): readonly AnalyticsEvent[] {
  return buffer;
}

/** Clear the in-memory buffer. For tests. */
export function resetAnalyticsBuffer(): void {
  buffer.length = 0;
}
