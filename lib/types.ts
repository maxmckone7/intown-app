export type CalendarStatus = 'in_town' | 'out_of_town';

export interface CalendarEntry {
  id: string;
  user_id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  status: CalendarStatus;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  location?: string | null;
  interests?: string[] | null;
  social_accounts?: Record<string, string> | null;
  created_at: string;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
}

export interface FriendWithStatus extends User {
  friendship_id: string;
  friendship_status: 'pending' | 'accepted';
  calendar_entries?: CalendarEntry[];
}

