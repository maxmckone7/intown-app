-- ENG-101: Per-friend and per-group calendar privacy controls
-- Run this in your Supabase SQL editor AFTER schema.sql.
--
-- Model
--   Each user (the "owner" of a calendar) controls who can see their
--   availability. Visibility resolves to one of three levels:
--     full    - the viewer sees every calendar entry (in_town and out_of_town)
--     limited - the viewer sees only the owner's in_town days; travel/away
--               days stay private
--     hidden  - the viewer sees none of the owner's calendar entries
--
--   Resolution order for (owner -> viewer):
--     1. owner.appear_away = true            -> hidden (global "appear away")
--     2. an explicit per-friend rule          -> that rule's level
--     3. the most permissive matching group   -> that group's level
--        rule (full > limited > hidden) among groups containing the viewer
--     4. owner.default_visibility (default 'full')
--
--   Per-friend rules win over group rules so a single person can always be
--   given more (or less) access than the groups they belong to.

-- 1. Owner-level controls on the users table -------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS appear_away BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_visibility TEXT NOT NULL DEFAULT 'full'
    CHECK (default_visibility IN ('full', 'limited', 'hidden'));

-- 2. Per-friend / per-group visibility rules -------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_visibility (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('friend', 'group')),
  scope_id UUID NOT NULL, -- a users.id (friend) or friend_groups.id (group)
  level TEXT NOT NULL CHECK (level IN ('full', 'limited', 'hidden')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (owner_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_visibility_owner_id
  ON public.calendar_visibility(owner_id);
CREATE INDEX IF NOT EXISTS idx_calendar_visibility_scope
  ON public.calendar_visibility(scope_type, scope_id);

ALTER TABLE public.calendar_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own visibility rules" ON public.calendar_visibility;
CREATE POLICY "Users can view own visibility rules" ON public.calendar_visibility
  FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own visibility rules" ON public.calendar_visibility;
CREATE POLICY "Users can create own visibility rules" ON public.calendar_visibility
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own visibility rules" ON public.calendar_visibility;
CREATE POLICY "Users can update own visibility rules" ON public.calendar_visibility
  FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own visibility rules" ON public.calendar_visibility;
CREATE POLICY "Users can delete own visibility rules" ON public.calendar_visibility
  FOR DELETE USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS update_calendar_visibility_updated_at ON public.calendar_visibility;
CREATE TRIGGER update_calendar_visibility_updated_at
  BEFORE UPDATE ON public.calendar_visibility
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Effective visibility resolver -----------------------------------------
-- SECURITY DEFINER so it can read the owner's settings/rules regardless of the
-- viewer's RLS context. It only ever returns a visibility level, never data.

CREATE OR REPLACE FUNCTION public.effective_calendar_visibility(
  owner UUID,
  viewer UUID
)
RETURNS TEXT AS $$
DECLARE
  away BOOLEAN;
  default_level TEXT;
  resolved TEXT;
  level_rank CONSTANT JSONB := '{"hidden": 0, "limited": 1, "full": 2}'::jsonb;
BEGIN
  -- Owners always see their own calendar in full.
  IF owner = viewer THEN
    RETURN 'full';
  END IF;

  SELECT u.appear_away, COALESCE(u.default_visibility, 'full')
    INTO away, default_level
  FROM public.users u
  WHERE u.id = owner;

  -- Unknown owner: nothing to show.
  IF NOT FOUND THEN
    RETURN 'hidden';
  END IF;

  -- Global "appear away" / invisible overrides everything.
  IF away THEN
    RETURN 'hidden';
  END IF;

  -- 2. Most specific: an explicit per-friend rule.
  SELECT cv.level INTO resolved
  FROM public.calendar_visibility cv
  WHERE cv.owner_id = owner
    AND cv.scope_type = 'friend'
    AND cv.scope_id = viewer
  LIMIT 1;

  IF resolved IS NOT NULL THEN
    RETURN resolved;
  END IF;

  -- 3. Most permissive group rule among groups containing the viewer.
  SELECT cv.level INTO resolved
  FROM public.calendar_visibility cv
  JOIN public.friend_groups fg
    ON fg.id = cv.scope_id
   AND fg.user_id = owner
  WHERE cv.owner_id = owner
    AND cv.scope_type = 'group'
    AND viewer = ANY (fg.friend_ids)
  ORDER BY (level_rank ->> cv.level)::int DESC
  LIMIT 1;

  IF resolved IS NOT NULL THEN
    RETURN resolved;
  END IF;

  -- 4. Fall back to the owner's default.
  RETURN COALESCE(default_level, 'full');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- 4. Enforce visibility on calendar reads ----------------------------------
-- Replaces the friends-can-read policy from schema.sql with one that honors
-- the resolved visibility level. 'limited' viewers only get in_town rows.

DROP POLICY IF EXISTS "Users can view friends' calendar entries" ON public.calendar_entries;
CREATE POLICY "Users can view friends' calendar entries" ON public.calendar_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.friendships
      WHERE (user_id = auth.uid() AND friend_id = calendar_entries.user_id AND status = 'accepted')
         OR (friend_id = auth.uid() AND user_id = calendar_entries.user_id AND status = 'accepted')
    )
    AND (
      public.effective_calendar_visibility(calendar_entries.user_id, auth.uid()) = 'full'
      OR (
        public.effective_calendar_visibility(calendar_entries.user_id, auth.uid()) = 'limited'
        AND calendar_entries.status = 'in_town'
      )
    )
  );

-- 5. Viewer-facing helper --------------------------------------------------
-- Returns the effective visibility of each of the current user's accepted
-- friends *toward the current user*, so the client can correctly count
-- in-town friends (e.g. exclude hidden friends, don't assume limited friends
-- are in town on days they haven't shared).

CREATE OR REPLACE FUNCTION public.my_friends_visibility()
RETURNS TABLE (friend_id UUID, level TEXT) AS $$
  SELECT f.friend_id,
         public.effective_calendar_visibility(f.friend_id, auth.uid()) AS level
  FROM public.friendships f
  WHERE f.user_id = auth.uid()
    AND f.status = 'accepted';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
