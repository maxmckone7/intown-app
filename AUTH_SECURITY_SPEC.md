# Auth & Accounts — Security and Abuse-Prevention Requirements

Non-functional requirements for account access and session integrity. Defines
the security expectations for authentication, the rules a session must satisfy
to be trusted, the abuse and misuse vectors the account surface must account
for, and the policy/compliance constraints already known. Where a requirement
is already met by shipped code, the enforcement point is named; where it is not,
it is called out as a gap or an open question rather than described as done.

- **Issue:** PRA-18 — Specify security and abuse-prevention requirements
- **Project:** Auth & Accounts (login, account creation, basic user profile)
- **Scope of enforcement:** Authentication and sessions run on **Supabase Auth**
  (`services/auth.ts`, `lib/supabase.ts`). Authorization is enforced by
  **Postgres Row Level Security** (`database/schema.sql`, `database/privacy.sql`).
  This document is the source of truth for the *requirements*; the code and the
  Supabase project configuration are the source of truth for the *values*, and
  the two must agree.
- **Status key:** ✅ met by current code · ⚠️ partial / gap · ❓ open question ·
  🔒 depends on Supabase project settings (not in this repo).

> **Requirement levels.** "MUST" is a release blocker. "SHOULD" is expected
> unless there is a documented reason to skip. "MAY" is optional.

## 1. What this covers, and the trust boundary

The account surface is: email/password sign-up and sign-in, Google/Apple OAuth,
password reset, session persistence, the basic user profile
(`public.users`), and the friend/invite graph that gates who can see a user's
whereabouts.

The **client is untrusted**. The React Native app runs on user-controlled
devices, ships with the public `anon` key, and can be tampered with; any
validation it performs (e.g. the 6-character password check in `signup.tsx`) is
a UX affordance, not a security control. Every security guarantee in this
document MUST be enforced server-side — in Supabase Auth or in an RLS policy /
`SECURITY DEFINER` function — and MUST hold even if the client is bypassed and
requests are made directly against the API with a valid token.

**Sensitivity of the data being protected.** A user's calendar encodes their
*physical whereabouts over time* ("in town" / "out of town" per date), plus a
free-text `location` and social-account handles. This is location-adjacent
personal data: the abuse and compliance requirements below are calibrated to
that sensitivity, not to a generic CRUD app.

## 2. Authentication requirements

### 2.1 Identity and credentials

| # | Requirement | Level | Status | Enforcement / notes |
| - | ----------- | ----- | ------ | ------------------- |
| A1 | Support email+password and Google/Apple OAuth as the only sign-in methods | MUST | ✅ | `authService` in `services/auth.ts` |
| A2 | Passwords MUST be verified and stored only by Supabase Auth (bcrypt/scrypt); the app never sees or persists a password hash | MUST | ✅ | app only forwards plaintext over TLS to Supabase |
| A3 | Minimum password policy MUST be enforced **server-side**, not just in the client | MUST | ⚠️🔒 | client checks `length < 6` (`signup.tsx:56`, `reset-password.tsx:95`); server minimum is a Supabase setting — see O1 |
| A4 | Passwords SHOULD be screened against a breached-password list | SHOULD | ❓🔒 | Supabase "leaked password protection" toggle — see O1 |
| A5 | OAuth MUST use the authorization-code + PKCE flow; tokens are never taken from a URL fragment in the client | MUST | ✅ | `signInWithOAuth` → `exchangeCodeForSession` (`services/auth.ts:81-125`); `detectSessionInUrl: false` (`lib/supabase.ts:628`) |
| A6 | Google sign-in MUST prompt account selection to avoid silent reuse of a shared-device session | SHOULD | ✅ | `prompt: 'select_account'` (`services/auth.ts:88`) |
| A7 | Apple Sign In MUST be offered on iOS wherever a third-party social login is offered | MUST | ✅ | required by App Store Guideline 4.8; `signInWithApple` present, Apple button gated to iOS (`login.tsx:262`) |

### 2.2 Email verification and account state

