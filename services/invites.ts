import { supabase } from '../lib/supabase';
import { inviteOrigin } from '../lib/invite';
import { Invite } from '../lib/types';

type CreateInviteInput = {
  invitee_email?: string;
  invitee_phone?: string;
  expires_at?: string;
};

const inviteUrl = (token: string) => `${inviteOrigin}/invite/${token}`;

const getCurrentUserId = async () => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  if (!user) throw new Error('You must be signed in to create invites.');

  return user.id;
};

export const invitesService = {
  async createInvite(input: CreateInviteInput = {}): Promise<Invite> {
    const inviterId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('invites')
      .insert({
        inviter_id: inviterId,
        invitee_email: input.invitee_email ?? null,
        invitee_phone: input.invitee_phone ?? null,
        expires_at: input.expires_at ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;
    return data;
  },

  async createInviteLink(input: CreateInviteInput = {}): Promise<string> {
    const invite = await this.createInvite(input);
    return inviteUrl(invite.token);
  },

  async getInviteByToken(token: string): Promise<Invite | null> {
    const { data, error } = await supabase
      .from('invites')
      .select('*')
      .eq('token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data;
  },

  async acceptInvite(token: string): Promise<Invite> {
    const { data, error } = await supabase.rpc('accept_invite', {
      invite_token: token,
    });

    if (error) throw error;
    return data;
  },
};
