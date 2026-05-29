import { supabase } from '../lib/supabase';
import { VisibilityLevel, VisibilityRule, VisibilityScope } from '../lib/types';

export type PrivacySettings = {
  appearAway: boolean;
  defaultVisibility: VisibilityLevel;
  rules: VisibilityRule[];
};

/** Effective visibility of one of my friends toward me (the viewer). */
export type ViewerVisibility = {
  friendId: string;
  level: VisibilityLevel;
};

export const privacyService = {
  /** Load the current user's own privacy settings and all of their rules. */
  async getSettings(userId: string): Promise<PrivacySettings> {
    const [{ data: userRow, error: userError }, { data: rules, error: rulesError }] =
      await Promise.all([
        supabase
          .from('users')
          .select('appear_away, default_visibility')
          .eq('id', userId)
          .single(),
        supabase
          .from('calendar_visibility')
          .select('*')
          .eq('owner_id', userId),
      ]);

    if (userError) throw userError;
    if (rulesError) throw rulesError;

    return {
      appearAway: Boolean(userRow?.appear_away),
      defaultVisibility: (userRow?.default_visibility as VisibilityLevel) ?? 'full',
      rules: (rules as VisibilityRule[]) ?? [],
    };
  },

  async setAppearAway(userId: string, appearAway: boolean): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ appear_away: appearAway })
      .eq('id', userId);

    if (error) throw error;
  },

  async setDefaultVisibility(userId: string, level: VisibilityLevel): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ default_visibility: level })
      .eq('id', userId);

    if (error) throw error;
  },

  /**
   * Set (or update) a per-friend or per-group visibility rule. Upserts on the
   * (owner_id, scope_type, scope_id) uniqueness so re-setting a scope replaces
   * the existing rule rather than erroring.
   */
  async setRule(
    userId: string,
    scopeType: VisibilityScope,
    scopeId: string,
    level: VisibilityLevel
  ): Promise<VisibilityRule> {
    const { data, error } = await supabase
      .from('calendar_visibility')
      .upsert(
        {
          owner_id: userId,
          scope_type: scopeType,
          scope_id: scopeId,
          level,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_id,scope_type,scope_id' }
      )
      .select('*')
      .single();

    if (error) throw error;
    return data as VisibilityRule;
  },

  /** Remove a rule so the scope falls back to the owner's default visibility. */
  async clearRule(
    userId: string,
    scopeType: VisibilityScope,
    scopeId: string
  ): Promise<void> {
    const { error } = await supabase
      .from('calendar_visibility')
      .delete()
      .eq('owner_id', userId)
      .eq('scope_type', scopeType)
      .eq('scope_id', scopeId);

    if (error) throw error;
  },

  /**
   * For each accepted friend, the visibility they grant *to me*. Used by the
   * calendar/friends views so hidden friends are excluded and limited friends
   * aren't optimistically assumed to be in town.
   */
  async getViewerVisibility(): Promise<Map<string, VisibilityLevel>> {
    const { data, error } = await supabase.rpc('my_friends_visibility');
    if (error) throw error;

    const map = new Map<string, VisibilityLevel>();
    for (const row of (data as ViewerVisibilityRow[]) ?? []) {
      map.set(row.friend_id, row.level as VisibilityLevel);
    }
    return map;
  },
};

type ViewerVisibilityRow = { friend_id: string; level: string };
