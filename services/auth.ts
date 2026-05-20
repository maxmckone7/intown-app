import { supabase } from '../lib/supabase';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

export interface AuthUser extends SupabaseUser {
WebBrowser.maybeCompleteAuthSession();

export type AuthUser = SupabaseUser & {
  user_metadata: SupabaseUser['user_metadata'] & {
    name?: string;
    full_name?: string;
    avatar_url?: string;
    picture?: string;
  };
};

const OAUTH_REDIRECT_PATH = 'auth/callback';

const getOAuthRedirectUrl = () =>
  AuthSession.makeRedirectUri({
    scheme: 'intown',
    path: OAUTH_REDIRECT_PATH,
    isTripleSlashed: true,
  });

const getOAuthProfile = (user: SupabaseUser) => {
  const metadata = user.user_metadata as AuthUser['user_metadata'];

  return {
    id: user.id,
    email: user.email!,
    name: metadata.name || metadata.full_name || user.email,
    avatar_url: metadata.avatar_url || metadata.picture || null,
  };
};

const ensureUserProfile = async (user: SupabaseUser | null) => {
  if (!user?.email) {
    return;
  }

  const { error } = await supabase
    .from('users')
    .upsert(getOAuthProfile(user), { onConflict: 'id' });

  if (error) {
    console.error('User profile upsert error:', error);
    throw error;
  }
};

const completeOAuthSignIn = async (provider: 'google' | 'apple') => {
  const redirectTo = getOAuthRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });

  if (error) throw error;
  if (!data?.url) {
    throw new Error(`${provider} sign-in did not return an OAuth URL.`);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success') {
    throw new Error(`${provider} sign-in was cancelled.`);
  }

  const params = new URL(result.url).searchParams;
  const oauthError = params.get('error_description') || params.get('error');
  if (oauthError) {
    throw new Error(oauthError);
  }

  const code = params.get('code');
  if (!code) {
    throw new Error(`${provider} sign-in did not return an authorization code.`);
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (sessionError) throw sessionError;
  await ensureUserProfile(sessionData.user);

  return sessionData;
};

export const authService = {
  async signUp(email: string, password: string, name: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) throw error;

    if (data.session && data.user) {
      await ensureUserProfile({
        ...data.user,
        user_metadata: {
          ...data.user?.user_metadata,
          name,
        },
      } as SupabaseUser);
    }

    return data;
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Sign in error:', error);
      throw error;
    }
    if (!data || !data.user) {
      throw new Error('Invalid login credentials');
    }
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getSession(): Promise<Session | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user as AuthUser | null;
  },

  async signInWithGoogle() {
    return completeOAuthSignIn('google');
  },

  async signInWithApple() {
    return completeOAuthSignIn('apple');
  },
};

