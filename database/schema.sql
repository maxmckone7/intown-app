-- Social Calendar App Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  location TEXT,
  interests TEXT[] NOT NULL DEFAULT '{}',
  social_accounts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS social_accounts JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Public profile pictures stored in Supabase Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Friendships table
CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Calendar entries table
CREATE TABLE IF NOT EXISTS public.calendar_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_town', 'out_of_town')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Friend groups table
CREATE TABLE IF NOT EXISTS public.friend_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  friend_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Invites table
CREATE TABLE IF NOT EXISTS public.invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL DEFAULT replace(uuid_generate_v4()::text, '-', ''),
  invitee_email TEXT,
  invitee_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_name_lower ON public.users (lower(name));
CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON public.friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON public.friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON public.friendships(status);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_user_id ON public.calendar_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_date ON public.calendar_entries(date);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_user_date ON public.calendar_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_friend_groups_user_id ON public.friend_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_groups_friend_ids ON public.friend_groups USING GIN(friend_ids);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON public.invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_inviter_id ON public.invites(inviter_id);
CREATE INDEX IF NOT EXISTS idx_invites_accepted_by ON public.invites(accepted_by);
CREATE INDEX IF NOT EXISTS idx_invites_status ON public.invites(status);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
-- Users can read their own profile and profiles of their friends
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can view friends' profiles" ON public.users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.friendships
      WHERE (user_id = auth.uid() AND friend_id = users.id AND status = 'accepted')
         OR (friend_id = auth.uid() AND user_id = users.id AND status = 'accepted')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can search profiles" ON public.users;
CREATE POLICY "Authenticated users can search profiles" ON public.users
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can create own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- RLS Policies for public avatar uploads
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload own avatar" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own avatar" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  ) WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own avatar" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- RLS Policies for friendships table
CREATE POLICY "Users can view own friendships" ON public.friendships
  FOR SELECT USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can create friendships" ON public.friendships
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own friendships" ON public.friendships
  FOR UPDATE USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can delete own friendships" ON public.friendships
  FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for calendar_entries table
CREATE POLICY "Users can view own calendar entries" ON public.calendar_entries
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can view friends' calendar entries" ON public.calendar_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.friendships
      WHERE (user_id = auth.uid() AND friend_id = calendar_entries.user_id AND status = 'accepted')
         OR (friend_id = auth.uid() AND user_id = calendar_entries.user_id AND status = 'accepted')
    )
  );

CREATE POLICY "Users can create own calendar entries" ON public.calendar_entries
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own calendar entries" ON public.calendar_entries
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own calendar entries" ON public.calendar_entries
  FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for friend_groups table
DROP POLICY IF EXISTS "Users can view own friend groups" ON public.friend_groups;
CREATE POLICY "Users can view own friend groups" ON public.friend_groups
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own friend groups" ON public.friend_groups;
CREATE POLICY "Users can create own friend groups" ON public.friend_groups
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own friend groups" ON public.friend_groups;
CREATE POLICY "Users can update own friend groups" ON public.friend_groups
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own friend groups" ON public.friend_groups;
CREATE POLICY "Users can delete own friend groups" ON public.friend_groups
  FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for invites table
DROP POLICY IF EXISTS "Users can view own invites" ON public.invites;
CREATE POLICY "Users can view own invites" ON public.invites
  FOR SELECT USING (inviter_id = auth.uid() OR accepted_by = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can view active invites" ON public.invites;
CREATE POLICY "Authenticated users can view active invites" ON public.invites
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > NOW())
  );

DROP POLICY IF EXISTS "Users can create own invites" ON public.invites;
CREATE POLICY "Users can create own invites" ON public.invites
  FOR INSERT WITH CHECK (inviter_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own invites" ON public.invites;
CREATE POLICY "Users can update own invites" ON public.invites
  FOR UPDATE USING (inviter_id = auth.uid()) WITH CHECK (inviter_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own invites" ON public.invites;
CREATE POLICY "Users can delete own invites" ON public.invites
  FOR DELETE USING (inviter_id = auth.uid());

-- Function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    avatar_url = EXCLUDED.avatar_url;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create user profile on auth signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to accept an invite and create reciprocal friendships
CREATE OR REPLACE FUNCTION public.accept_invite(invite_token TEXT)
RETURNS public.invites AS $$
DECLARE
  invite_record public.invites;
  accepting_user UUID := auth.uid();
BEGIN
  IF accepting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to accept an invite.';
  END IF;

  SELECT *
  INTO invite_record
  FROM public.invites
  WHERE token = invite_token
  FOR UPDATE;

  IF invite_record.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found.';
  END IF;

  IF invite_record.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite is no longer active.';
  END IF;

  IF invite_record.expires_at IS NOT NULL AND invite_record.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invite has expired.';
  END IF;

  IF invite_record.inviter_id = accepting_user THEN
    RAISE EXCEPTION 'You cannot accept your own invite.';
  END IF;

  UPDATE public.invites
  SET
    status = 'accepted',
    accepted_by = accepting_user,
    accepted_at = NOW(),
    updated_at = NOW()
  WHERE id = invite_record.id
  RETURNING * INTO invite_record;

  INSERT INTO public.friendships (user_id, friend_id, status)
  VALUES
    (invite_record.inviter_id, accepting_user, 'accepted'),
    (accepting_user, invite_record.inviter_id, 'accepted')
  ON CONFLICT (user_id, friend_id) DO UPDATE
    SET status = 'accepted';

  RETURN invite_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to update updated_at on calendar_entries
DROP TRIGGER IF EXISTS update_calendar_entries_updated_at ON public.calendar_entries;
CREATE TRIGGER update_calendar_entries_updated_at
  BEFORE UPDATE ON public.calendar_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_friend_groups_updated_at ON public.friend_groups;
CREATE TRIGGER update_friend_groups_updated_at
  BEFORE UPDATE ON public.friend_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_invites_updated_at ON public.invites;
CREATE TRIGGER update_invites_updated_at
  BEFORE UPDATE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