| # | Requirement | Level | Status | Enforcement / notes |
| - | ----------- | ----- | ------ | ------------------- |
| A8 | New email/password accounts MUST verify ownership of the email before the account is treated as trusted | MUST | ⚠️🔒 | sign-up sends a verification email (`emailRedirectTo`, `services/auth.ts:136`); whether unverified users are *blocked* from signing in is a Supabase "Confirm email" setting — see O2 |
| A9 | Password-reset requests MUST NOT reveal whether an email is registered (no account enumeration) | MUST | ✅ | `resetPasswordForEmail` returns success regardless; mirrored in the mock (`lib/supabase.ts:112-115`) and the forgot-password UI copy |
| A10 | Sign-in failures MUST return a generic error that does not distinguish "no such user" from "wrong password" | MUST | ✅ | `signIn` surfaces Supabase's generic "Invalid login credentials" (`services/auth.ts:155-169`) |

### 2.3 Fail-closed configuration

The app MUST NOT fall back to a permissive or fake auth path in production.

| # | Requirement | Level | Status | Enforcement / notes |
| - | ----------- | ----- | ------ | ------------------- |
| A11 | If Supabase credentials are missing in a **non-dev** build, all auth requests MUST be rejected (fail closed) — never mint local sessions | MUST | ✅ | `createUnavailableAuthClient` (`lib/supabase.ts:597-648`) |
| A12 | The in-memory mock client (which issues predictable `mock_token_<id>` sessions) MUST be reachable **only** under `__DEV__` | MUST | ✅ | guarded by `__DEV__` (`lib/supabase.ts:631`); the mock is a development convenience and is not a security control |
| A13 | Supabase URL/anon key are the only secrets shipped to the client; no service-role key or other privileged secret is ever bundled | MUST | ✅ | only `EXPO_PUBLIC_*` env is read (`lib/supabase.ts:20-21`) |

## 3. Session validity and protection

A session is the bearer token pair (`access_token` JWT + `refresh_token`) that
Supabase issues on sign-in.

| # | Requirement | Level | Status | Enforcement / notes |
| - | ----------- | ----- | ------ | ------------------- |
| S1 | Access tokens MUST be short-lived and auto-refreshed; a stolen access token is only usable for the token lifetime | MUST | ✅🔒 | `autoRefreshToken: true` (`lib/supabase.ts:626`); JWT expiry (default ~1h) is a Supabase setting — see O3 |
| S2 | Sessions MUST persist across app restarts so users are not forced to re-authenticate constantly | MUST | ✅ | `persistSession: true`, `storage: AsyncStorage` (`lib/supabase.ts:624-628`) |
| S3 | Session tokens SHOULD be stored in OS-backed secure storage (iOS Keychain / Android Keystore), not plaintext `AsyncStorage` | SHOULD | ⚠️ | today tokens sit in `AsyncStorage`, which is not encrypted at rest; see O4 |
| S4 | Changing a password MUST invalidate other active sessions (global sign-out), so a compromised session cannot outlive a reset | MUST | ⚠️🔒 | `updatePassword` succeeds and the reset screen signs out the **local** session only (`reset-password.tsx:107-112`); global revocation depends on Supabase behavior — see O5 |
| S5 | Sign-out MUST clear the session locally and revoke the refresh token server-side | MUST | ✅ | `signOut` calls `supabase.auth.signOut()` (`services/auth.ts:193-196`) |
| S6 | Every access token MUST be validated server-side on each request; `auth.uid()` in RLS is the only trusted identity — the client never asserts who it is | MUST | ✅ | all RLS policies key off `auth.uid()` (`schema.sql`, `privacy.sql`) |
| S7 | A password-reset link MUST establish only a scoped, short-lived ability to set a new password, and MUST NOT be reusable after the password is changed | MUST | ✅🔒 | one-time code exchanged via `exchangePasswordResetCode` (`services/auth.ts:179-184`), reset screen signs out after use; code TTL is a Supabase setting — see O3 |
| S8 | All auth and API traffic MUST be over TLS | MUST | ✅ | Supabase endpoints are HTTPS-only |

