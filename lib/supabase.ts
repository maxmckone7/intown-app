import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const hasSupabaseConfig = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseAnonKey.includes('your-anon-key')
);

// Mock Supabase client using AsyncStorage
class MockSupabaseClient {
  private storage: typeof AsyncStorage;

  constructor() {
    try {
      this.storage = AsyncStorage;
    } catch (error) {
      console.error('Failed to initialize AsyncStorage:', error);
      // Fallback to a simple in-memory storage if AsyncStorage fails
      this.storage = {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      } as any;
    }
  }

  // Auth methods
  auth = {
    signUp: async ({ email, password, options }: any) => {
      const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const createdAt = new Date().toISOString();
      const user = {
        id: userId,
        email,
        created_at: createdAt,
        last_sign_in_at: createdAt,
        user_metadata: options?.data || {},
      };

      // Store user
      const users = await this.getStoredData('users') || [];
      users.push({
        id: userId,
        email,
        name: options?.data?.name || null,
        avatar_url: null,
        location: null,
        interests: [],
        social_accounts: {},
        created_at: createdAt,
      });
      await this.setStoredData('users', users);

      // Store auth session
      const session = {
        access_token: `mock_token_${userId}`,
        refresh_token: `mock_refresh_${userId}`,
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        token_type: 'bearer',
        user,
      };
      await this.setStoredData('auth_session', session);

      return { data: { user, session }, error: null };
    },

    signInWithPassword: async ({ email, password }: any) => {
      const users = await this.getStoredData('users') || [];
      const userData = users.find((u: any) => u.email === email);

      if (!userData) {
        return { data: null, error: { message: 'Invalid login credentials' } };
      }

      const user = {
        id: userData.id,
        email: userData.email,
        user_metadata: { name: userData.name },
      };

      const session = {
        access_token: `mock_token_${userData.id}`,
        refresh_token: `mock_refresh_${userData.id}`,
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        token_type: 'bearer',
        user,
      };
      await this.setStoredData('auth_session', session);

      return { data: { user, session }, error: null };
    },

    resetPasswordForEmail: async () => {
      // Mirror Supabase's non-enumerating behavior for local development.
      return { data: {}, error: null };
    },

    exchangeCodeForSession: async () => {
      const users = await this.getStoredData('users') || [];
      const userData = users[0];

      if (!userData) {
        return { data: null, error: { message: 'Password reset link is invalid or expired' } };
      }

      const user = {
        id: userData.id,
        email: userData.email,
        user_metadata: { name: userData.name },
      };

      const session = {
        access_token: `mock_token_${userData.id}`,
        refresh_token: `mock_refresh_${userData.id}`,
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        token_type: 'bearer',
        user,
      };
      await this.setStoredData('auth_session', session);

      return { data: { user, session }, error: null };
    },

    updateUser: async ({ password, data }: any) => {
      const session = await this.getStoredData('auth_session');
      if (!session?.user) {
        return { data: null, error: { message: 'You need a valid reset link before updating your password' } };
      }

      const nextSession = {
        ...session,
        user: {
          ...session.user,
          user_metadata: {
            ...session.user.user_metadata,
            ...data,
          },
        },
      };
      await this.setStoredData('auth_session', nextSession);

      if (password) {
        const users = await this.getStoredData('users') || [];
        const nextUsers = users.map((user: any) =>
          user.id === session.user.id ? { ...user, password_updated_at: new Date().toISOString() } : user
        );
        await this.setStoredData('users', nextUsers);
      }

      return { data: { user: nextSession.user }, error: null };
    },

    signOut: async () => {
      await this.removeStoredData('auth_session');
      return { error: null };
    },

    getSession: async () => {
      try {
        const session = await this.getStoredData('auth_session');
        return { data: { session }, error: null };
      } catch (error) {
        console.warn('Error getting session:', error);
        return { data: { session: null }, error: null };
      }
    },

    getUser: async () => {
      const session = await this.getStoredData('auth_session');
      if (!session) {
        return { data: { user: null }, error: null };
      }
      return { data: { user: session.user }, error: null };
    },

    signInWithOAuth: async ({ provider }: any) => {
      const providerLabel = provider === 'google' ? 'Google' : provider === 'apple' ? 'Apple' : provider;
      const email = `dev-${provider}@intown.local`;
      const name = `Dev ${providerLabel} User`;
      const signedInAt = new Date().toISOString();

      const users = (await this.getStoredData('users')) || [];
      let userRecord = users.find((u: any) => u.email === email);
      let isNewUser = false;
      if (!userRecord) {
        isNewUser = true;
        userRecord = {
          id: `oauth_${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          email,
          name,
          avatar_url: null,
          location: null,
          interests: [],
          social_accounts: { [provider]: true },
          created_at: signedInAt,
        };
        users.push(userRecord);
        await this.setStoredData('users', users);
      }

      const user = {
        id: userRecord.id,
        email,
        created_at: userRecord.created_at,
        last_sign_in_at: signedInAt,
        user_metadata: {
          name,
          full_name: name,
          avatar_url: null,
          picture: null,
          provider,
        },
      };

      const session = {
        access_token: `mock_token_${userRecord.id}`,
        refresh_token: `mock_refresh_${userRecord.id}`,
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        token_type: 'bearer',
        user,
      };
      await this.setStoredData('auth_session', session);

      return { data: { provider, mocked: true, user, session, isNewUser }, error: null };
    },

    onAuthStateChange: (callback: any) => {
      // Simple mock - just return unsubscribe function
      return {
        data: { subscription: { unsubscribe: () => {} } },
      };
    },
  };

  // Database query builder mock
  from(table: string) {
    return new MockQueryBuilder(table, this);
  }

  // Helper methods for AsyncStorage
  private async getStoredData(key: string): Promise<any> {
    try {
      const data = await this.storage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.warn('Error reading from storage:', error);
      return null;
    }
  }

  private async setStoredData(key: string, value: any): Promise<void> {
    try {
      await this.storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Error writing to storage:', error);
    }
  }

  private async removeStoredData(key: string): Promise<void> {
    try {
      await this.storage.removeItem(key);
    } catch (error) {
      console.warn('Error removing from storage:', error);
    }
  }

  // Expose storage methods for query builder
  async getTableData(table: string): Promise<any[]> {
    return await this.getStoredData(table) || [];
  }

  async setTableData(table: string, data: any[]): Promise<void> {
    await this.setStoredData(table, data);
  }
}

// Mock query builder
class MockQueryBuilder {
  private table: string;
  private client: MockSupabaseClient;
  private filters: Array<{
    type: string;
    field?: string;
    value?: any;
    values?: any[];
    conditions?: Array<{ field: string; value: any }>;
  }> = [];
  private orderBy?: { field: string; ascending: boolean };
  private limitCount?: number;
  private selectFields?: string;
  private mutation?: {
    type: 'insert' | 'upsert' | 'update' | 'delete';
    values?: any;
    options?: { onConflict?: string };
  };

  constructor(table: string, client: MockSupabaseClient) {
    this.table = table;
    this.client = client;
  }

  select(fields?: string) {
    this.selectFields = fields;
    return this;
  }

  eq(field: string, value: any) {
    this.filters.push({ type: 'eq', field, value });
    return this;
  }

  neq(field: string, value: any) {
    this.filters.push({ type: 'neq', field, value });
    return this;
  }

  in(field: string, values: any[]) {
    this.filters.push({ type: 'in', field, values });
    return this;
  }

  gte(field: string, value: any) {
    this.filters.push({ type: 'gte', field, value });
    return this;
  }

  lte(field: string, value: any) {
    this.filters.push({ type: 'lte', field, value });
    return this;
  }

  or(condition: string) {
    // Simple OR mock - parse "field.ilike.%value%" patterns
    const matches = condition.match(/(\w+)\.ilike\.%([^%]+)%/g);
    if (matches) {
      const conditions = matches.flatMap((match) => {
        const matchResult = match.match(/(\w+)\.ilike\.%([^%]+)%/);
        if (!matchResult) {
          return [];
        }

        const [, field, value] = matchResult;
        return [{ field, value }];
      });

      if (conditions.length > 0) {
        this.filters.push({ type: 'or_ilike', conditions });
      }
    }
    return this;
  }

  order(field: string, options?: { ascending: boolean }) {
    this.orderBy = { field, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  async single() {
    const { data, error } = await this.executeResult();
    if (error) {
      return { data: null, error };
    }

    const results = Array.isArray(data) ? data : data ? [data] : [];
    if (results.length === 0) {
      return { data: null, error: { code: 'PGRST116', message: 'No rows returned' } };
    }
    return { data: results[0], error: null };
  }

  // Make the query builder awaitable - return { data, error } format
  async then(resolve: any, reject: any) {
    try {
      resolve(await this.executeResult());
    } catch (error: any) {
      resolve({ data: null, error });
    }
  }

  private matchesFilters(item: any): boolean {
    return this.filters.every((filter) => {
      switch (filter.type) {
        case 'eq':
          return item[filter.field!] === filter.value;
        case 'neq':
          return item[filter.field!] !== filter.value;
        case 'in':
          return filter.values?.includes(item[filter.field!]) || false;
        case 'gte':
          return item[filter.field!] >= filter.value;
        case 'lte':
          return item[filter.field!] <= filter.value;
        case 'ilike':
          const fieldValue = String(item[filter.field!] || '').toLowerCase();
          return fieldValue.includes(filter.value?.toLowerCase() || '');
        case 'or_ilike':
          return (
            filter.conditions?.some((condition) => {
              const conditionValue = String(item[condition.field] || '').toLowerCase();
              return conditionValue.includes(condition.value?.toLowerCase() || '');
            }) || false
          );
        default:
          return true;
      }
    });
  }

  private createRow(values: any) {
    return {
      ...values,
      id: values.id || `${this.table}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      created_at: values.created_at || new Date().toISOString(),
      updated_at: values.updated_at || new Date().toISOString(),
    };
  }

  private async executeMutation() {
    const mutation = this.mutation!;
    const data = await this.client.getTableData(this.table);

    if (mutation.type === 'insert') {
      const values = Array.isArray(mutation.values) ? mutation.values : [mutation.values];
      const inserted = values.map((value) => this.createRow(value));

      await this.client.setTableData(this.table, [...data, ...inserted]);
      return { data: inserted, error: null };
    }

    if (mutation.type === 'upsert') {
      const values = Array.isArray(mutation.values) ? mutation.values : [mutation.values];
      const conflictFields = (mutation.options?.onConflict || 'id')
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean);
      const now = new Date().toISOString();
      const upserted = values.map((value) => {
        const index = data.findIndex((item: any) =>
          conflictFields.every((field) => item[field] === value[field])
        );

        if (index === -1) {
          const newItem = this.createRow(value);
          data.push(newItem);
          return newItem;
        }

        data[index] = {
          ...data[index],
          ...value,
          updated_at: now,
        };
        return data[index];
      });

      await this.client.setTableData(this.table, data);
      return { data: upserted, error: null };
    }

    if (mutation.type === 'update') {
      const now = new Date().toISOString();
      const updated: any[] = [];
      const nextData = data.map((item: any) => {
        if (!this.matchesFilters(item)) {
          return item;
        }

        const nextItem = {
          ...item,
          ...mutation.values,
          updated_at: now,
        };
        updated.push(nextItem);
        return nextItem;
      });

      await this.client.setTableData(this.table, nextData);
      return { data: updated, error: null };
    }

    const deleted = data.filter((item: any) => this.matchesFilters(item));
    const nextData = data.filter((item: any) => !this.matchesFilters(item));
    await this.client.setTableData(this.table, nextData);
    return { data: deleted, error: null };
  }

  private async executeResult() {
    if (this.mutation) {
      return this.executeMutation();
    }

    return { data: await this.execute(), error: null };
  }

  async execute(): Promise<any[]> {
    let data = await this.client.getTableData(this.table);
    
    // If no data exists yet, return empty array
    if (!data || data.length === 0) {
      return [];
    }

    // Apply filters
    data = data.filter((item: any) => this.matchesFilters(item));

    // Apply ordering
    if (this.orderBy) {
      data.sort((a: any, b: any) => {
        const aVal = a[this.orderBy!.field];
        const bVal = b[this.orderBy!.field];
        if (this.orderBy!.ascending) {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });
    }

    // Apply limit
    if (this.limitCount) {
      data = data.slice(0, this.limitCount);
    }

    // Handle select with joins (simplified)
    if (this.selectFields && this.selectFields.includes('users')) {
      // Parse join syntax like "users!friendships_friend_id_fkey" or just "users"
      const users = await this.client.getTableData('users');
      data = data.map((item: any) => {
        // Handle different foreign key patterns
        // For friendships table, friend_id references users
        if (item.friend_id) {
          const user = users.find((u: any) => u.id === item.friend_id);
          return { ...item, users: user || null };
        }
        // For calendar_entries table, user_id references users
        if (item.user_id) {
          const user = users.find((u: any) => u.id === item.user_id);
          return { ...item, users: user || null };
        }
        return item;
      });
    }

    return data;
  }

  insert(values: any) {
    this.mutation = { type: 'insert', values };
    return this;
  }

  upsert(values: any, options?: { onConflict?: string }) {
    this.mutation = { type: 'upsert', values, options };
    return this;
  }

  update(values: any) {
    this.mutation = { type: 'update', values };
    return this;
  }

  delete() {
    this.mutation = { type: 'delete' };
    return this;
  }
}

// Refuses every auth/db call with a fixed error. Used when Supabase env is
// missing in a non-dev build, so the app fails closed instead of minting
// fake "mock_token_*" sessions that anyone could sign in with.
const createUnavailableAuthClient = (reason: string) => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    signUp: async () => ({ data: null, error: { message: reason } }),
    signInWithPassword: async () => ({ data: null, error: { message: reason } }),
    resetPasswordForEmail: async () => ({ data: null, error: { message: reason } }),
    exchangeCodeForSession: async () => ({ data: null, error: { message: reason } }),
    updateUser: async () => ({ data: null, error: { message: reason } }),
    signOut: async () => ({ error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    signInWithOAuth: async () => ({ data: null, error: { message: reason } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: () => ({
    select: () => ({
      then: (resolve: any) => resolve({ data: [], error: { message: reason } }),
    }),
  }),
});

// Export Supabase client. Real Supabase when env is set; in-memory mock for
// dev when env is missing; fail-closed client in non-dev when env is missing.
let supabaseInstance: any;
let usingMockClient = false;

if (hasSupabaseConfig) {
  supabaseInstance = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
} else if (__DEV__) {
  try {
    supabaseInstance = new MockSupabaseClient();
    usingMockClient = true;
  } catch (error) {
    console.error('Failed to create Supabase mock client:', error);
    supabaseInstance = createUnavailableAuthClient('Mock auth client failed to initialize.');
  }
} else {
  console.error(
    '[InTown] Supabase credentials are missing in a non-dev build. ' +
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY before building for production. ' +
    'All authentication requests will be rejected.',
  );
  supabaseInstance = createUnavailableAuthClient(
    'Authentication is not available in this build. Please contact support.',
  );
}

export const supabase = supabaseInstance;
export const isMockSupabase = usingMockClient;
