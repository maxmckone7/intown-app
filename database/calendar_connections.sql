-- PRA-7: Google Calendar OAuth connection
-- Run this in your Supabase SQL editor AFTER schema.sql.
--
-- Stores the per-user Google account connection that powers status automation
-- (see the "Google Calendar Sync" project). This issue is scoped to the
-- connection + authorization lifecycle only; the sync worker (PRA-8) and
-- inference (PRA-9/10) read from this table but are defined elsewhere.
--
-- Connection lifecycle (`status`):
--   connected - a live authorization with a usable (refreshable) grant
--   expired   - the access token lapsed and could not be refreshed
--   revoked   - the user (or Google) revoked access; re-consent is required
--   error     - a connection attempt or verification failed for another reason
--
-- SECURITY NOTE — token custody
--   `access_token` / `refresh_token` are OAuth credentials and must be handled
--   securely. RLS below restricts every row to its owner, so no user can read
--   another user's grant. In this client-only architecture the owner's app is
--   also what refreshes the token, so the owner row necessarily holds it.
--   In a hardened deployment the token columns should move behind a server
--   boundary: perform the code/refresh exchange in an Edge Function with the
--   service-role key, revoke column-level SELECT on the token columns from the
--   `authenticated`/`anon` roles, and/or store them encrypted (pgsodium /
--   Vault). The service layer is written so that swap is a drop-in change.

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  -- Which external account is linked. Surfaced in the UI so the user can
  -- confirm the right Google account, and used to detect an account swap on
  -- reconnect.
  google_account_email TEXT,
  google_account_id TEXT, -- Google 'sub': stable, opaque account identifier
  -- The scopes actually granted (Google may grant a subset). Lets the app
  -- detect when required calendar access was declined.
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'revoked', 'error')),
  -- OAuth credentials — SENSITIVE. See the security note above.
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  -- Human-readable reason for a non-connected status, surfaced to the user.
  last_error TEXT,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Last time the grant was confirmed usable (successful refresh / API call).
  last_verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- One connection per provider per user; reconnecting updates the row.
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_user_id
  ON public.calendar_connections(user_id);
-- Supports a future sync worker scanning for grants due to refresh/verify.
CREATE INDEX IF NOT EXISTS idx_calendar_connections_status_expiry
  ON public.calendar_connections(status, token_expires_at);

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

-- RLS: a connection is private to its owner for every operation.
DROP POLICY IF EXISTS "Users can view own calendar connection" ON public.calendar_connections;
CREATE POLICY "Users can view own calendar connection" ON public.calendar_connections
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own calendar connection" ON public.calendar_connections;
CREATE POLICY "Users can create own calendar connection" ON public.calendar_connections
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own calendar connection" ON public.calendar_connections;
CREATE POLICY "Users can update own calendar connection" ON public.calendar_connections
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own calendar connection" ON public.calendar_connections;
CREATE POLICY "Users can delete own calendar connection" ON public.calendar_connections
  FOR DELETE USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_calendar_connections_updated_at ON public.calendar_connections;
CREATE TRIGGER update_calendar_connections_updated_at
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
