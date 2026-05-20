# InTown

A React Native mobile app that helps users track when they're in town or out of town, follow friends, and easily see when friends are available for socializing.

## Features

- **User Authentication**: Email/password and social login (Google, Apple)
- **Personal Calendar**: Mark dates as "in town" or "out of town"
- **Friend System**: Search for users, follow/unfollow friends
- **Friends Calendar View**: See aggregated calendar of all your friends' availability
- **Real-time Updates**: Calendar updates sync in real-time using Supabase

## Tech Stack

- **Frontend**: React Native with Expo
- **Backend**: Supabase (PostgreSQL, Authentication, Real-time)
- **Language**: TypeScript
- **Navigation**: Expo Router
- **Calendar**: react-native-calendars

## Prerequisites

- Node.js (v18+ recommended)
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Supabase account (free tier works)

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd intown-app
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Project Settings > API
3. Copy your Project URL and anon/public key

### 3. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your Supabase credentials in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

### 4. Set Up Database

1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Copy and paste the contents of `database/schema.sql`
4. Run the SQL script to create all tables, indexes, and RLS policies

### 5. Configure Authentication Providers (Optional)

For social login to work:

**Google:**
1. Go to Authentication > Providers in Supabase
2. Enable Google provider
3. Create a Google OAuth client in [Google Cloud Console](https://console.cloud.google.com)
4. Add your Supabase callback URL to the Google OAuth client:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
5. Copy the Google Client ID and Client Secret into the Supabase Google provider
6. In Supabase Authentication > URL Configuration > Redirect URLs, add:
   ```
   intown:///auth/callback
   http://localhost:8081/auth/callback
   https://your-production-domain.com/auth/callback
   ```

**Apple:**
1. Go to Authentication > Providers in Supabase
2. Enable Apple provider
3. Configure Apple OAuth settings

### 6. Run the App

```bash
# Start the Expo development server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android
```

## Project Structure

```
social-calendar-app/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Authentication screens
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/            # Main app tabs
│   │   ├── index.tsx      # My Calendar
│   │   ├── friends.tsx    # Friends & Calendar
│   │   └── profile.tsx    # User Profile
│   └── _layout.tsx        # Root layout
├── components/            # Reusable components
├── lib/                   # Utilities
│   ├── supabase.ts        # Supabase client
│   └── types.ts           # TypeScript types
├── services/              # Business logic
│   ├── auth.ts            # Authentication service
│   ├── calendar.ts        # Calendar service
│   └── friends.ts         # Friends service
├── database/
│   └── schema.sql         # Database schema
└── package.json
```

## Database Schema

- **users**: User profiles (extends Supabase auth.users)
- **friendships**: Friend relationships between users
- **calendar_entries**: User calendar entries (in town/out of town)

All tables have Row Level Security (RLS) enabled for data protection.

## Usage

1. **Sign Up/Login**: Create an account or sign in
2. **Mark Your Calendar**: Tap dates on your calendar to mark them as "in town" or "out of town"
3. **Find Friends**: Use the Search tab to find and follow other users
4. **View Friends Calendar**: Switch to the Calendar tab in Friends to see when all your friends are available

## Development

The app uses Expo Router for file-based routing. Screens are automatically routed based on the file structure in the `app/` directory.

## License

MIT

