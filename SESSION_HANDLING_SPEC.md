# Auth & Accounts — Session Handling & Persistence

Reference spec for the lifecycle of an authenticated session: how a session is
created, where it is persisted, how it refreshes and expires, and how the app is
expected to recover when a session becomes invalid. This document defines the
*expected behavior*; the code is the source of truth for *where the flows branch
today*, and the two must agree.

- **Issue:** PRA-14 — Define session handling and persistence behavior
- **Project:** Auth & Accounts (sign up, log in, session handling, basic profile)
  · [PRD](https://linear.app/rideshare-company/project/auth-and-accounts-acb081eeaa13)
- **Relevant code:** session client config in `lib/supabase.ts`
  (`createClient(..., { auth: {...} })`, the dev `MockSupabaseClient`, and the
  fail-closed `createUnavailableAuthClient`); the session API surface in
  `services/auth.ts` (`authService.getSession`, `getCurrentUser`, `signOut`,
  and the sign-in/OAuth/reset paths that mint sessions); the cold-start routing
  gate in `app/index.tsx`; session-consuming screens `app/(tabs)/index.tsx`,
  `app/(tabs)/friends.tsx`, `app/(tabs)/profile.tsx`, `components/Header.tsx`,
  `components/MyCalendar.tsx`; and the code-exchange screens
  `app/auth/callback.tsx` and `app/auth/reset-password.tsx`.
- **Traceability:** Resolves the definition half of the PRD open question
  *"What session expiration and refresh behavior is expected?"* — the same
  question tracked as **§7** of `AUTH_OPEN_QUESTIONS.md` (PRA-20) and referenced
  as open question **O5** in `AUTH_METRICS_SPEC.md` (PRA-19). This spec is the
  definition of record for *session behavior*; those two docs remain the source
  of truth for the *residual product decisions* (exact token TTLs, the
  session-loss target) and the *reliability measure* respectively. When behavior
  here changes, update the cross-references in both.

## 1. How to read this

The session lifecycle is not owned by one file — it emerges from the Supabase
client configuration, a thin `authService` wrapper, and the individual screens
that read the session. This spec walks the lifecycle in order: **creation** (§3),
**persistence across normal usage** (§4), **refresh and expiration** (§5), and
**recovery from an invalid or expired session** (§6). Each section states the
behavior that is *settled in code today*, then the behavior that is *expected but
not yet implemented*, so the gap is explicit rather than implied.

Two distinctions thread through the whole document:

- **Local session vs. server-validated user.** `getSession()` reads the persisted
  session from storage without a network call; `getUser()` validates the access
  token against the auth server. The app uses both, and which one a screen uses
  changes what "signed in" means for that screen (see §4.2). Conflating them is
  the root of most recovery inconsistencies in §6.
- **Deliberate sign-out vs. unexpected loss.** A session that ends because the
  user tapped *Sign Out* is expected and terminal; a session that ends because a
  token refresh failed or the server invalidated it is *unexpected* and is what
  the reliability measure (`AUTH_METRICS_SPEC.md` M3) counts. The two must be
  distinguishable — today they are not (§6.3).

## 2. Session model & storage

A session is a Supabase `Session` object: an `access_token` (JWT), a
`refresh_token`, `expires_in` / `expires_at`, `token_type`, and the embedded
`user`. The real client is configured once, in `lib/supabase.ts`:

```
createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

- **`persistSession: true` + `storage: AsyncStorage`** — the session is written to
  device storage under a Supabase-managed key and survives app restarts (§4).
- **`autoRefreshToken: true`** — the client refreshes the access token in the
  background before it expires, using the refresh token (§5).
- **`detectSessionInUrl: false`** — the client does **not** auto-parse a session
  out of the URL; the app completes OAuth and reset flows explicitly via
  `exchangeCodeForSession` in `app/auth/callback.tsx` / `reset-password.tsx`
  (§3.3–§3.4). This is deliberate for the native deep-link scheme (`intown://`).

Two non-production variants exist and must be reasoned about separately:

- **Dev mock (`MockSupabaseClient`, `__DEV__` + no env).** Persists a single
  `auth_session` record in `AsyncStorage`. It hard-codes `expires_in: 3600` and
  `expires_at: Date.now() + 3600000` but **nothing enforces that expiry** and its
  `onAuthStateChange` is a no-op — so in dev, sessions never expire or refresh.
  This is a fidelity gap to keep in mind when testing §5–§6 behavior.
- **Fail-closed client (`createUnavailableAuthClient`, non-dev + no env).** Every
  auth call returns a fixed error and `getSession` returns `null`, so a
  misconfigured production build refuses to mint sessions rather than issuing
  fake `mock_token_*` sessions. Session behavior in this mode is "no session,
  ever" by design.

## 3. Session creation

A session is created (persisted and made the current session) at exactly these
points. All of them funnel through the Supabase client, which writes the session
to storage on success.

| # | Trigger | Path | Result |
| - | ------- | ---- | ------ |
| C1 | Password sign-up | `authService.signUp` → `supabase.auth.signUp` | Session **iff** the Supabase project does not require email confirmation; otherwise `session` is `null` and the user is held at "Check your email" (see §3.1). |
| C2 | Password sign-in | `authService.signIn` → `signInWithPassword` | Session on valid credentials; throws on invalid. |
| C3 | OAuth (Google / Apple) | `completeOAuthSignIn` → `signInWithOAuth` → `exchangeCodeForSession(code)` | Session after the browser round-trip returns an auth code and it is exchanged. `ensureUserProfile` then upserts the profile row. |
| C4 | Password reset | `reset-password.tsx` → `exchangePasswordResetCode(code)` | A **temporary** session established solely to authorize `updatePassword`; deliberately torn down immediately after (see §3.4). |

### 3.1 The verification fork (C1)

Password sign-up has two terminal states and only one of them creates a usable
session. When Supabase's "Confirm email" setting is on, `signUp` returns no
session; `signup.tsx` detects the null session and shows the pending-verification
screen. A session is created only later, when the emailed link lands on
`app/auth/callback.tsx` and the code is exchanged. Whether verification is
mandatory is an **open product decision** (`AUTH_OPEN_QUESTIONS.md` §2) — this
spec does not settle it, but session creation must be understood as *possibly
deferred to the callback* for the password path. OAuth (C3) always returns a
session inline because the provider pre-verifies the email.

### 3.2 New-vs-returning tagging

`isLikelyNewAuthUser` (`services/auth.ts`) infers whether a freshly created
session belongs to a brand-new account by comparing `created_at` and
`last_sign_in_at` (within 10s). The OAuth path surfaces this as `isNewUser`. This
is a heuristic used for onboarding/metrics, not an authorization signal — never
gate access on it.

### 3.3 OAuth code exchange (C3)

`completeOAuthSignIn` opens `WebBrowser.openAuthSessionAsync`, requires the result
type to be `success`, parses `error`/`error_description`/`code` from the returned
URL, and calls `exchangeCodeForSession`. A cancelled browser session, a returned
error param, or a missing code each throw **before** any session is created — so
a failed OAuth attempt leaves the prior session state untouched.

### 3.4 Reset produces a deliberately short-lived session (C4)

`reset-password.tsx` exchanges the reset code for a session **only** to authorize
`updatePassword`, then calls `authService.signOut()` in a `try/catch` (a failure
to sign out is logged, not surfaced) and routes to login. The expected behavior:
a password reset never leaves the user silently signed in on the reset device;
they must re-authenticate with the new password. This is intentional and should
be preserved.

## 4. Persistence across normal usage

### 4.1 Cold start (app launch)

`persistSession: true` means the session survives process death. On launch,
`app/index.tsx` is the single routing gate:

```
const { data: { session } } = await supabase.auth.getSession();
session ? router.replace('/(tabs)') : router.replace('/(auth)/login');
// on throw → router.replace('/(auth)/login')
```

Expected behavior: a returning user with a valid persisted session lands directly
in the app; a user with no session lands on login; any error resolving the
session **fails to login** (safe default). Note this uses `getSession()` — a
**local** read that trusts the stored session without server validation (§4.2).

### 4.2 During a session — local vs. server reads

Once inside `(tabs)`, screens re-derive identity on their own, and they do not
all do it the same way:

- **`app/index.tsx`** uses `getSession()` — local, no network. Fast, but will
  treat a locally-present-but-server-revoked session as valid until a refresh is
  attempted.
- **`authService.getCurrentUser()` → `getUser()`** — used by `(tabs)/index.tsx`,
  `(tabs)/friends.tsx`, `(tabs)/profile.tsx`, `Header.tsx`, `MyCalendar.tsx`, and
  `invite/[token].tsx`. This validates the token against the auth server, so it
  is the read that actually notices a revoked/expired session.

Expected behavior: the routing gate may use the fast local read, but any screen
that loads user-scoped data should treat a null `getCurrentUser()` as "session no
longer valid" and route to recovery (§6). Today that reaction is **inconsistent**
across screens (§6.2).

### 4.3 What is NOT persisted / synced

There is **no reactive session subscription** anywhere in the app. The mock
exposes `onAuthStateChange`, and `AUTH_METRICS_SPEC.md` §3.3 assumes a listener,
but no screen subscribes to it. Consequences:

- Session state is only ever *pulled* (on mount / on cold start), never *pushed*.
  A change to the session while a screen is idle (background refresh success, or
  a refresh failure) does not notify the UI.
- There is no cross-screen propagation: signing out in `profile.tsx` updates that
  screen's local state and navigates, but other mounted screens are not told.

This is the central architectural gap for both refresh handling (§5) and recovery
(§6), and is called out as open question **Q1** in §7.

## 5. Refresh and expiration

### 5.1 Refresh (expected behavior)

With `autoRefreshToken: true`, the Supabase client schedules a background refresh
of the access token shortly before `expires_at`, exchanging the refresh token for
a new access token and persisting the rotated session. During normal foreground
usage this is transparent: the user's access token is kept fresh without any UI
involvement.

Two behaviors are **expected but unverified in this codebase**:

- **Foreground/refresh on resume.** Supabase's auto-refresh timer is most reliable
  while the app is foregrounded. After a long background period the first
  foregrounded call may need to refresh on demand. Because no `AppState` hook or
  `onAuthStateChange` listener is wired, the app does not explicitly drive a
  refresh on resume — it relies entirely on the client's internal timer and on
  the next `getUser()`/data call to trigger a refresh. This should be validated
  (§7, Q2).
- **Refresh emits `TOKEN_REFRESHED`.** A successful refresh fires a
  `TOKEN_REFRESHED` auth event. Nothing consumes it today (§4.3), so a refresh is
  invisible to the app and cannot be instrumented as `session_refreshed`
  (`AUTH_METRICS_SPEC.md` §3.3) until a listener exists.

### 5.2 Expiration (expected behavior)

An access token expires at `expires_at`; the session as a whole ends when the
refresh token can no longer be exchanged — because it expired, was rotated out,
or was revoked server-side. Actual lifetimes are **governed by Supabase project
config, not the app**: the app sets no TTLs. Supabase defaults are a ~1-hour
access token with a longer, rotating refresh token, but the values of record are
not documented here and remain an **open decision** (`AUTH_OPEN_QUESTIONS.md` §7;
§7 Q3 below). The dev mock's `expires_in: 3600` is a placeholder and, as noted in
§2, is not actually enforced.

Expected end-state on expiration: when the refresh token can no longer be
exchanged, the session is invalid and the next server-validated read
(`getUser()`) returns null, which must route the user to recovery (§6). What must
*not* happen: the user silently seeing empty or stale user-scoped screens with no
prompt to re-authenticate.

## 6. Recovery from invalid or expired sessions

"Invalid session" covers: an expired session whose refresh failed, a session
revoked server-side (password change elsewhere, remote sign-out), corrupted
persisted storage, and the fail-closed client (§2). Recovery = detecting the
invalid session and returning the user to a clean authenticated state (usually via
login) without a crash or a dead-end screen.

### 6.1 Recovery paths that exist today

| Location | Detection | Reaction |
| -------- | --------- | -------- |
| `app/index.tsx` (cold start) | `getSession()` null **or** throws | `router.replace('/(auth)/login')` — the one clean, complete recovery path. |
| `app/(tabs)/profile.tsx` | `getCurrentUser()` null | `navigateToLogin()` (web `push` / native `replace`). |
| `app/(tabs)/index.tsx`, `app/(tabs)/friends.tsx` | `getCurrentUser()` null | Sets an in-screen error: *"We could not confirm your session. Please sign in again."* — shows a banner but does **not** navigate. |
| `app/auth/reset-password.tsx` | No code and `getSession()` null | Alerts and routes to `forgot-password`. |
| Deliberate `signOut` (`profile.tsx`) | User action | Clears local user, `navigateToLogin()`. |

### 6.2 The inconsistency to resolve

The same trigger — `getCurrentUser()` returning null because the session is gone
— produces **three different outcomes**: `profile.tsx` redirects to login, while
`(tabs)/index.tsx` and `friends.tsx` show a "please sign in again" banner and
stay put (leaving the user on an authenticated route with no session), and screens
like `Header.tsx` / `MyCalendar.tsx` read the user for display and simply render
without it. Expected behavior: a null server-validated user anywhere inside
`(tabs)` should resolve to **one** recovery action — route to login — ideally via
a single shared guard rather than per-screen handling. This is open question
**Q4** (§7).

### 6.3 Deliberate vs. unexpected loss is not distinguishable

Recovery today cannot tell an expired/revoked session (unexpected) from a normal
sign-out (deliberate), because there is no listener and no marker around
`authService.signOut`. `AUTH_METRICS_SPEC.md` M3 counts only *unexpected* loss, so
this gap blocks the reliability metric as well as any differentiated UX (e.g. a
"your session expired, please sign in again" message shown only on unexpected
loss). Expected behavior: mark user-initiated sign-out so an observer can classify
every session end. Tracked as **Q5** (§7).

### 6.4 Target recovery behavior (to implement)

The end-state this spec defines, pending the open questions in §7:

1. A single global observer (an `onAuthStateChange` subscription mounted above the
   `(tabs)` tree, or an equivalent guard) watches for the session becoming null.
2. On an **unexpected** loss it routes to login once, from wherever the user is,
   and may surface a "session expired" message; on a **deliberate** sign-out it
   routes silently.
3. Individual screens stop implementing their own divergent null-session handling
   (§6.2) and rely on the guard.
4. The cold-start gate (§4.1) remains the fallback for launch-time recovery.

## 7. Open questions

Called out explicitly per the issue's acceptance criteria. These are the residual
decisions and gaps that this spec surfaces but does not itself resolve; each is an
input to implementing §5–§6.

- **Q1 — No reactive session listener.** No `onAuthStateChange` subscription
  exists in the real app (§4.3). Without it, refresh success, refresh failure, and
  server-side invalidation are all invisible to the UI. This is the prerequisite
  for reactive refresh handling (§5.1), unified recovery (§6.4), and the
  session-reliability instrumentation in `AUTH_METRICS_SPEC.md` §3.3. *(New —
  surfaced by this spec.)*
- **Q2 — Refresh-on-resume behavior.** Is a refresh reliably driven when the app
  returns to the foreground after a long background period, or is an explicit
  `AppState`-driven refresh needed (§5.1)? Needs validation on device.
- **Q3 — Token lifetimes of record.** The access-token TTL and refresh-token
  lifetime/rotation are Supabase defaults and are not documented or explicitly
  chosen (§5.2). *(Same decision as `AUTH_OPEN_QUESTIONS.md` §7; Eng lead to
  confirm the Supabase project config.)*
- **Q4 — Unified recovery action.** Should a null server-validated user inside
  `(tabs)` always route to login via one shared guard, replacing the three
  divergent behaviors in §6.2? *(Product/Eng decision on UX + implementation.)*
- **Q5 — Deliberate-vs-unexpected classification.** How is a user-initiated
  `signOut` marked so an observer can separate it from unexpected loss (§6.3)?
  Blocks the M3 reliability measure and any expiry-specific messaging.
- **Q6 — Multi-device / remote sign-out.** Are concurrent sessions and remote
  sign-out (revoking a session from another device) in scope, and if so what is
  the expected propagation to the app? Currently undefined
  (`AUTH_OPEN_QUESTIONS.md` §7).

## 8. Change checklist

When editing session config, the session API, or any session-consuming screen:

1. If you change the client `auth` config in `lib/supabase.ts` (`persistSession`,
   `autoRefreshToken`, `detectSessionInUrl`, storage), update §2 and §4–§5 so the
   documented behavior still matches.
2. If you add a new way to create a session, add a row to §3's table.
3. Keep the local (`getSession`) vs. server-validated (`getUser`) distinction
   (§4.2) intact — don't gate authorization on the local read alone.
4. Any new session-consuming screen must use the unified recovery action (§6.4)
   once it exists; until then, prefer `profile.tsx`'s redirect over the
   banner-only pattern, and record any deviation.
5. When an open question in §7 is answered, replace the behavior it gates in
   §5–§6 and delete it here, and update the cross-referenced entry in
   `AUTH_OPEN_QUESTIONS.md` §7 / `AUTH_METRICS_SPEC.md` (O5) in the same change so
   the three documents never disagree.
6. Preserve the reset-flow sign-out (§3.4) and the fail-closed behavior (§2) — both
   are intentional security properties, not incidental.
