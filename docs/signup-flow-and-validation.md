# Sign-Up Flow & Validation Requirements

**Issue:** PRA-12 · **Project:** Auth & Accounts · **Status:** Definition / discovery

This document captures the product and implementation requirements for **account
creation** (new users signing up). It is a **definition** deliverable — it
describes the required inputs and validation rules, the expected happy path, the
user-visible error states, and the edge cases that affect account creation as
they exist today (grounded in the current code). It flags the rough edges and
gaps and calls out open questions. It does **not** change behavior.

Companion docs (to avoid duplication, this doc references rather than repeats
them):
- [Account Creation Edge Cases & Recovery Flows](auth-account-edge-cases.md) (PRA-15) — the deep catalog of duplicate/conflicting accounts, partial failures, and support-required recoveries. **This doc owns the flow + validation; PRA-15 owns the edge-case/recovery catalog.**
- [Login Flow & Error States](login-flow-and-error-states.md) (PRA-13) — the returning-user counterpart.
- `AUTH_SECURITY_SPEC.md` (PRA-18) — non-functional security requirements (rate limiting, enumeration, session protection).
- `AUTH_METRICS_SPEC.md` (PRA-19) — sign-up instrumentation and success metrics.

## Scope

**In scope:** the sign-up screen (`app/(auth)/signup.tsx`) and the code path it
drives — the email + password + name form and its client-side validation, the
Google/Apple OAuth sign-up buttons, the "Check your email" verification state,
and where the user lands afterward.

**Out of scope (covered elsewhere):** the duplicate/conflicting-account catalog
and support recoveries (PRA-15), the password-reset flow (PRA-15 §3), OAuth
callback internals (`app/auth/callback.tsx`), the profile data model (PRA-16),
and post-signup first-run treatment such as the add-friends prompt (PRA-17).

## Current architecture

Sign-up runs on **Supabase Auth** through `services/auth.ts`, with three entry
points on the sign-up screen:

- **Email + password + name** — `authService.signUp` → `supabase.auth.signUp`, passing `options.data.name` and `emailRedirectTo` (`auth.ts:128-153`).
- **Google OAuth** — `signInWithGoogle` → `completeOAuthSignIn('google')` (all platforms).
- **Apple OAuth** — `signInWithApple` (iOS only; the button is gated to `Platform.OS === 'ios'`, `signup.tsx:207-216`).

Two behaviors are important to the flow:

1. **A profile row in `public.users` is created two ways** that must stay in
   sync: the `handle_new_user` trigger on `auth.users` insert
   (`database/schema.sql`), and the client-side `ensureUserProfile` upsert. On
   password sign-up the client-side upsert **only runs when a session is
   returned** (`auth.ts:142-150`); in verification-required mode (null session)
   the profile row depends solely on the DB trigger.
2. **Whether a session comes back immediately depends on the Supabase "Confirm
   email" setting.** With confirmation **off**, `signUp` returns a session and
   the user is routed straight into the app. With confirmation **on**, the
   session is null until the user taps the emailed link, and the screen parks on
   "Check your email" (`signup.tsx:69-72`). Which mode production runs in is the
   single load-bearing unknown — see O8 and [edge-cases D7](auth-account-edge-cases.md).

Routing after sign-up mirrors login: **web** uses `router.push('/(tabs)')`,
**native** uses `router.replace('/(tabs)')` (`signup.tsx:74-78`).

Legend for the tables:
**Handling** — 🟢 handled · 🟡 partial / rough edge · 🔴 gap · ⚪ depends on an open decision.

---

## 1. Required inputs & validation rules

### 1.1 Email + password path

| Input | Required | Validation today | Notes / gaps |
|-------|----------|-------------------|--------------|
| **Name** | Yes | Non-empty only (`signup.tsx:51`). Stored in `user_metadata.name` and copied to `public.users.name`. `autoCapitalize="words"` (`signup.tsx:154-160`). | **No length cap, no trim, no character validation.** A single space fails the non-empty check only if the field is truly empty — `"   "` is a non-empty string and passes. Whitespace-only / very long / emoji names are accepted. See O1. |
| **Email** | Yes | Non-empty only (`signup.tsx:51`). `keyboardType="email-address"`, `autoCapitalize="none"`, `autoComplete="email"` (`signup.tsx:162-170`). | **No format validation and no trim/lowercase** before submit — the raw string is passed to Supabase (`signup.tsx:63`). Malformed emails are rejected server-side (raw Supabase error); autofill whitespace can cause avoidable failures. Case/whitespace duplicate risk is tracked in [edge-cases 2.5](auth-account-edge-cases.md). See O2. |
| **Password** | Yes | Non-empty **and** `length >= 6` (`signup.tsx:56-59`). `secureTextEntry`, `autoCapitalize="none"`, `autoComplete="password"` (`signup.tsx:172-180`). | **6-char minimum is the only rule** — no max length, no strength meter, no breach (HIBP) check, no show/hide toggle. Policy decision tracked as [edge-cases D4](auth-account-edge-cases.md). See O3, O4. |

