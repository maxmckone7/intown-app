# Setup Guide

Follow these steps to get the Social Calendar App running on your machine.

## Step 1: Install Dependencies

```bash
cd social-calendar-app
npm install
```

This will install all required packages including:
- React Native and Expo
- Supabase client
- Expo Router
- Calendar components
- And more...

## Step 2: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Fill in your project details:
   - Name: `social-calendar-app` (or any name you prefer)
   - Database Password: Choose a strong password (save it!)
   - Region: Choose closest to you
4. Wait for the project to be created (takes ~2 minutes)

## Step 3: Get Supabase Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (under "Project URL")
   - **anon/public key** (under "Project API keys" → "anon public")

## Step 4: Set Up Environment Variables

1. Create a `.env` file in the root of the project:
   ```bash
   touch .env
   ```

2. Add your Supabase credentials:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

   Replace `your-project` and `your-anon-key-here` with the values from Step 3.

## Step 5: Set Up Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Open the file `database/schema.sql` from this project
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click "Run" (or press Cmd/Ctrl + Enter)

This will create:
- `users` table
- `friendships` table
- `calendar_entries` table
- `friend_groups` table
- `invites` table
- All necessary indexes
- Row Level Security (RLS) policies
- Triggers for automatic user profile creation and `updated_at` maintenance
- RPC helpers such as `accept_invite`

## Step 6: Configure Authentication (Optional but Recommended)

### For Google Login:

1. Go to **Authentication** → **Providers** in Supabase
2. Find "Google" and click to enable it
3. You'll need to:
   - Create a Google OAuth app at [Google Cloud Console](https://console.cloud.google.com)
   - Add your Supabase callback URL to Google OAuth settings:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
   - Copy Client ID and Client Secret to Supabase
4. Go to **Authentication** → **URL Configuration** in Supabase
5. Add these redirect URLs:
   ```
   intown:///auth/callback
   http://localhost:8081/auth/callback
   https://your-production-domain.com/auth/callback
   ```
   If Expo starts web on another localhost port, add that exact origin with `/auth/callback`.

### For Apple Login:

1. Go to **Authentication** → **Providers** in Supabase
2. Find "Apple" and click to enable it
3. Configure with your Apple Developer credentials

**Note**: For MVP/testing, you can skip social login and just use email/password.

## Step 7: Run the App

```bash
# Start the Expo development server
npm start

# Then choose:
# - Press 'i' for iOS simulator (requires Xcode on Mac)
# - Press 'a' for Android emulator (requires Android Studio)
# - Scan QR code with Expo Go app on your phone
```

## Troubleshooting

### "Cannot find module" errors
- Make sure you ran `npm install`
- Try deleting `node_modules` and `package-lock.json`, then run `npm install` again

### Supabase connection errors
- Verify your `.env` file has the correct credentials
- Make sure the `.env` file is in the root directory
- Restart the Expo server after changing `.env`
- The app requires real Supabase credentials and no longer falls back to browser-local mock data

### Database errors
- Make sure you ran the SQL schema script
- Check that all tables were created in Supabase dashboard (Table Editor)
- Verify RLS policies are enabled

### Authentication not working
- Check Supabase Authentication settings
- Verify email confirmation is disabled for testing (Settings → Auth → Email Auth)
- Make sure the `handle_new_user` trigger was created

## Next Steps

Once the app is running:
1. Create an account using the Sign Up screen
2. Mark some dates on your calendar
3. Search for other users (if you have test accounts)
4. Follow friends and view their calendars

## Development Tips

- The app uses Expo Router for navigation - screens are in the `app/` directory
- Services (auth, calendar, friends) are in the `services/` directory
- Database queries use Supabase client in `lib/supabase.ts`
- All TypeScript types are defined in `lib/types.ts`