## 4. Access control and data protection

Authorization is **entirely** RLS-based; there is no trusted middle tier. These
requirements protect whereabouts data from friends who shouldn't see it and from
strangers entirely.

| # | Requirement | Level | Status | Enforcement / notes |
| - | ----------- | ----- | ------ | ------------------- |
| C1 | Every user-data table MUST have RLS enabled with explicit per-operation policies; default-deny | MUST | ✅ | `ENABLE ROW LEVEL SECURITY` on all tables (`schema.sql:226-232`) |
| C2 | A user MUST only read/write their own calendar entries, groups, invites, and notification preferences | MUST | ✅ | owner = `auth.uid()` policies (`schema.sql`) |
| C3 | Calendar visibility MUST resolve per the documented model (appear-away → per-friend rule → most-permissive group rule → owner default) and `limited` viewers MUST see only `in_town` days | MUST | ✅ | `effective_calendar_visibility` + read policy (`privacy.sql:74-157`) |
| C4 | The visibility resolver runs `SECURITY DEFINER` and MUST return only a level, never row data, and MUST pin `search_path` | MUST | ✅ | `privacy.sql:136`, `172` (`SET search_path = public`) |
| C5 | Profile fields exposed to non-friends via search MUST be limited to what is needed to find and recognize a person; whereabouts are never exposed pre-friendship | MUST | ⚠️ | calendar stays private, but the search policy exposes the **whole** `users` row to any authenticated user — see §5.1 and O6 |
| C6 | Avatars are in a public bucket by definition; users MUST understand the avatar URL is world-readable, and only the owner may upload/replace/delete their own avatar | MUST | ✅ | public `avatars` bucket + owner-scoped write policies (`schema.sql:258-281`) |

## 5. Abuse-prevention and misuse considerations

### 5.1 Account / profile enumeration and scraping

User search is backed by this policy (`schema.sql:248-250`):

```sql
CREATE POLICY "Authenticated users can search profiles" ON public.users
  FOR SELECT USING (auth.role() = 'authenticated');
```

Any authenticated account can `SELECT` **every column of every user row** —
`email`, `name`, `location`, `interests`, `social_accounts`. This is the single
biggest abuse surface on the account layer.

| # | Requirement | Level | Status | Notes |
| - | ----------- | ----- | ------ | ----- |
| AB1 | Search MUST NOT let an authenticated user bulk-export the user directory or read PII (email, location, social handles) of people they aren't friends with | MUST | ⚠️ | current policy allows exactly this — see O6 |
| AB2 | Search SHOULD expose only a minimal projection (e.g. id, display name, avatar) to non-friends; full profile only after an accepted friendship | SHOULD | ❌ | needs a view / column-scoped policy — see O6 |
| AB3 | Search and other read-heavy endpoints SHOULD be rate-limited to make scraping expensive | SHOULD | ❓🔒 | no app-level limiter; depends on Supabase / gateway — see O7 |

### 5.2 Invite abuse and PII leakage

Two invite policies interact badly (`schema.sql:340-346`):

```sql
CREATE POLICY "Authenticated users can view active invites" ON public.invites
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > NOW())
  );
```

Accepting an invite by token is well-guarded — `accept_invite` (`schema.sql:424-474`)
blocks self-accept, non-pending, and expired invites and runs `SECURITY DEFINER`
with a pinned `search_path`. The **read** side is the problem.

| # | Requirement | Level | Status | Notes |
| - | ----------- | ----- | ------ | ----- |
| AB4 | An invite's `token`, `invitee_email`, and `invitee_phone` MUST NOT be readable by anyone other than the inviter and the accepting user | MUST | ❌ | the policy above lets **any** authenticated user enumerate all pending invites, including invitee email/phone and the raw token → invite hijacking + PII harvest — see O8 |
| AB5 | Invite tokens MUST have enough entropy to be unguessable | MUST | ✅ | 128-bit UUIDv4 hex (`schema.sql:76`) — entropy is fine; exposure (AB4) is the issue |
| AB6 | Invites SHOULD expire by default | SHOULD | ⚠️ | `expires_at` is nullable and the app passes `null` (`services/invites.ts:34`) → links live forever — see O9 |
| AB7 | Invite creation SHOULD be rate-limited / quota'd per user to prevent spam and mass PII entry | SHOULD | ❓🔒 | no limit today — see O7 |

