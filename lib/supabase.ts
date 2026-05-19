import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

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
      const user = {
        id: userId,
        email,
        user_metadata: options?.data || {},
      };

      // Store user
      const users = await this.getStoredData('users') || [];
      users.push({
        id: userId,
        email,
        name: options?.data?.name || null,
        avatar_url: null,
        created_at: new Date().toISOString(),
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
      return {
        data: null,
        error: { message: 'OAuth not supported in mock mode. Use email/password.' },
      };
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
  private filters: Array<{ type: string; field: string; value?: any; values?: any[] }> = [];
  private orderBy?: { field: string; ascending: boolean };
  private limitCount?: number;
  private selectFields?: string;

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
      matches.forEach((match) => {
        const matchResult = match.match(/(\w+)\.ilike\.%([^%]+)%/);
        if (matchResult) {
          const [, field, value] = matchResult;
          this.filters.push({ type: 'ilike', field, value });
        }
      });
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
    const results = await this.execute();
    if (results.length === 0) {
      return { data: null, error: { code: 'PGRST116', message: 'No rows returned' } };
    }
    return { data: results[0], error: null };
  }

  // Make the query builder awaitable - return { data, error } format
  async then(resolve: any, reject: any) {
    try {
      const results = await this.execute();
      resolve({ data: results, error: null });
    } catch (error: any) {
      resolve({ data: null, error });
    }
  }

  async execute(): Promise<any[]> {
    let data = await this.client.getTableData(this.table);
    
    // If no data exists yet, return empty array
    if (!data || data.length === 0) {
      return [];
    }

    // Apply filters
    data = data.filter((item: any) => {
      return this.filters.every((filter) => {
        switch (filter.type) {
          case 'eq':
            return item[filter.field] === filter.value;
          case 'neq':
            return item[filter.field] !== filter.value;
          case 'in':
            return filter.values?.includes(item[filter.field]) || false;
          case 'gte':
            return item[filter.field] >= filter.value;
          case 'lte':
            return item[filter.field] <= filter.value;
          case 'ilike':
            const fieldValue = String(item[filter.field] || '').toLowerCase();
            return fieldValue.includes(filter.value?.toLowerCase() || '');
          default:
            return true;
        }
      });
    });

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

  async insert(values: any) {
    const data = await this.client.getTableData(this.table);
    const newItem = {
      ...values,
      id: values.id || `${this.table}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      created_at: values.created_at || new Date().toISOString(),
      updated_at: values.updated_at || new Date().toISOString(),
    };
    data.push(newItem);
    await this.client.setTableData(this.table, data);
    
    return { data: newItem, error: null };
  }

  async update(values: any) {
    const data = await this.client.getTableData(this.table);
    const filter = this.filters.find((f) => f.type === 'eq');
    
    if (!filter) {
      return { data: null, error: { message: 'Update requires eq filter' } };
    }

    const index = data.findIndex((item: any) => item[filter.field] === filter.value);
    if (index === -1) {
      return { data: null, error: { message: 'Item not found' } };
    }

    data[index] = {
      ...data[index],
      ...values,
      updated_at: new Date().toISOString(),
    };
    await this.client.setTableData(this.table, data);
    return { data: data[index], error: null };
  }

  async delete() {
    const data = await this.client.getTableData(this.table);
    const filters = this.filters.filter((f) => f.type === 'eq');
    
    if (filters.length === 0) {
      return { error: { message: 'Delete requires eq filter' } };
    }

    let filtered = data;
    filters.forEach((filter) => {
      filtered = filtered.filter((item: any) => item[filter.field] !== filter.value);
    });
    
    await this.client.setTableData(this.table, filtered);
    return { error: null };
  }
}

// Export mock client with error handling
let supabaseInstance: any;
try {
  supabaseInstance = new MockSupabaseClient();
} catch (error) {
  console.error('Failed to create Supabase mock client:', error);
  // Create a minimal fallback
  supabaseInstance = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signUp: async () => ({ data: null, error: { message: 'Not initialized' } }),
      signInWithPassword: async () => ({ data: null, error: { message: 'Not initialized' } }),
      signOut: async () => ({ error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithOAuth: async () => ({ data: null, error: { message: 'Not initialized' } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({ then: (resolve: any) => resolve({ data: [], error: null }) }),
    }),
  };
}

export const supabase = supabaseInstance;