Validation order on submit (`handleSignUp`, `signup.tsx:50-59`):
1. `if (!name || !email || !password)` → alert **"Error — Please fill in all fields"**, return.
2. `if (password.length < 6)` → alert **"Error — Password must be at least 6 characters"**, return.
3. Otherwise proceed to `authService.signUp`.

These two checks are the **only** client-side validation; email format, password
strength beyond length, and uniqueness are all decided server-side by Supabase.

### 1.2 OAuth path (Google / Apple)

| Input | Required | Notes |
|-------|----------|-------|
| **None on our screen** | — | Name, email, and avatar are pulled from the provider's returned `user_metadata` (`getOAuthProfile`, `auth.ts:42-51`), **not** from the form. The form's name/email/password fields are ignored when a social button is tapped. Apple button renders on iOS only. |

---

## 2. Expected happy path behavior

### 2.1 Email + password — confirmation **disabled** (session returned)
1. User fills name, email, password; taps **"Sign Up"**.
2. Button shows its loading state and is disabled while `loading` is true (`signup.tsx:182-190`).
3. `signUp` returns a session; `ensureUserProfile` upserts the `public.users` row with the entered name (`auth.ts:142-150`).
4. `markAddFriendsPromptEligible(result, true)` marks the user eligible for the add-friends prompt (`signup.tsx:64`).
5. Navigation into the app: **web** `router.push('/(tabs)')`, **native** `router.replace('/(tabs)')` (`signup.tsx:74-78`).
6. The persisted Supabase session means subsequent cold starts route straight to `/(tabs)` via `app/index.tsx`.

### 2.2 Email + password — confirmation **enabled** (null session)
1–2. Same as above.
3. `signUp` returns **no session**; the client-side `ensureUserProfile` is skipped (profile row now depends on the DB trigger).
4. The screen sets `pendingVerificationEmail` and renders the **"Check your email"** state: title *"Check your email"*, the target address, copy *"Tap the link on this device to finish creating your account,"* and a **"Back to Sign In"** button (`signup.tsx:118-142`).
5. The user taps the emailed link → `auth/callback` exchanges it for a session → app.

> **Rough edge — eligibility is marked before the session is known.**
> `markAddFriendsPromptEligible(result, true)` runs with `force = true`
> **before** the null-session check (`signup.tsx:63-64`), so an unverified /
> abandoned sign-up is still flagged eligible for the add-friends prompt. Low
> impact (the prompt only fires post-login) but tracked in
> [edge-cases 1.7](auth-account-edge-cases.md).

### 2.3 OAuth (Google / Apple) happy path
1. User taps **"Continue with Google"** / **"Continue with Apple"**.
2. `completeOAuthSignIn` opens the provider auth session, exchanges the returned code for a session, and upserts the profile via `ensureUserProfile` (`auth.ts:81-125`).
3. `markAddFriendsPromptEligible(result)` runs (without force; keyed on the `isNewUser` heuristic, `auth.ts:53-64`).
4. Navigation into the app (same web/native split as §2.1).

### 2.4 Definition of "done"
Sign-up is complete when the user has an **active, persisted Supabase session
and a `public.users` profile row**, and is on `/(tabs)`. In confirmation-enabled
mode, "done" is deferred until the emailed link is tapped; the sign-up screen's
terminal state is "Check your email," not the app.

---

## 3. User-visible error states

