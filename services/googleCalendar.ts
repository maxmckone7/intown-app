/**
 * Google Calendar OAuth connection (PRA-7).
 *
 * Owns the *connection + authorization* lifecycle for the Google Calendar Sync
 * project: letting a user securely connect a Google account, requesting the
 * calendar access the sync feature needs, surfacing connection failures, and
 * detecting/handling authorization that has been revoked or has expired.
 *
 * Deliberately out of scope here (separate issues): fetching/interpreting
 * calendar events (PRA-8/9), and updating in/out status (PRA-10). Those read
 * the connection this module produces via `getStoredConnection` /
 * `getFreshAccessToken`.
 *
 * Auth model: a dedicated OAuth grant, independent of how the user signed in
 * (they may use email/password and still connect Google Calendar). We use an
 * installed-app style PKCE flow (no client secret shipped in the app) and
 * request offline access so status can be refreshed without re-prompting.
 *
 * See database/calendar_connections.sql for the storage model and the note on
 * hardening token custody behind a server boundary in production.
 */

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';

// `__DEV__` is injected by the React Native / Expo runtime.
declare const __DEV__: boolean;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

WebBrowser.maybeCompleteAuthSession();

// --- Configuration ---------------------------------------------------------

/**
 * OAuth client id for the Google Calendar connection. This must be an
 * iOS/Android/Desktop ("installed app") OAuth client so the PKCE flow works
 * without shipping a client secret. Configure it in .env — see .env.example.
 */
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID?.trim();

/** Read-only calendar access is all status inference needs. */
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const REQUIRED_SCOPES = [CALENDAR_SCOPE];
/** `openid`/`email` let us record which Google account was connected. */
const GOOGLE_CALENDAR_SCOPES = ['openid', 'email', CALENDAR_SCOPE];

const GOOGLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const getRedirectUri = () =>
  AuthSession.makeRedirectUri({
    scheme: 'intown',
    path: 'auth/google-calendar',
    isTripleSlashed: true,
  });

/** True once a real Google OAuth client id is configured. */
export const isCalendarConnectionConfigured = () => Boolean(GOOGLE_CLIENT_ID);

/**
 * In dev without a configured Google client we simulate the OAuth exchange so
 * the connection UX is fully exercisable against the mock backend — mirroring
 * how lib/supabase.ts mocks `signInWithOAuth`. Never simulates in production.
 */
const SIMULATE = !isCalendarConnectionConfigured() && isDev;

// --- Types -----------------------------------------------------------------

export type CalendarProvider = 'google';

export type CalendarConnectionStatus =
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'error';

/**
 * The client-visible shape of a connection. Intentionally excludes the OAuth
 * token columns — the UI never needs them, and keeping them out of this read
 * keeps credentials from spreading through the app.
 */
export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  google_account_email: string | null;
  scopes: string[];
  status: CalendarConnectionStatus;
  token_expires_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
}

/** Non-secret columns for status reads. */
const PUBLIC_COLUMNS =
  'id, user_id, provider, google_account_email, scopes, status, token_expires_at, last_error, connected_at, last_verified_at';

/** Discriminated failure codes so the UI can message each case clearly. */
export type CalendarConnectionErrorCode =
  | 'not_configured'
  | 'cancelled'
  | 'scope_denied'
  | 'token_exchange_failed'
  | 'account_lookup_failed'
  | 'revoked'
  | 'network'
  | 'persist_failed'
  | 'unknown';

export class CalendarConnectionError extends Error {
  code: CalendarConnectionErrorCode;
  cause?: unknown;

  constructor(code: CalendarConnectionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CalendarConnectionError';
    this.code = code;
    this.cause = cause;
  }
}

// --- Internal helpers ------------------------------------------------------

/** A connection row including the sensitive token columns (owner-only via RLS). */
interface StoredConnection extends CalendarConnection {
  google_account_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
}

const now = () => new Date();
const nowIso = () => now().toISOString();

