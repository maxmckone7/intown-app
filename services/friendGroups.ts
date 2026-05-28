import { supabase } from '../lib/supabase';
import { FriendGroup } from '../lib/types';

type CreateFriendGroupInput = {
  name: string;
  friend_ids?: string[];
};

export const friendGroupsService = {
  async getGroups(userId: string): Promise<FriendGroup[]> {
    const { data, error } = await supabase
      .from('friend_groups')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async createGroup(
    userId: string,
    input: CreateFriendGroupInput
  ): Promise<FriendGroup> {
    const { data, error } = await supabase
      .from('friend_groups')
      .insert({
        user_id: userId,
        name: input.name,
        friend_ids: input.friend_ids ?? [],
      })
      .select('*')
      .single();

    if (error) throw error;
    return data;
  },

  async updateGroup(
    groupId: string,
    values: Partial<Pick<FriendGroup, 'name' | 'friend_ids'>>
  ): Promise<FriendGroup> {
    const { data, error } = await supabase
      .from('friend_groups')
      .update(values)
      .eq('id', groupId)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  },

  async deleteGroup(groupId: string): Promise<void> {
    const { error } = await supabase.from('friend_groups').delete().eq('id', groupId);
    if (error) throw error;
  },
};