### 5.3 Unsolicited friend requests / harassment

Friendships are self-serve inserts (`schema.sql:287-288`): a user may insert a
`pending` row targeting any `friend_id`. There is no block-list and no mutual
consent required to *send* a request.

| # | Requirement | Level | Status | Notes |
| - | ----------- | ----- | ------ | ----- |
| AB8 | A user MUST be able to block another user so blocked users cannot send requests, refollow, or resolve their profile | MUST | ❌ | no block concept exists — see O10 |
| AB9 | Whereabouts MUST remain invisible until a friendship is `accepted` (a pending request grants no visibility) | MUST | ✅ | calendar read policies require `status = 'accepted'` (`schema.sql:300-307`, `privacy.sql:142-157`) |
| AB10 | Friend-request volume SHOULD be rate-limited to curb spam | SHOULD | ❓🔒 | see O7 |

### 5.4 Credential attacks

| # | Requirement | Level | Status | Notes |
| - | ----------- | ----- | ------ | ----- |
| AB11 | Repeated failed sign-ins and password-reset requests MUST be rate-limited / throttled to resist brute force and credential stuffing | MUST | 🔒❓ | relies on Supabase Auth's built-in rate limits; the exact limits are not documented here — see O7 |
| AB12 | Auth abuse (spikes in failed logins, mass invite creation, enumeration patterns) SHOULD be observable | SHOULD | ❓ | no logging/alerting defined — see O11 |

### 5.5 Sensitive-data handling in the client

| # | Requirement | Level | Status | Notes |
| - | ----------- | ----- | ------ | ----- |
| AB13 | Credentials, tokens, and session objects MUST NOT be written to logs | MUST | ❌ | `login.tsx` logs the email and the full sign-in result — which contains the session/tokens — to the console (`login.tsx:45-47`); `services/auth.ts:162` logs the sign-in error object. Remove before release — see O12 |
| AB14 | Password inputs MUST use secure entry and disable autocorrect/autocapitalize | MUST | ✅ | `secureTextEntry`, `autoCapitalize="none"` on password fields (`login.tsx`, `signup.tsx`, `reset-password.tsx`) |

## 6. Compliance and policy constraints (known)

| # | Constraint | Status | Notes |
| - | ---------- | ------ | ----- |
| P1 | **Whereabouts = sensitive personal data.** The calendar reveals location over time; privacy defaults and minimization apply. | ✅ (by design) | privacy model defaults to owner control; `appear_away` gives a global kill switch (`privacy.sql:100-102`) |
| P2 | **Account deletion / right-to-erasure (GDPR Art. 17, CCPA).** Deleting an account MUST remove the user's data. | ⚠️ | DB-side cascades are in place (`ON DELETE CASCADE` on `users`, `schema.sql:9`, `43-44`, `53`), but there is **no user-facing delete-account flow** and no defined path to delete the `auth.users` row + storage avatars — see O13 |
| P3 | **Data export / access request.** Users MAY request a copy of their data. | ❓ | no export path defined — see O13 |
| P4 | **Apple App Store Guideline 4.8 / 5.1.1** — offer a privacy-respecting login option and, where social login exists on iOS, offer Sign in with Apple. | ✅ | satisfied (A7) |
| P5 | **Google OAuth verification / OAuth Consent Screen** — scopes and branding must be verified before public launch. | ❓🔒 | external console config — see O14 |
| P6 | **Children's data (COPPA / GDPR age of consent).** No age gate exists. | ❓ | if under-13 (US) / under-16 (EU) users are in scope, an age gate and parental-consent story are needed — see O15 |
| P7 | **Push/email notification consent.** Coordination notifications are off by default and channel-scoped. | ✅ | `coordination_enabled` defaults `FALSE`; channels constrained to `push`/`email` (`schema.sql:90-99`) |
| P8 | **Breach handling / disclosure timelines.** | ❓ | no documented incident-response owner or timeline — see O11 |