/** Expiry with a safety margin so we refresh before a token actually lapses. */
const isExpired = (tokenExpiresAt: string | null, skewMs = 60_000) => {
  if (!tokenExpiresAt) return true;
  const expiresAt = Date.parse(tokenExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - skewMs <= Date.now();
};

const expiryFromToken = (token: AuthSession.TokenResponse): string | null => {
  if (!token.expiresIn) return null;
  const issuedAt = token.issuedAt ?? Math.floor(Date.now() / 1000);
  return new Date((issuedAt + token.expiresIn) * 1000).toISOString();
};

/** Read the full row (tokens included) for the current user's provider grant. */
const readStored = async (
  userId: string,
  provider: CalendarProvider = 'google'
): Promise<StoredConnection | null> => {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();

  if (error) {
    // PGRST116 = no rows; a missing connection is a normal state, not an error.
    if ((error as { code?: string }).code === 'PGRST116') return null;
    throw new CalendarConnectionError('unknown', error.message, error);
  }
  return data as StoredConnection;
};

const toPublic = (row: StoredConnection | CalendarConnection): CalendarConnection => ({
  id: row.id,
  user_id: row.user_id,
  provider: row.provider,
  google_account_email: row.google_account_email ?? null,
  scopes: row.scopes ?? [],
  status: row.status,
  token_expires_at: row.token_expires_at ?? null,
  last_error: row.last_error ?? null,
  connected_at: row.connected_at ?? null,
  last_verified_at: row.last_verified_at ?? null,
});

/** Upsert the single (user, provider) connection row and return the fresh row. */
const persist = async (
  userId: string,
  fields: Partial<StoredConnection>
): Promise<StoredConnection> => {
  const existing = await readStored(userId);
  const payload = {
    ...(existing?.id ? { id: existing.id } : {}),
    user_id: userId,
    provider: 'google' as CalendarProvider,
    ...fields,
    updated_at: nowIso(),
  };

  const { data, error } = await supabase
    .from('calendar_connections')
    .upsert(payload, { onConflict: 'user_id,provider' })
    .select('*')
    .single();

  if (error) {
    throw new CalendarConnectionError('persist_failed', error.message, error);
  }
  return data as StoredConnection;
};

/** Fetch the connected account's email + stable id from the granted token. */
const fetchGoogleAccount = async (
  accessToken: string
): Promise<{ email: string | null; sub: string | null }> => {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new CalendarConnectionError(
        'account_lookup_failed',
        `Google account lookup failed (${res.status}).`
      );
    }
    const info = (await res.json()) as { email?: string; sub?: string };
    return { email: info.email ?? null, sub: info.sub ?? null };
  } catch (error) {
    if (error instanceof CalendarConnectionError) throw error;
    throw new CalendarConnectionError(
      'network',
      'Could not reach Google to confirm the connected account.',
      error
    );
  }
};

const grantedScopes = (scope: string | undefined): string[] =>
  (scope ?? '').split(/\s+/).filter(Boolean);

const hasRequiredScopes = (scopes: string[]) =>
  REQUIRED_SCOPES.every((required) => scopes.includes(required));

/** Map a token-endpoint failure to a clear, cause-specific connection error. */
const toTokenError = (error: unknown): CalendarConnectionError => {
  const code = (error as { code?: string })?.code;
  // Google returns invalid_grant when a refresh token has been revoked/expired.
  if (code === 'invalid_grant') {
    return new CalendarConnectionError(
      'revoked',
      'Google access was revoked or expired. Reconnect to resume calendar sync.',
      error
    );
  }
  const message =
    (error as { message?: string })?.message || 'Failed to exchange the Google authorization.';
  return new CalendarConnectionError('token_exchange_failed', message, error);
};

// --- Public API ------------------------------------------------------------

/**
 * Read the current user's calendar connection (status only, no tokens).
 * Returns null when the user has never connected.
 */
const getConnection = async (
  userId: string
): Promise<CalendarConnection | null> => {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select(PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') return null;
    throw new CalendarConnectionError('unknown', error.message, error);
  }
  return toPublic(data as CalendarConnection);
};

/**
 * Run the Google OAuth connection flow and persist the resulting grant.
 * Throws a `CalendarConnectionError` with a specific `code` on every failure
 * path (cancelled, scope declined, exchange failed, network, …) so callers can
 * surface a clear message.
 */
