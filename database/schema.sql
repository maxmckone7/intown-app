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

-- Notification preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  coordination_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  weekend_in_town_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  back_in_town_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_channels TEXT[] NOT NULL DEFAULT ARRAY['push']::TEXT[],
  group_id UUID REFERENCES public.friend_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT notification_preferences_delivery_channels_check
    CHECK (delivery_channels <@ ARRAY['push', 'email']::TEXT[])
);

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS coordination_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS weekend_in_town_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS back_in_town_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS delivery_channels TEXT[] NOT NULL DEFAULT ARRAY['push']::TEXT[],
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.friend_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_preferences_delivery_channels_check'
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_delivery_channels_check
      CHECK (delivery_channels <@ ARRAY['push', 'email']::TEXT[]);
  END IF;
END $$;

-- Batched coordination notification queue. Delivery workers can query queued
-- batches by send_after and fan out through the requested channels.
CREATE TABLE IF NOT EXISTS public.coordination_notification_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('weekend_in_town', 'back_in_town')
  ),
  group_id UUID REFERENCES public.friend_groups(id) ON DELETE SET NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  friend_ids UUID[] NOT NULL DEFAULT '{}',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT NOT NULL,
  channels TEXT[] NOT NULL DEFAULT ARRAY['push']::TEXT[],
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'sent', 'suppressed')
  ),
  send_after TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  batch_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT coordination_notification_batches_channels_check
    CHECK (channels <@ ARRAY['push', 'email']::TEXT[])
);

