/**
 * Reminder & notification delivery (PRA-2 · Reminders & Notifications).
 *
 * This module is the single seam through which reminders and coordination
 * notifications are actually *sent*. It deliberately mirrors the shape of
 * services/analytics.ts: a typed core with a **pluggable transport per channel**
 * and no bundled vendor. The app has not yet chosen a push or email provider
 * (see docs/reminder-delivery.md §"Open questions / dependencies"), so until a
 * transport is wired every channel reports a *detectable* `channel_not_configured`
 * failure rather than silently dropping the message.
 *
 * Responsibilities:
 *   - `configureDeliveryChannels` — attach real push/email transports at startup.
 *   - `deliverMessage` — send one message across its selected channels and return
 *     a per-channel outcome (this is where "delivery across selected channels"
 *     and "failures can be detected" live; pure and unit-testable, no I/O here).
 *   - `deliverReminder` / `deliverCoordinationBatch` — map a queued record to
 *     messages, deliver, and emit the analytics events defined in PRA-5.
 *   - `runReminderDelivery` / `runCoordinationDelivery` — the worker loop: claim
 *     due rows from a store, deliver them, and persist sent/failed status.
 *
 * The reminder *rules* that decide what gets queued live in
 * services/reminderRules.ts; the *scheduler* that runs this worker on a cadence
 * is an external dependency (see the doc). This module only owns delivery.
 */

import { supabase } from '../lib/supabase';
import { track } from './analytics';
import {
  CoordinationNotificationBatch,
  DeliveryFailureReason,
  NotificationChannel,
  Reminder,
} from '../lib/types';

// `__DEV__` is injected by the React Native / Expo runtime.
declare const __DEV__: boolean;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

// --- Channel transport seam ------------------------------------------------

/** A single notification the transport must hand to its provider. */
export interface DeliveryMessage {
  channel: NotificationChannel;
  /** Who receives it — used by the transport to resolve a token / email. */
  recipientId: string;
  title: string;
  body: string;
  /** In-app destination when the notification is opened. */
  deepLink: string;
}

/** Result of a single channel attempt. `ok:false` always names a reason. */
export type ChannelSendOutcome =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      reason: DeliveryFailureReason;
      /** Human-readable detail for logs/alerting; never shown to users. */
      detail?: string;
      /** Whether re-attempting the same message could plausibly succeed. */
      retryable: boolean;
    };

/**
 * A concrete channel implementation (Expo push, APNs/FCM, an email provider …).
 * Implementations MUST resolve — never throw — but `deliverToChannel` defends
 * against throws anyway so a broken transport can't take down the worker.
 */
export interface ChannelTransport {
  readonly channel: NotificationChannel;
  send(message: DeliveryMessage): Promise<ChannelSendOutcome>;
}

const transports: Partial<Record<NotificationChannel, ChannelTransport>> = {};

/**
 * Wire real transports. Call once at worker startup. Pass `null` for a channel
 * to detach it (that channel then reports `channel_not_configured`). Only the
 * channels supplied are changed, so callers can configure push and email
 * independently as each provider decision lands.
 */
export function configureDeliveryChannels(
  next: Partial<Record<NotificationChannel, ChannelTransport | null>>
): void {
  for (const key of Object.keys(next) as NotificationChannel[]) {
    const transport = next[key];
    if (transport) {
      transports[key] = transport;
    } else {
      delete transports[key];
    }
  }
}

/** The channels that currently have a transport attached. */
export function configuredChannels(): NotificationChannel[] {
  return (Object.keys(transports) as NotificationChannel[]).filter(
    (channel) => Boolean(transports[channel])
  );
}

// --- Delivery core (pure — no DB, no analytics) ----------------------------

/** Per-channel attempt plus the aggregate verdict for one message. */
export interface DeliveryResult {
  channels: Array<{ channel: NotificationChannel; outcome: ChannelSendOutcome }>;
  /** True when at least one selected channel accepted the message. */
  delivered: boolean;
  /** Channels that were selected but failed. */
  failedChannels: NotificationChannel[];
  /** The reason to record when nothing was delivered (first failure). */
  failureReason: DeliveryFailureReason | null;
  /**
   * True when delivery failed but a later attempt could succeed (e.g. the
   * channel is not configured yet, or the provider had a transient error).
   * A non-retryable failure (invalid message) should not be re-queued.
   */
  retryable: boolean;
}

const validateMessage = (message: DeliveryMessage): boolean =>
  Boolean(message.recipientId && message.title && message.body);