## 7. Open questions

These are unresolved and MUST be answered (or explicitly deferred with an owner)
before the Auth & Accounts work is considered security-complete.

- **O1 — Server-side password policy.** What minimum length/complexity does the
  Supabase project enforce, and is leaked-password protection enabled? The
  client's 6-char check (A3/A4) is cosmetic on its own.
- **O2 — Email confirmation gating.** Is "Confirm email" required before a
  password user can sign in? If not, an unverified/typo'd email owns an active
  account (A8).
- **O3 — Token and reset-link lifetimes.** What are the configured access-token
  JWT TTL, refresh-token lifetime/rotation, and password-reset code TTL?
  (S1, S7.)
- **O4 — Secure token storage.** Do we move session tokens from `AsyncStorage`
  to Keychain/Keystore (e.g. `expo-secure-store`)? Accept the risk on a rooted/
  jailbroken device, or mitigate? (S3.)
- **O5 — Global session revocation on password change.** Does our reset flow
  revoke *all* sessions, or only the current device? Confirm and, if needed,
  call the admin sign-out-everywhere path. (S4.)
- **O6 — Profile search exposure.** Replace the whole-row search policy with a
  minimal, non-friend-safe projection (id/name/avatar) — via a view or
  column-scoped access. What fields are the minimum needed for search? (C5, AB1,
  AB2.) **High priority.**
- **O7 — Rate limiting.** Where do we enforce rate limits for failed logins,
  password resets, search, invite creation, and friend requests — Supabase
  built-ins, an edge gateway, or app logic? Document the actual thresholds.
  (AB3, AB7, AB10, AB11.)
- **O8 — Invite read policy.** The "authenticated users can view active invites"
  policy leaks invitee email/phone and tokens to everyone. Should invite lookup
  move to a `SECURITY DEFINER` RPC that returns only non-sensitive fields for a
  *known* token, so the table is never broadly `SELECT`-able? (AB4.)
  **High priority.**
- **O9 — Default invite expiry.** Should invites expire by default (e.g. 14/30
  days) instead of `null`/never? (AB6.)
- **O10 — Blocking / harassment controls.** Do we need a block-list and reporting
  flow for v1 of Auth & Accounts, or is it a fast-follow? (AB8.)
- **O11 — Abuse observability & incident response.** What auth events are logged,
  what triggers an alert, and who owns breach disclosure? (AB12, P8.)
- **O12 — Remove sensitive console logging.** Strip credential/session logging
  from `login.tsx` and `auth.ts` and add a lint/CI guard. (AB13.)
- **O13 — Account deletion & data export.** Build a user-facing delete-account
  path (including `auth.users` + avatar storage) and a data-export path for
  erasure/portability requests. (P2, P3.)
- **O14 — Google OAuth app verification** status and the exact scopes requested.
  (P5.)
- **O15 — Minimum age / children's data.** Is there a minimum age, and do we need
  an age gate? (P6.)

## 8. Change checklist

When adding or changing an auth flow, session behavior, or an RLS policy on a
user-data table:

1. Confirm the guarantee is enforced **server-side** (§1) — a client check does
   not satisfy a MUST.
2. Re-check that the change does not widen a `SELECT` policy to expose PII to
   non-friends (§4, §5.1–5.2). New broad policies are the most common regression.
3. Keep `SECURITY DEFINER` functions returning the minimum necessary and pinning
   `search_path` (C4).
4. Ensure no credential, token, or session object reaches logs (AB13).
5. If the change touches password, session lifetime, or revocation, re-verify
   §2–§3 and update the affected open question.
6. Update the tables and status keys here so this document and the code/config
   still agree.
