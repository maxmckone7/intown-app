import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const PLACEHOLDER_PATTERNS = ['your-project', 'your-anon-key'];

const requireSupabaseEnv = (name: string, value: string | undefined) => {
  const trimmed = value?.trim();

  if (
    !trimmed ||
    PLACEHOLDER_PATTERNS.some((placeholder) => trimmed.includes(placeholder))
  ) {
    throw new Error(
      `${name} must be configured with real Supabase credentials. ` +
        'Copy .env.example to .env and set your project URL and anon key.'
    );
  }

  return trimmed;
};

const supabaseUrl = requireSupabaseEnv(
  'EXPO_PUBLIC_SUPABASE_URL',
  process.env.EXPO_PUBLIC_SUPABASE_URL
);
const supabaseAnonKey = requireSupabaseEnv(
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
