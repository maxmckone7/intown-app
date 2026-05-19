import { supabase } from '../lib/supabase';
import { User, FriendWithStatus } from '../lib/types';

export const friendsService = {
  async searchUsers(query: string, currentUserId: string): Promise<User[]> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .or(`email.ilike.%${query}%,name.ilike.%${query}%`)
      .neq('id', currentUserId)
      .limit(20);

    if (error) throw error;
    return data || [];
  },

  async getFriends(userId: string): Promise<FriendWithStatus[]> {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        id,
        status,
        friend_id,
        users!friendships_friend_id_fkey (
          id,
          email,
          name,
          avatar_url,
          created_at
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'accepted');

    if (error) throw error;

    return (data || []).map((friendship: any) => {
      const friend = Array.isArray(friendship.users) ? friendship.users[0] : friendship.users;
      return {
        ...friend,
        friendship_id: friendship.id,
        friendship_status: friendship.status,
      };
    });
  },

  async getPendingRequests(userId: string): Promise<FriendWithStatus[]> {
    const { data, error } = await supabase
      .from('friendships')
      .select(`
        id,
        status,
        friend_id,
        users!friendships_friend_id_fkey (
          id,
          email,
          name,
          avatar_url,
          created_at
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error) throw error;

    return (data || []).map((friendship: any) => {
      const friend = Array.isArray(friendship.users) ? friendship.users[0] : friendship.users;
      return {
        ...friend,
        friendship_id: friendship.id,
        friendship_status: friendship.status,
      };
    });
  },

  async followUser(userId: string, friendId: string): Promise<void> {
    // Check if friendship already exists
    const { data: existing } = await supabase
      .from('friendships')
      .select('*')
      .eq('user_id', userId)
      .eq('friend_id', friendId)
      .single();

    if (existing) {
      throw new Error('Friendship already exists');
    }

    // Check for reverse friendship (if they already follow us, auto-accept)
    const { data: reverse } = await supabase
      .from('friendships')
      .select('*')
      .eq('user_id', friendId)
      .eq('friend_id', userId)
      .single();

    if (reverse) {
      // Auto-accept both sides
      await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', reverse.id);

      const { error } = await supabase
        .from('friendships')
        .insert({
          user_id: userId,
          friend_id: friendId,
          status: 'accepted',
        });

      if (error) throw error;
    } else {
      // Create pending friendship (for MVP, we'll auto-accept)
      const { error } = await supabase
        .from('friendships')
        .insert({
          user_id: userId,
          friend_id: friendId,
          status: 'accepted', // Auto-accept for MVP
        });

      if (error) throw error;
    }
  },

  async unfollowUser(userId: string, friendId: string): Promise<void> {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('user_id', userId)
      .eq('friend_id', friendId);

    if (error) throw error;
  },

  async isFollowing(userId: string, friendId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('friendships')
      .select('id')
      .eq('user_id', userId)
      .eq('friend_id', friendId)
      .eq('status', 'accepted')
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows returned
    return !!data;
  },
};

