# Login Flow & Error States

**Issue:** PRA-13 · **Project:** Auth & Accounts · **Status:** Definition / discovery

This document captures the product and implementation requirements for **user
login** (returning users signing in). It is a **definition** deliverable — it
describes the inputs, the successful path, the user-visible error states, and
the failure/retry scenarios as they exist today (grounded in the current code),
flags the rough edges and gaps, and calls out open questions. It does **not**
change behavior.

Companion docs:
- [Account Creation Edge Cases & Recovery Flows](auth-account-edge-cases.md) (PRA-15) — signup, duplicate accounts, password reset, and support recoveries.
- `AUTH_SECURITY_SPEC.md` (PRA-18) — non-functional security requirements (rate limiting, session protection, enumeration).
- `AUTH_METRICS_SPEC.md` (PRA-19) — instrumentation and success metrics.

## Scope

**In scope:** the login screen (`app/(auth)/login.tsx`) and the code path it
drives — email + password sign-in, Google/Apple OAuth sign-in, the "Forgot
password?" entry point, and where the user lands afterward.

**Out of scope (covered elsewhere):** account creation (PRA-15/PRA-17), the
password-reset flow itself (PRA-15 §3), OAuth callback internals
(`app/auth/callback.tsx`), and session/security non-functional requirements
(PRA-18).

## Current architecture

Login runs on **Supabase Auth** through `services/auth.ts`, with three entry
points on the login screen:

- **Email + password** — `authService.signIn` → `supabase.auth.signInWithPassword`
- **Google OAuth** — `signInWithGoogle` (all platforms)
- **Apple OAuth** — `signInWithApple` (iOS only; the button is gated to `Platform.OS === 'ios'`)

Session persistence is handled by the Supabase client: `persistSession: true`,
`autoRefreshToken: true`, `storage: AsyncStorage` (`lib/supabase.ts:623-627`).
Sessions survive app restarts and are refreshed automatically; there is no
"remember me" toggle because persistence is unconditional.

Routing after auth is handled two ways:
- The login screen navigates to `/(tabs)` itself on success.
- The app entry (`app/index.tsx`) reads `getSession()` on cold start and routes
  an already-signed-in user straight to `/(tabs)`, bypassing login entirely.

Legend for the tables:
**Handling** — 🟢 handled · 🟡 partial / rough edge · 🔴 gap · ⚪ depends on an open decision.

---

## 1. Required inputs

| Input | Required | Constraints today | Notes / gaps |
|-------|----------|-------------------|--------------|
| **Email** | Yes (password path) | Non-empty. `keyboardType="email-address"`, `autoCapitalize="none"`, `autoComplete="email"` (`login.tsx:199-208`). | **No format validation and no trim/lowercase** before submit — the raw string is passed to Supabase (`login.tsx:46`). A leading space or trailing newline from autofill can cause a spurious "Invalid login credentials". See §3.2 and O1. |
| **Password** | Yes (password path) | Non-empty. `secureTextEntry`, `autoCapitalize="none"`, `autoComplete="password"` (`login.tsx:210-219`). | **No show/hide toggle** — a mistyped, masked password is the most common self-inflicted failure and can't be visually verified. See O2. |
| **OAuth (Google / Apple)** | No inputs | Handled entirely by the provider's web/native auth session. | Apple button only renders on iOS. |

Client-side gate before submit: `if (!email || !password)` → alert **"Error —
Please fill in all fields"** (`login.tsx:38-41`). This is the **only**
client-side validation; everything else is decided by Supabase server-side.

---

## 2. Expected successful login behavior

### 2.1 Email + password (happy path)
1. User enters email + password, taps **"Sign in"**.
2. Button shows an `ActivityIndicator` and is disabled while `loading` is true (`login.tsx:236-246`).
3. `signInWithPassword` returns a session; `signIn` also guards that `data.user` exists, else throws `"Invalid login credentials"` (`auth.ts:165-167`).
4. Navigation to the main app:
   - **Web:** `router.push('/(tabs)')`
   - **Native:** `router.replace('/(tabs)')` (`login.tsx:50-54`)
5. The persisted session means subsequent cold starts route straight to `/(tabs)` via `app/index.tsx`.

> **Rough edge — loading is never reset on success.** `setLoading(false)` is
> only called in the `catch` block (`login.tsx:58`). On success the screen
> relies on navigation to unmount it. On **web**, success uses `router.push`
> (not `replace`), so the login screen stays mounted in history with its button
> permanently disabled; a browser back-navigation lands on a dead, spinning
> form. See §4.4 and O3.

### 2.2 OAuth (Google / Apple, happy path)
1. User taps **"Continue with Google"** / **"Continue with Apple"**.
2. `completeOAuthSignIn` opens the provider auth session, exchanges the returned code for a session, and upserts the profile row via `ensureUserProfile` (`auth.ts:81-125`).
3. On success the screen navigates to `/(tabs)` (same web/native split as §2.1).

