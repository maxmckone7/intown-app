import { supabase } from '../lib/supabase';
import { CalendarEntry, CalendarStatus, StatusSource } from '../lib/types';

/**
 * Provenance for a status write. Omitting it (or passing nothing) records a
 * `manual` entry — the historical behavior — so every existing call site keeps
 * writing user-authoritative days. The Google Calendar Sync integration
 * (services/calendarStatusSync.ts) passes `source: 'calendar_inferred'` with the
 * snapshot timestamp it inferred from.
 */
export interface SetEntryOptions {
  source?: StatusSource;
  /** ISO timestamp of the calendar snapshot, for `calendar_inferred` writes. */
  inferredSyncedAt?: string | null;
}

export const calendarService = {
  async getEntries(userId: string, startDate?: string, endDate?: string): Promise<CalendarEntry[]> {
    let query = supabase
      .from('calendar_entries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (startDate) {
      query = query.gte('date', startDate);
    }
    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  },

  async setEntry(
    userId: string,
    date: string,
    status: CalendarStatus,
    options: SetEntryOptions = {}
  ): Promise<CalendarEntry> {
    // Default to a manual, user-authoritative write. A manual write also clears
    // any inference provenance, so re-tapping a previously auto-set day hands
    // ownership of it back to the user (see calendarStatusSync source-of-truth).
    const source: StatusSource = options.source ?? 'manual';
    const inferredSyncedAt =
      source === 'calendar_inferred' ? options.inferredSyncedAt ?? null : null;

    // Check if entry exists
    const { data: existing } = await supabase
      .from('calendar_entries')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (existing) {
      // Upsert by primary key to avoid the update/filter chain that can fail in
      // the current Supabase runtime.
      const { data, error } = await supabase
        .from('calendar_entries')
        .upsert(
          {
            id: existing.id,
            user_id: userId,
            date,
            status,
            source,
            inferred_synced_at: inferredSyncedAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      // Create new entry
      const { data, error } = await supabase
        .from('calendar_entries')
        .insert({
          user_id: userId,
          date,
          status,
          source,
          inferred_synced_at: inferredSyncedAt,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  },

  async deleteEntry(userId: string, date: string): Promise<void> {
    const { error } = await supabase
      .from('calendar_entries')
      .delete()
      .eq('user_id', userId)
      .eq('date', date);

    if (error) throw error;
  },

  async getFriendsEntries(
    userId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<CalendarEntry & { friend_name: string; friend_id: string }>> {
    // Get all accepted friendships
    const { data: friendships, error: friendshipError } = await supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted');

    if (friendshipError) throw friendshipError;

    if (!friendships || friendships.length === 0) {
      return [];
    }

    const friendIds = (friendships as Array<{ friend_id: string }>).map(
      (friendship) => friendship.friend_id
    );

    let query = supabase
      .from('calendar_entries')
      .select(`
        *,
        users (
          id,
          name
        )
      `)
      .in('user_id', friendIds)
      .order('date', { ascending: true });

    if (startDate) {
      query = query.gte('date', startDate);
    }
    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((entry: any) => ({
      ...entry,
      friend_name: entry.users?.name || 'Unknown',
      friend_id: entry.user_id,
    }));
  },
};