const connect = async (userId: string): Promise<CalendarConnection> => {
  if (SIMULATE) {
    return simulateConnect(userId);
  }

  if (!GOOGLE_CLIENT_ID) {
    throw new CalendarConnectionError(
      'not_configured',
      'Google Calendar isn’t configured yet. Set EXPO_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID to enable calendar sync.'
    );
  }

  const redirectUri = getRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: GOOGLE_CALENDAR_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      // Request a refresh token and force the consent screen so it is issued
      // even on a re-connect, and let Google carry over prior grants.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  });

  let result: AuthSession.AuthSessionResult;
  try {
    result = await request.promptAsync(GOOGLE_DISCOVERY);
  } catch (error) {
    throw new CalendarConnectionError(
      'network',
      'Could not start the Google connection. Check your connection and try again.',
      error
    );
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new CalendarConnectionError(
      'cancelled',
      'Google connection was cancelled before it finished.'
    );
  }
  if (result.type !== 'success') {
    const description =
      (result.type === 'error' && (result.error?.message || result.params?.error_description)) ||
      'The Google connection did not complete.';
    throw new CalendarConnectionError('token_exchange_failed', description);
  }

  const code = result.params.code;
  if (!code) {
    throw new CalendarConnectionError(
      'token_exchange_failed',
      'Google did not return an authorization code.'
    );
  }

  let token: AuthSession.TokenResponse;
  try {
    token = await AuthSession.exchangeCodeAsync(
      {
        clientId: GOOGLE_CLIENT_ID,
        code,
        redirectUri,
        extraParams: request.codeVerifier
          ? { code_verifier: request.codeVerifier }
          : undefined,
      },
      GOOGLE_DISCOVERY
    );
  } catch (error) {
    throw toTokenError(error);
  }

  const scopes = grantedScopes(token.scope);
  if (!hasRequiredScopes(scopes)) {
    // The user connected but declined calendar access — record the failure so
    // the UI can explain exactly what to re-grant, and don't mark it connected.
    await persist(userId, {
      status: 'error',
      scopes,
      last_error:
        'Calendar access wasn’t granted. Reconnect and allow calendar access to enable sync.',
    });
    throw new CalendarConnectionError(
      'scope_denied',
      'Calendar access wasn’t granted. Reconnect and allow read access to your calendar.'
    );
  }

  const account = await fetchGoogleAccount(token.accessToken);

  const row = await persist(userId, {
    google_account_email: account.email,
    google_account_id: account.sub,
    scopes,
    status: 'connected',
    access_token: token.accessToken,
    refresh_token: token.refreshToken ?? null,
    token_expires_at: expiryFromToken(token),
    last_error: null,
    connected_at: nowIso(),
    last_verified_at: nowIso(),
  });

  return toPublic(row);
};

/**
 * Ensure a usable access token for the connection, refreshing if needed.
 * This is the seam the sync worker (PRA-8) calls before reading calendar data.
 * On a revoked/expired grant it records the terminal status and throws a
 * `CalendarConnectionError` whose `code` says which happened.
 */
const getFreshAccessToken = async (userId: string): Promise<string> => {
  const stored = await readStored(userId);
  if (!stored) {
    throw new CalendarConnectionError(
      'unknown',
      'No Google Calendar connection to refresh.'
    );
  }

  if (stored.access_token && !isExpired(stored.token_expires_at)) {
    return stored.access_token;
  }

  if (SIMULATE) {
    const refreshed = await persist(userId, {
      status: 'connected',
      access_token: `sim_access_${Date.now()}`,
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      last_error: null,
      last_verified_at: nowIso(),
    });
    return refreshed.access_token as string;
  }

  if (!stored.refresh_token || !GOOGLE_CLIENT_ID) {
    await markRevoked(
      userId,
      'The Google connection can no longer be refreshed. Please reconnect.'
    );
    throw new CalendarConnectionError(
      'revoked',
      'The Google connection can no longer be refreshed. Please reconnect.'
    );
  }

  let refreshed: AuthSession.TokenResponse;
  try {
    refreshed = await AuthSession.refreshAsync(
      { clientId: GOOGLE_CLIENT_ID, refreshToken: stored.refresh_token },
      GOOGLE_DISCOVERY
    );
  } catch (error) {
    const mapped = toTokenError(error);
    // Persist the terminal state so the UI reflects it without another attempt.
    await persist(userId, {
      status: mapped.code === 'revoked' ? 'revoked' : 'expired',
      last_error: mapped.message,
    });
    throw mapped;
  }

  const row = await persist(userId, {
    status: 'connected',
    access_token: refreshed.accessToken,
    // Google may omit a rotated refresh token; keep the existing one.
    refresh_token: refreshed.refreshToken ?? stored.refresh_token,
    token_expires_at: expiryFromToken(refreshed),
    last_error: null,
    last_verified_at: nowIso(),
  });
  return row.access_token as string;
};