> Note: `completeOAuthSignIn` returns an `isNewUser` flag (`auth.ts:121-124`),
> but the **login screen ignores it** — it does not branch new vs. returning
> users or trigger the add-friends prompt. Any first-run treatment for
> OAuth-created accounts is out of scope here (see PRA-17).

### 2.3 Post-login definition of "done"
Login is considered complete when the user is on `/(tabs)` **with an active,
persisted Supabase session**. There is no email-verification gate *on the login
screen itself*: whether an unconfirmed user can sign in at all is decided
server-side by the Supabase "Confirm email" setting (see §3, row 3.3, and
[edge-cases D7](auth-account-edge-cases.md)).

---

## 3. User-visible error states

All password-path errors surface through the same channel: a blocking alert
titled **"Login Failed"** with `error.message` (or a generic fallback), via
`showAlert` — `window.alert` on web, `Alert.alert` on native (`login.tsx:21-27,
55-59`). There is **no inline field-level error rendering** and no error toast;
every failure is a modal interruption.

| # | State | Trigger | What the user sees | Handling | Gap / recovery |
|---|-------|---------|--------------------|----------|----------------|
| 3.1 | **Missing field** | Empty email or password | Alert: *"Error — Please fill in all fields"* | 🟢 | Clear. Fires before any network call. |
| 3.2 | **Invalid credentials** | Wrong password, or no such user, or (deliberately) either | Alert: *"Login Failed — Invalid login credentials"* (Supabase's generic, non-enumerating message; `auth.ts:165-167`, satisfies [security A10](../AUTH_SECURITY_SPEC.md)) | 🟢 | Correct for security, but gives the user no actionable hint (typo? wrong account? need to reset?). The message is provider-raw, not localized. |
| 3.3 | **Email not confirmed** | Login attempted before verifying, when "Confirm email" is enabled server-side | Alert with Supabase's raw *"Email not confirmed"* message | 🟡 | **No resend-verification affordance and no explicit "check your email" state on login** (resend is unimplemented app-wide — see [edge-cases 3.6](auth-account-edge-cases.md)). Depends on D7. |
| 3.4 | **Rate limited / too many attempts** | Repeated failed sign-ins trip Supabase's built-in throttle (HTTP 429) | Alert with Supabase's raw rate-limit message (e.g. *"Request rate limit reached"*) | 🟡 | Surfaced but **not styled as a distinct state** — no countdown, no "try again in N minutes". App-level limits are not defined; relies on Supabase defaults ([security AB11](../AUTH_SECURITY_SPEC.md), O7). |
| 3.5 | **OAuth cancelled** | User dismisses the Google/Apple sheet | Alert: *"Login Failed — &lt;provider&gt; sign-in was cancelled."* (`auth.ts:100-102`) | 🟡 | Cancel is a **normal user action, not a failure** — surfacing it as "Login Failed" is cosmetically wrong. Mirrors the signup cosmetic issue ([edge-cases 1.5](auth-account-edge-cases.md)). |
| 3.6 | **OAuth provider error** | Provider returns `error`/`error_description`, or no code/URL | Alert with the provider-raw error string (`auth.ts:104-113`) | 🟡 | Surfaced but message may be cryptic; no retry guidance. |
| 3.7 | **Network / offline** | Request fails to reach Supabase | Alert: *"Login Failed"* + whatever `error.message` the fetch layer produced (may be empty → generic *"An error occurred"* fallback, `login.tsx:57`) | 🟡 | No offline detection, no "you appear to be offline" copy, no automatic retry. |
| 3.8 | **Auth backend unavailable** | Non-dev build with missing Supabase env → client fails **closed** (`createUnavailableAuthClient`, see ENG-100) | Every call rejects → *"Login Failed"* alert | 🟡 | Fails safe (no silent mock in prod) but the user-facing message doesn't distinguish "app misconfigured" from "wrong password". |

---

## 4. Failure and retry scenarios

| # | Scenario | Current behavior | Handling | Gap / recovery |
|---|----------|------------------|----------|----------------|
| 4.1 | **Retry after a failed attempt** | On any password-path error, `setLoading(false)` re-enables the form with the entered values preserved (state isn't cleared). User can edit and resubmit immediately. | 🟢 | Works. No attempt counter or client-side backoff — repeated tries eventually hit the server-side rate limit (3.4). |
| 4.2 | **Duplicate / rapid taps on "Sign in"** | `loading` disables the button during the request (`login.tsx:236-238`). | 🟢 | Guarded against double-submit. |
| 4.3 | **Forgot-password recovery from a failed login** | "Forgot password?" routes to `/(auth)/forgot-password`, **pre-filling the email** the user already typed (`login.tsx:221-233`). | 🟢 | Good handoff. The reset flow itself is defined in [edge-cases §3](auth-account-edge-cases.md). |
| 4.4 | **Success navigation fails or is reversed (web)** | Success path never resets `loading` and uses `router.push` (§2.1). If navigation is interrupted or the user hits browser back, the login screen is left mounted with a disabled, spinning button. | 🟡 | **Stuck state** — the only recovery is a full page reload. Should reset `loading` in a `finally`, or use `replace` on web too. See O3. |
| 4.5 | **Login while already signed in** | Reaching `/(auth)/login` with a live session is possible via direct nav/back-button; the screen does **not** check for an existing session and will just attempt a fresh sign-in. Cold start is handled correctly by `app/index.tsx`. | 🟡 | Redundant re-auth rather than a redirect to `/(tabs)`. Low impact but untidy. See O4. |
| 4.6 | **Session expires mid-use, user returns to login** | `autoRefreshToken` should keep the session alive; if refresh fails, the user is dropped to login and re-authenticates normally. | ⚪ | The **expiry → re-login → return to prior screen** path isn't defined here (login always lands on `/(tabs)`, not the screen the user left). See O5. |
| 4.7 | **OAuth-only user tries the password path** | An account created via Google/Apple with no password returns *"Invalid login credentials"* on the password path. | 🟡 | Correct server-side, but the user has no signal that they should use the social button instead. Interacts with account-linking ([edge-cases D2](auth-account-edge-cases.md)). |
| 4.8 | **App backgrounded / killed mid-OAuth** | `WebBrowser.openAuthSessionAsync` resolves non-success → treated as cancelled (3.5). | 🟡 | Same UX as a deliberate cancel; deep-link re-entry after a kill is untested ([edge-cases open Q4](auth-account-edge-cases.md)). |

---

## 5. Open questions (explicit)

1. **O1 — Email normalization on the login screen.** Should the client
   trim/lowercase the email before `signInWithPassword` to avoid autofill
   whitespace producing false "Invalid login credentials"? (Server normalizes
   case, but leading/trailing whitespace still breaks the match.)
2. **O2 — Password show/hide toggle.** Add a reveal affordance to cut
   mistyped-password failures? (Standard on most login forms.)
3. **O3 — `loading` reset + web navigation.** Reset `loading` in a `finally`
   and/or use `router.replace` on web so a reversed/failed success navigation
   can't strand the form (§2.1, §4.4).
4. **O4 — Guard against logging in while already authenticated.** Should
   `/(auth)/login` redirect to `/(tabs)` when a session already exists (§4.5)?
5. **O5 — Return destination after re-auth.** On session expiry, should login
   return the user to the screen they were on, or is "always land on `/(tabs)`"
   acceptable (§4.6)?
6. **O6 — Distinct, actionable error copy.** Do we want to keep raw Supabase
   strings, or map them to friendly, localized, per-state messaging — while
   preserving the non-enumerating behavior of 3.2? Specifically: a real
   "check your email to confirm" state for 3.3 and a rate-limit state with
   guidance for 3.4.
7. **O7 — Cancel is not a failure.** Reclassify OAuth-cancel (3.5) so it dismisses
   silently instead of showing a "Login Failed" alert.
8. **O8 — Is "Confirm email" enabled in production?** The single load-bearing
   unknown for 3.3 — inherited from [edge-cases D7](auth-account-edge-cases.md).
9. **O9 — App-level rate limiting / lockout.** Are Supabase's default auth
   limits sufficient, or do we need an explicit failed-login lockout + UX?
   (Ties to [security AB11 / O7](../AUTH_SECURITY_SPEC.md).)

---

## 6. Acceptance criteria coverage

- **Login inputs and flow are defined** — §1 (inputs) and §2 (successful behavior, all three entry points). ✅
- **Error states and recovery paths are documented** — §3 (8 user-visible states) and §4 (8 failure/retry scenarios). ✅
- **Expected post-login behavior is clear** — §2.3 (definition of "done") plus the routing description in *Current architecture*. ✅
- **Open questions are called out explicitly** — §5 (O1–O9). ✅

## 7. Suggested follow-ups (not in scope for PRA-13)

- Fix the **web `loading`/navigation stranding** (O3) — smallest, highest-value bug.
- Add **email trim/lowercase** on submit (O1) and a **password reveal** (O2).
- Reclassify **OAuth cancel** so it isn't an error alert (O7).
- Introduce a **friendly error-mapping layer** for auth (O6), including a login
  "confirm your email" state and a rate-limit state — coordinate with the
  verification-resend work tracked in [edge-cases §8](auth-account-edge-cases.md).
- Decide the **already-authenticated redirect** (O4) and **return-destination**
  (O5) behaviors.