ALTER TABLE public.coordination_notification_batches
  ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS notification_type TEXT,
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.friend_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS starts_on DATE,
  ADD COLUMN IF NOT EXISTS ends_on DATE,
  ADD COLUMN IF NOT EXISTS friend_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS deep_link TEXT,
  ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT ARRAY['push']::TEXT[],
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS send_after TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS batch_key TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'coordination_notification_batches_type_check'
  ) THEN
    ALTER TABLE public.coordination_notification_batches
      ADD CONSTRAINT coordination_notification_batches_type_check
      CHECK (notification_type IN ('weekend_in_town', 'back_in_town'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'coordination_notification_batches_status_check'
  ) THEN
    ALTER TABLE public.coordination_notification_batches
      ADD CONSTRAINT coordination_notification_batches_status_check
      CHECK (status IN ('queued', 'sent', 'suppressed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'coordination_notification_batches_channels_check'
  ) THEN
    ALTER TABLE public.coordination_notification_batches
      ADD CONSTRAINT coordination_notification_batches_channels_check
      CHECK (channels <@ ARRAY['push', 'email']::TEXT[]);
  END IF;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_notification_preferences_group_id ON public.notification_preferences(group_id);
CREATE INDEX IF NOT EXISTS idx_coordination_batches_recipient_status
  ON public.coordination_notification_batches(recipient_id, status, send_after);
CREATE INDEX IF NOT EXISTS idx_coordination_batches_status_send_after
  ON public.coordination_notification_batches(status, send_after);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coordination_batches_batch_key
  ON public.coordination_notification_batches(batch_key);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coordination_notification_batches ENABLE ROW LEVEL SECURITY;

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

-- RLS Policies for notification preferences
DROP POLICY IF EXISTS "Users can view own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can view own notification preferences" ON public.notification_preferences
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can create own notification preferences" ON public.notification_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own notification preferences" ON public.notification_preferences
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can delete own notification preferences" ON public.notification_preferences
  FOR DELETE USING (user_id = auth.uid());

-- RLS Policies for coordination notification batches
DROP POLICY IF EXISTS "Users can view own coordination notification batches" ON public.coordination_notification_batches;
CREATE POLICY "Users can view own coordination notification batches" ON public.coordination_notification_batches
  FOR SELECT USING (recipient_id = auth.uid());

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

CREATE OR REPLACE FUNCTION public.build_coordination_deep_link(
  target_date DATE,
  target_group_id UUID
)
RETURNS TEXT AS $$
BEGIN
  IF target_group_id IS NULL THEN
    RETURN 'intown:///?date=' || target_date::TEXT;
  END IF;

  RETURN 'intown:///?date=' || target_date::TEXT || '&groupId=' || target_group_id::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.upsert_coordination_notification_batch(
  target_recipient_id UUID,
  target_notification_type TEXT,
  target_group_id UUID,
  target_starts_on DATE,
  target_ends_on DATE,
  target_friend_id UUID,
  target_title TEXT,
  target_body TEXT,
  target_deep_link TEXT,
  target_channels TEXT[],
  target_send_after TIMESTAMP WITH TIME ZONE
)
RETURNS VOID AS $$
DECLARE
  target_batch_key TEXT := target_recipient_id::TEXT
    || ':'
    || target_notification_type
    || ':'
    || COALESCE(target_group_id::TEXT, 'all')
    || ':'
    || target_starts_on::TEXT
    || ':'
    || target_ends_on::TEXT;
BEGIN
  INSERT INTO public.coordination_notification_batches (
    recipient_id,
    notification_type,
    group_id,
    starts_on,
    ends_on,
    friend_ids,
    title,
    body,
    deep_link,
    channels,
    send_after,
    batch_key
  )
  VALUES (
    target_recipient_id,
    target_notification_type,
    target_group_id,
    target_starts_on,
    target_ends_on,
    ARRAY[target_friend_id],
    target_title,
    target_body,
    target_deep_link,
    target_channels,
    target_send_after,
    target_batch_key
  )
  ON CONFLICT (batch_key) DO UPDATE SET
    friend_ids = ARRAY(
      SELECT DISTINCT friend_id
      FROM unnest(
        public.coordination_notification_batches.friend_ids
        || EXCLUDED.friend_ids
      ) AS friend_id
    ),
    channels = ARRAY(
      SELECT DISTINCT channel
      FROM unnest(
        public.coordination_notification_batches.channels
        || EXCLUDED.channels
      ) AS channel
    ),
    send_after = LEAST(
      public.coordination_notification_batches.send_after,
      EXCLUDED.send_after
    ),
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    deep_link = EXCLUDED.deep_link,
    updated_at = NOW()
  WHERE public.coordination_notification_batches.status = 'queued';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.enqueue_coordination_notifications()
RETURNS TRIGGER AS $$
DECLARE
  changed_friend_label TEXT;
  day_of_week INTEGER;
  weekend_start DATE;
  weekend_end DATE;
  is_back_in_town BOOLEAN;
  recipient RECORD;
  scoped_label TEXT;
BEGIN
  IF NEW.status <> 'in_town' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.date = NEW.date THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, email, 'A friend')
  INTO changed_friend_label
  FROM public.users
  WHERE id = NEW.user_id;

  day_of_week := EXTRACT(ISODOW FROM NEW.date)::INTEGER;
  weekend_start := NEW.date - GREATEST(day_of_week - 5, 0);
  weekend_end := weekend_start + 2;
  is_back_in_town := TG_OP = 'UPDATE'
    AND OLD.status = 'out_of_town'
    AND NEW.status = 'in_town';

  FOR recipient IN
    SELECT
      preferences.user_id,
      preferences.weekend_in_town_enabled,
      preferences.back_in_town_enabled,
      preferences.delivery_channels,
      preferences.group_id,
      groups.name AS group_name
    FROM public.friendships friendships
    JOIN public.notification_preferences preferences
      ON preferences.user_id = friendships.user_id
    LEFT JOIN public.friend_groups groups
      ON groups.id = preferences.group_id
      AND groups.user_id = preferences.user_id
    WHERE friendships.friend_id = NEW.user_id
      AND friendships.status = 'accepted'
      AND preferences.coordination_enabled = TRUE
      AND (
        preferences.group_id IS NULL
        OR NEW.user_id = ANY(COALESCE(groups.friend_ids, '{}'::UUID[]))
      )
  LOOP
    scoped_label := CASE
      WHEN recipient.group_id IS NULL THEN 'Friends'
      ELSE COALESCE(recipient.group_name, 'Close friends')
    END;

    IF day_of_week BETWEEN 5 AND 7 AND recipient.weekend_in_town_enabled THEN
      PERFORM public.upsert_coordination_notification_batch(
        recipient.user_id,
        'weekend_in_town',
        recipient.group_id,
        weekend_start,
        weekend_end,
        NEW.user_id,
        scoped_label || ' are in town this weekend',
        'Open InTown to see who is around and coordinate plans.',
        public.build_coordination_deep_link(NEW.date, recipient.group_id),
        recipient.delivery_channels,
        GREATEST(
          NOW() + INTERVAL '15 minutes',
          (weekend_start::TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '18 hours'
        )
      );
    END IF;

    IF is_back_in_town AND recipient.back_in_town_enabled THEN
      PERFORM public.upsert_coordination_notification_batch(
        recipient.user_id,
        'back_in_town',
        recipient.group_id,
        NEW.date,
        NEW.date,
        NEW.user_id,
        changed_friend_label || ' is back in town',
        'Tap to see when they are around and coordinate plans.',
        public.build_coordination_deep_link(NEW.date, recipient.group_id),
        recipient.delivery_channels,
        NOW() + INTERVAL '15 minutes'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to update updated_at on calendar_entries
DROP TRIGGER IF EXISTS update_calendar_entries_updated_at ON public.calendar_entries;
CREATE TRIGGER update_calendar_entries_updated_at
  BEFORE UPDATE ON public.calendar_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS enqueue_coordination_notifications ON public.calendar_entries;
CREATE TRIGGER enqueue_coordination_notifications
  AFTER INSERT OR UPDATE OF status, date ON public.calendar_entries
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_coordination_notifications();

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

DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_coordination_notification_batches_updated_at ON public.coordination_notification_batches;
CREATE TRIGGER update_coordination_notification_batches_updated_at
  BEFORE UPDATE ON public.coordination_notification_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