/**
 * Actively check whether the stored authorization is still valid, updating and
 * returning the connection's status. Detects the "revoked or expired" case by
 * attempting a refresh when the access token has lapsed. Safe to call on app
 * focus or before a sync run.
 */
const verifyConnection = async (
  userId: string
): Promise<CalendarConnection | null> => {
  const stored = await readStored(userId);
  if (!stored) return null;

  // A grant already known to be terminal doesn't need re-checking.
  if (stored.status === 'revoked') return toPublic(stored);

  if (stored.access_token && !isExpired(stored.token_expires_at)) {
    const row = await persist(userId, {
      status: 'connected',
      last_error: null,
      last_verified_at: nowIso(),
    });
    return toPublic(row);
  }

  try {
    await getFreshAccessToken(userId);
  } catch (error) {
    if (error instanceof CalendarConnectionError) {
      // Status was already persisted by getFreshAccessToken; reflect it back.
      const latest = await readStored(userId);
      return latest ? toPublic(latest) : null;
    }
    throw error;
  }

  const latest = await readStored(userId);
  return latest ? toPublic(latest) : null;
};

/** Flag a connection as revoked (used here and by the sync worker on a 401). */
const markRevoked = async (
  userId: string,
  reason = 'Google access was revoked. Reconnect to resume calendar sync.'
): Promise<CalendarConnection | null> => {
  const stored = await readStored(userId);
  if (!stored) return null;
  const row = await persist(userId, {
    status: 'revoked',
    last_error: reason,
    access_token: null,
  });
  return toPublic(row);
};

/**
 * Disconnect: best-effort revoke the grant at Google, then remove the stored
 * connection so the user returns to a clean "not connected" state.
 */
const disconnect = async (userId: string): Promise<void> => {
  const stored = await readStored(userId);
  if (!stored) return;

  if (!SIMULATE && GOOGLE_CLIENT_ID) {
    const tokenToRevoke = stored.refresh_token || stored.access_token;
    if (tokenToRevoke) {
      try {
        await AuthSession.revokeAsync(
          { token: tokenToRevoke, clientId: GOOGLE_CLIENT_ID },
          GOOGLE_DISCOVERY
        );
      } catch (error) {
        // Revocation is best-effort; still remove the local connection.
        if (isDev) {
          // eslint-disable-next-line no-console
          console.warn('[googleCalendar] token revoke failed', error);
        }
      }
    }
  }

  const { error } = await supabase
    .from('calendar_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'google');

  if (error) {
    throw new CalendarConnectionError('persist_failed', error.message, error);
  }
};

// --- Dev simulation --------------------------------------------------------

/** Fabricate a successful connection so the flow is demoable without Google. */
const simulateConnect = async (userId: string): Promise<CalendarConnection> => {
  const row = await persist(userId, {
    google_account_email: 'dev-calendar@intown.local',
    google_account_id: `sim_${userId}`,
    scopes: GOOGLE_CALENDAR_SCOPES,
    status: 'connected',
    access_token: `sim_access_${Date.now()}`,
    refresh_token: `sim_refresh_${Date.now()}`,
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    last_error: null,
    connected_at: nowIso(),
    last_verified_at: nowIso(),
  });
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log('[googleCalendar] simulated connection (no client id configured)');
  }
  return toPublic(row);
};

export const googleCalendarService = {
  isConfigured: isCalendarConnectionConfigured,
  getConnection,
  connect,
  disconnect,
  verifyConnection,
  getFreshAccessToken,
  markRevoked,
  /** Exposed for tests / callers that need the raw grant (e.g. the sync worker). */
  getStoredConnection: readStored,
};