All password-path failures surface through one channel: a blocking alert titled
**"Sign Up Failed"** with `error.message` (or the generic fallback *"An error
occurred"*), via `showAlert` — `window.alert` on web, `Alert.alert` on native
(`signup.tsx:79-80`). Client-side validation failures use the title **"Error"**.
There is **no inline field-level error rendering** and no toast; every failure
is a modal interruption.

| # | State | Trigger | What the user sees | Handling | Gap / recovery |
|---|-------|---------|--------------------|----------|----------------|
| 3.1 | **Missing field** | Empty name, email, or password | Alert: *"Error — Please fill in all fields"* (`signup.tsx:51-54`) | 🟢 | Fires before any network call. Doesn't catch whitespace-only values (O1). |
| 3.2 | **Weak password** | Password < 6 chars | Alert: *"Error — Password must be at least 6 characters"* (`signup.tsx:56-59`) | 🟢 | Clear, but 6 chars is the only bar (O3, [edge-cases D4](auth-account-edge-cases.md)). |
| 3.3 | **Invalid email format** | Server rejects a malformed address | Alert: *"Sign Up Failed — &lt;raw Supabase message&gt;"* | 🟡 | No client-side format check, so this is a round-trip failure with a provider-raw message. See O2. |
| 3.4 | **Email already registered** | Sign-up with an existing (confirmed) email | To avoid enumeration, Supabase returns a user with **no session** rather than an error, so the screen shows the **same "Check your email" state** (`signup.tsx:69-72`) | 🔴 | The returning user gets no signal they already have an account and waits for a mail that never comes. High-impact; decision tracked as [edge-cases 2.1 / D1](auth-account-edge-cases.md). |
| 3.5 | **Rate limited** | Repeated sign-up attempts trip Supabase's throttle (HTTP 429) | Alert with Supabase's raw rate-limit message | 🟡 | Surfaced but not styled as a distinct state; app-level limits undefined ([security](../AUTH_SECURITY_SPEC.md), O6). |
| 3.6 | **OAuth cancelled** | User dismisses the Google/Apple sheet | Alert: *"Sign Up Failed — &lt;provider&gt; sign-in was cancelled."* (`auth.ts:100-102`) | 🟡 | Cancel is a normal action, not a failure — reads as an error. Mirrors login 3.5 / [edge-cases 1.5](auth-account-edge-cases.md). See O5. |
| 3.7 | **OAuth provider error** | Provider returns `error`/`error_description`, or no code/URL | Alert with the provider-raw error string (`auth.ts:104-113`) | 🟡 | Surfaced; message may be cryptic, no retry guidance. |
| 3.8 | **Profile upsert fails after auth succeeds** | `ensureUserProfile` throws (network blip / RLS) after `signUp` created the `auth.users` record | The whole promise rejects → *"Sign Up Failed"*, **but the account already exists** | 🟡 | "Ghost" account: user told it failed but a record (and likely a trigger-created profile row) exists. Recovery = reset or support. Tracked in [edge-cases 1.2](auth-account-edge-cases.md). |
| 3.9 | **Network / offline** | Request fails to reach Supabase | Alert: *"Sign Up Failed"* + `error.message` (may be empty → *"An error occurred"*, `signup.tsx:80`) | 🟡 | No offline detection or "you appear to be offline" copy. |
| 3.10 | **Auth backend unavailable** | Non-dev build with missing Supabase env → client fails **closed** (`createUnavailableAuthClient`, ENG-100) | Every call rejects → *"Sign Up Failed"* | 🟡 | Fails safe (no silent mock in prod), but the message doesn't distinguish "misconfigured" from a real input error. |

---

## 4. Edge cases that affect account creation

These are the account-creation-specific edge cases surfaced by the sign-up flow.
The **full** catalog (duplicate accounts across providers, verification on a
different device, invite-driven signup, support-required recoveries) lives in
[PRA-15](auth-account-edge-cases.md); the rows below are the ones a reader of the
*flow* spec must know, cross-referenced there.

| # | Edge case | Current behavior | Handling | Reference |
|---|-----------|------------------|----------|-----------|
| 4.1 | **Whitespace-only name/email** | Passes the non-empty gate (a space is truthy); sent raw to Supabase | 🟡 | O1 |
| 4.2 | **Duplicate email indistinguishable from verification-pending** | Both show "Check your email" (§3.4) | 🔴 | [edge-cases 2.1 / D1](auth-account-edge-cases.md) |
| 4.3 | **Case / whitespace email variants** create distinct-looking signups | Raw email stored; `public.users.email` is `NOT NULL` but **not `UNIQUE`** | 🟡 | [edge-cases 2.5 / open Q3](auth-account-edge-cases.md) |
| 4.4 | **Same person via Google *and* Apple, same email** | Can produce two `public.users` rows (email not unique) | 🔴 | [edge-cases 2.4 / D2](auth-account-edge-cases.md) |
| 4.5 | **Verification link opened on a different device** | Device B gets a session; Device A stays frozen on "Check your email" (no polling), despite "on this device" copy | 🟡 | [edge-cases 1.4](auth-account-edge-cases.md) |
| 4.6 | **User never taps the verification link** | Screen parks on "Check your email"; **no resend button, no "change email"** — restarting looks like a duplicate | 🟡🔴 | [edge-cases 1.3 / 3.6](auth-account-edge-cases.md) |
| 4.7 | **App killed mid-OAuth** | `openAuthSessionAsync` resolves non-success → treated as cancel (3.6); deep-link re-entry untested | 🟡 | [edge-cases 1.8 / open Q4](auth-account-edge-cases.md) |
| 4.8 | **Duplicate / rapid taps on "Sign Up"** | `loading` disables the button during the request (`signup.tsx:186-188`) | 🟢 | [edge-cases 1.9](auth-account-edge-cases.md) |
| 4.9 | **Success navigation not reset on web** | Success path relies on navigation to unmount; web uses `push` not `replace`, so a back-nav can strand the screen. Note `handleSignUp` *does* reset `loading` in a `finally` (`signup.tsx:81-83`), unlike the login screen — so the button isn't left spinning, but the stale form persists in web history | 🟡 | Mirrors login O3 |

---

## 5. Open questions (explicit)

1. **O1 — Trim and validate name/email client-side.** Should we `trim()` (and
   reject whitespace-only) name and email, and lowercase the email, before
   submit? Prevents 4.1/4.3 and avoids avoidable server round-trips.
2. **O2 — Client-side email format check.** Add a format validation so 3.3 is
   caught inline instead of as a raw server error?
3. **O3 — Password policy.** Is the 6-char minimum sufficient, or do we add a
   strength meter, a max length, and/or a breach (HIBP) check? (= [edge-cases D4](auth-account-edge-cases.md).)
4. **O4 — Password show/hide toggle.** Add a reveal affordance on the sign-up
   password field to cut mistyped-password accounts?
5. **O5 — Cancel is not a failure.** Reclassify OAuth-cancel (3.6) so it
   dismisses silently instead of a "Sign Up Failed" alert.
6. **O6 — App-level rate limiting on sign-up.** Are Supabase defaults enough, or
   do we need explicit sign-up/abuse controls? (Ties to [security](../AUTH_SECURITY_SPEC.md) and [edge-cases open Q6](auth-account-edge-cases.md).)
7. **O7 — Distinguish "already registered" from "verification pending" (3.4).**
   The single highest-impact UX gap in sign-up, gated on the enumeration-vs-clarity
   decision ([edge-cases D1](auth-account-edge-cases.md)).
8. **O8 — Is "Confirm email" enabled in production?** Determines whether §2.1 or
   §2.2 is the real happy path and whether the client-side `ensureUserProfile`
   ever runs on sign-up. Inherited from [edge-cases D7](auth-account-edge-cases.md).
9. **O9 — Friendly, localized error copy.** Replace raw Supabase strings (3.3,
   3.5, 3.7) with mapped, actionable messaging — coordinating with the same
   effort on login ([login O6](login-flow-and-error-states.md)).

---

## 6. Acceptance criteria coverage

- **Required sign-up inputs are defined** — §1 (name, email, password; OAuth). ✅
- **Validation and error behavior are documented** — §1 (rules), §3 (10 user-visible states). ✅
- **Expected happy path behavior is defined** — §2 (both confirmation modes + OAuth, plus definition of "done"). ✅
- **Known edge cases are listed** — §4, cross-referenced to the PRA-15 catalog. ✅
- **Open questions are called out explicitly** — §5 (O1–O9). ✅

## 7. Suggested follow-ups (not in scope for PRA-12)

- Trim/lowercase + format-validate email and reject whitespace-only name (O1, O2).
- Resolve and enforce the **password policy** (O3) and add a **show/hide toggle** (O4).
- Fix the **"already registered" ambiguity** (O7) per the D1 decision — the
  highest-value sign-up fix.
- Reclassify **OAuth cancel** so it isn't an error alert (O5).
- Introduce the shared **friendly error-mapping layer** with login (O9).
- Pin down the **production "Confirm email" posture** (O8) so the happy path is unambiguous.
