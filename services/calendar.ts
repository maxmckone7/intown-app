import { supabase } from '../lib/supabase';
import { CalendarEntry, CalendarStatus } from '../lib/types';

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

  async setEntry(userId: string, date: string, status: CalendarStatus): Promise<CalendarEntry> {
    // Check if entry exists
    const { data: existing } = await supabase
      .from('calendar_entries')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (existing) {
      // Update existing entry
      const { data, error } = await supabase
        .from('calendar_entries')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
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

    const friendIds = friendships.map((f: { friend_id: string }) => f.friend_id);

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