/** Attempt one channel, converting a missing transport or a throw into a typed outcome. */
export async function deliverToChannel(
  message: DeliveryMessage
): Promise<ChannelSendOutcome> {
  if (!validateMessage(message)) {
    return { ok: false, reason: 'invalid_message', retryable: false };
  }

  const transport = transports[message.channel];
  if (!transport) {
    // No vendor wired yet. This is the expected default today and is treated as
    // a *retryable* failure: the same reminder can go out once a transport is
    // configured. See the doc's open questions.
    return {
      ok: false,
      reason: 'channel_not_configured',
      detail: `no transport for "${message.channel}"`,
      retryable: true,
    };
  }

  try {
    return await transport.send(message);
  } catch (error) {
    return {
      ok: false,
      reason: 'provider_error',
      detail: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

/**
 * Deliver one message across the given channels. Delivery counts as successful
 * if *any* channel accepts it (the user is reachable); channels that failed are
 * still reported so partial failures are observable. When nothing is delivered,
 * `failureReason` is the first failure's reason and `retryable` is true only if
 * every failure is retryable.
 */
export async function deliverMessage(
  base: Omit<DeliveryMessage, 'channel'>,
  channels: NotificationChannel[]
): Promise<DeliveryResult> {
  const selected = dedupeChannels(channels);

  const results = await Promise.all(
    selected.map(async (channel) => ({
      channel,
      outcome: await deliverToChannel({ ...base, channel }),
    }))
  );

  const delivered = results.some((r) => r.outcome.ok);
  const failures = results.filter(
    (r): r is { channel: NotificationChannel; outcome: Extract<ChannelSendOutcome, { ok: false }> } =>
      !r.outcome.ok
  );

  return {
    channels: results,
    delivered,
    failedChannels: failures.map((f) => f.channel),
    failureReason: delivered ? null : failures[0]?.outcome.reason ?? 'invalid_message',
    retryable: !delivered && failures.length > 0 && failures.every((f) => f.outcome.retryable),
  };
}

const dedupeChannels = (channels: NotificationChannel[]): NotificationChannel[] => {
  const valid = channels.filter(
    (channel) => channel === 'push' || channel === 'email'
  );
  const unique = Array.from(new Set(valid));
  // Nothing selected is itself an (empty) failure surface; default to push so a
  // misconfigured row still produces a detectable `channel_not_configured`.
  return unique.length > 0 ? unique : ['push'];
};

// --- Record-level delivery (maps a queued row → messages + analytics) ------

/**
 * Deliver a single status-freshness reminder. Emits `reminder_delivered` for
 * every channel that accepted it (one event per channel, matching the PRA-5
 * event shape). Does not touch the DB — callers persist the returned result.
 */
export async function deliverReminder(reminder: Reminder): Promise<DeliveryResult> {
  const result = await deliverMessage(
    {
      recipientId: reminder.user_id,
      title: reminder.title,
      body: reminder.body,
      deepLink: reminder.deep_link,
    },
    reminder.channels
  );

  const deliveredAt = new Date().toISOString();
  for (const { channel, outcome } of result.channels) {
    if (outcome.ok) {
      track('reminder_delivered', {
        reminder_id: reminder.id,
        user_id: reminder.user_id,
        reminder_type: reminder.reminder_type,
        channel,
        delivered_at: deliveredAt,
      });
    }
  }

  return result;
}

/**
 * Deliver a single coordination-notification batch. Emits
 * `friend_status_notification_delivered` per accepted channel.
 */
export async function deliverCoordinationBatch(
  batch: CoordinationNotificationBatch
): Promise<DeliveryResult> {
  const result = await deliverMessage(
    {
      recipientId: batch.recipient_id,
      title: batch.title,
      body: batch.body,
      deepLink: batch.deep_link,
    },
    batch.channels
  );

  for (const { channel, outcome } of result.channels) {
    if (outcome.ok) {
      track('friend_status_notification_delivered', {
        batch_key: batch.batch_key,
        recipient_id: batch.recipient_id,
        notification_type: batch.notification_type,
        channel,
        friend_count: batch.friend_ids.length,
      });
    }
  }

  return result;
}

// --- Worker loop (claims due rows and persists the outcome) ----------------

/** Summary of one worker pass, for logging and health checks. */
export interface DeliveryRunSummary {
  claimed: number;
  delivered: number;
  failed: number;
  /** Failed-but-retryable rows left queued for a later pass. */
  retryable: number;
}

/**
 * Storage seam for the reminder worker. The default implementation
 * (`supabaseReminderStore`) talks to Supabase, but the worker takes any store so
 * it is testable without a database and so the runtime (an Edge Function, a
 * server cron, …) can supply a service-role client. See the doc for why the
 * production worker cannot use the anon client.
 */
export interface ReminderDeliveryStore {
  claimDue(now: string, limit: number): Promise<Reminder[]>;
  markSent(id: string, attempts: number): Promise<void>;
  markFailed(
    id: string,
    reason: DeliveryFailureReason,
    retryable: boolean,
    attempts: number
  ): Promise<void>;
}

const DEFAULT_LIMIT = 100;

export const supabaseReminderStore: ReminderDeliveryStore = {
  async claimDue(now, limit) {
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('status', 'queued')
      .lte('send_after', now)
      .order('send_after', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data as Reminder[]) || [];
  },
  async markSent(id, attempts) {
    const { error } = await supabase
      .from('reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString(), attempts })
      .eq('id', id);
    if (error) throw error;
  },
  async markFailed(id, reason, retryable, attempts) {
    // Retryable failures stay `queued` so the next pass re-attempts them once a
    // transport exists; only a terminal failure flips to `failed`.
    const { error } = await supabase
      .from('reminders')
      .update({
        status: retryable ? 'queued' : 'failed',
        failure_reason: reason,
        failed_at: retryable ? null : new Date().toISOString(),
        attempts,
      })
      .eq('id', id);
    if (error) throw error;
  },
};

/**
 * Deliver all reminders that are due at `now`. Runs delivery for each claimed
 * row and persists the outcome. Never throws per-row: a single bad row is
 * recorded as failed and the pass continues.
 */
export async function runReminderDelivery(options?: {
  now?: string;
  limit?: number;
  store?: ReminderDeliveryStore;
}): Promise<DeliveryRunSummary> {
  const now = options?.now ?? new Date().toISOString();
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const store = options?.store ?? supabaseReminderStore;

  const due = await store.claimDue(now, limit);
  const summary: DeliveryRunSummary = {
    claimed: due.length,
    delivered: 0,
    failed: 0,
    retryable: 0,
  };

  for (const reminder of due) {
    const attempts = reminder.attempts + 1;
    try {
      const result = await deliverReminder(reminder);
      if (result.delivered) {
        await store.markSent(reminder.id, attempts);
        summary.delivered += 1;
      } else {
        const reason = result.failureReason ?? 'provider_error';
        await store.markFailed(reminder.id, reason, result.retryable, attempts);
        summary.failed += 1;
        if (result.retryable) summary.retryable += 1;
      }
    } catch (error) {
      // Persistence itself failed — count it and keep going.
      summary.failed += 1;
      if (isDev) {
        // eslint-disable-next-line no-console
        console.warn('[reminderDelivery] reminder row failed', reminder.id, error);
      }
    }
  }

  return summary;
}

/** Storage seam for the coordination-notification worker (mirrors the above). */
export interface CoordinationDeliveryStore {
  claimDue(now: string, limit: number): Promise<CoordinationNotificationBatch[]>;
  markSent(id: string, attempts: number): Promise<void>;
  markFailed(
    id: string,
    reason: DeliveryFailureReason,
    retryable: boolean,
    attempts: number
  ): Promise<void>;
}

export const supabaseCoordinationStore: CoordinationDeliveryStore = {
  async claimDue(now, limit) {
    const { data, error } = await supabase
      .from('coordination_notification_batches')
      .select('*')
      .eq('status', 'queued')
      .lte('send_after', now)
      .order('send_after', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data as CoordinationNotificationBatch[]) || [];
  },
  async markSent(id, attempts) {
    const { error } = await supabase
      .from('coordination_notification_batches')
      .update({ status: 'sent', sent_at: new Date().toISOString(), attempts })
      .eq('id', id);
    if (error) throw error;
  },
  async markFailed(id, reason, retryable, attempts) {
    const { error } = await supabase
      .from('coordination_notification_batches')
      .update({
        status: retryable ? 'queued' : 'failed',
        failure_reason: reason,
        failed_at: retryable ? null : new Date().toISOString(),
        attempts,
      })
      .eq('id', id);
    if (error) throw error;
  },
};

/** Deliver all coordination batches due at `now`. See `runReminderDelivery`. */
export async function runCoordinationDelivery(options?: {
  now?: string;
  limit?: number;
  store?: CoordinationDeliveryStore;
}): Promise<DeliveryRunSummary> {
  const now = options?.now ?? new Date().toISOString();
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const store = options?.store ?? supabaseCoordinationStore;

  const due = await store.claimDue(now, limit);
  const summary: DeliveryRunSummary = {
    claimed: due.length,
    delivered: 0,
    failed: 0,
    retryable: 0,
  };

  for (const batch of due) {
    const attempts = batch.attempts + 1;
    try {
      const result = await deliverCoordinationBatch(batch);
      if (result.delivered) {
        await store.markSent(batch.id, attempts);
        summary.delivered += 1;
      } else {
        const reason = result.failureReason ?? 'provider_error';
        await store.markFailed(batch.id, reason, result.retryable, attempts);
        summary.failed += 1;
        if (result.retryable) summary.retryable += 1;
      }
    } catch (error) {
      summary.failed += 1;
      if (isDev) {
        // eslint-disable-next-line no-console
        console.warn('[reminderDelivery] batch row failed', batch.id, error);
      }
    }
  }

  return summary;
}
