# Account Creation Edge Cases & Recovery Flows

**Issue:** PRA-15 · **Project:** Auth & Accounts · **Status:** Definition / discovery

This document catalogs the edge cases and recovery flows around account
creation and access for InTown. It is a **definition** deliverable — it maps
what happens today (grounded in the current code), where the gaps are, which
recoveries need human/support involvement, and which decisions are still open.
It does **not** change behavior.

## Scope & current architecture

Auth runs on **Supabase Auth** (`lib/supabase.ts`) with three credential paths,
all funneled through `services/auth.ts`:

- **Email + password** — `signUp` / `signInWithPassword`
- **OAuth** — Google (all platforms) and Apple (iOS only) via
  `completeOAuthSignIn`
- **Password reset** — `resetPasswordForEmail` → deep link → `updateUser`

A profile row in `public.users` is created two ways that must stay in sync: the
`handle_new_user` trigger on `auth.users` insert (`database/schema.sql`), and a
client-side `ensureUserProfile` upsert (`services/auth.ts`). Both upsert on
`id`, so they are idempotent against each other.

Relevant guardrails already in place:
- The mock Supabase client is gated to `__DEV__`; non-dev builds without env
  fail **closed** (`createUnavailableAuthClient`) — see ENG-100.
- Email verification is wired: `signUp` passes `emailRedirectTo`, and the
  signup screen shows a "Check your email" state when Supabase returns a null
  session (`app/(auth)/signup.tsx`).

Legend for the tables below:
**Handling** — 🟢 handled · 🟡 partial / rough edge · 🔴 gap · ⚪ depends on an open decision.

---

## 1. Partial or failed sign-up scenarios

| # | Scenario | Current behavior | Handling | Gap / recovery |
|---|----------|------------------|----------|----------------|
| 1.1 | User submits with an empty field or a password < 6 chars | Blocked client-side with an alert (`signup.tsx:51-59`). | 🟢 | None. Note: 6 chars is the **only** password rule — no strength, no breach check. See §5. |
| 1.2 | `signUp` succeeds at the auth layer but `ensureUserProfile` throws (network blip, RLS) | The whole `signUp` promise rejects → user sees "Sign Up Failed" (`signup.tsx:79`), **but the `auth.users` record already exists**, and `handle_new_user` has likely already created the profile row. | 🟡 | The user is now in a "ghost" state: an account exists but they were told it failed. Retrying signup with the same email hits the duplicate path (§2). Recovery today = password reset or contact support. |
| 1.3 | Verification required, user never taps the link | Screen parks on "Check your email" (`signup.tsx:118-142`). No session is created. | 🟡 | **No resend button and no "change email" option.** The only path forward is to restart signup, which then looks like a duplicate (§2.2). Likely a support ticket. |
| 1.4 | Verification link opened on a **different device** than signup | The link hits `auth/callback` on device B, creates a session there, and routes into the app. Device A stays frozen on "Check your email" with no polling/refresh. | 🟡 | Copy says "Tap the link **on this device**" (`signup.tsx:130`), but nothing enforces it. Device A is stranded until manually restarted. |
| 1.5 | OAuth flow cancelled or dismissed by the user | `completeOAuthSignIn` throws `"<provider> sign-in was cancelled."` → surfaced as a generic **"Sign Up Failed"** alert (`signup.tsx:96-99`). | 🟡 | Cancel is a normal user action, not a failure. Cosmetic, but reads as an error. |
| 1.6 | OAuth returns with `error` / `error_description` in the callback params | Thrown and surfaced (`auth.ts:104-108`, `callback.tsx:34-39`). | 🟢 | Message is provider-raw; may be cryptic. |
| 1.7 | `markAddFriendsPromptEligible` runs before the verification check | On signup it is called with `force = true` **before** we know whether a session exists (`signup.tsx:63-64`). So an unverified / abandoned signup can still be marked eligible for the "add friends" prompt. | 🟡 | Low impact (prompt only fires post-login) but the eligibility flag is set for accounts that may never complete. |
| 1.8 | App backgrounded / killed mid-OAuth (web browser session) | `WebBrowser.openAuthSessionAsync` resolves as non-success → treated as cancelled. | 🟡 | Same UX as 1.5. Deep-link re-entry after a kill is untested — see open questions. |
| 1.9 | Duplicate/rapid taps on "Sign Up" | `loading` disables the button (`signup.tsx:186-188`). | 🟢 | Guarded. |

---

## 2. Duplicate or conflicting account scenarios

This is the highest-risk category and where the most product decisions are
unresolved.

| # | Scenario | Current behavior | Handling | Gap / recovery |
|---|----------|------------------|----------|----------------|
| 2.1 | Sign up with an email that already exists (password account) | Supabase, to avoid **user enumeration**, returns a user object with an empty identities array and **no session** rather than an error. Our code can't distinguish this from a fresh verification-required signup, so it shows the **same "Check your email"** state (`signup.tsx:69-72`). | 🔴 | A returning user gets no signal that they already have an account. They wait for an email that (for an already-confirmed account) never comes. Needs a decision on enumeration vs. clarity (§5). |
| 2.2 | Re-attempt signup after a partial failure (1.2 / 1.3) | Same as 2.1 — indistinguishable from a duplicate. | 🔴 | Compounds 1.2/1.3. |
| 2.3 | Email/password user later taps "Continue with Google" (same email) | Depends on the Supabase project's identity-linking setting. Either identities are auto-linked, or a "User already registered" error surfaces as "Sign Up Failed". Behavior is **not pinned in our code or config**. | ⚪ | Needs an explicit account-linking decision (§5). Until then behavior is environment-dependent. |
| 2.4 | Same person signs up with Google **and** Apple, both returning the same email | If Supabase issues two distinct `auth.users` ids, `public.users.email` is **`NOT NULL` but not `UNIQUE`** (`schema.sql:8-18`), so two profile rows with the same email can coexist. | 🔴 | Two separate friend graphs / calendars for one human. No dedup or merge path. Support-only cleanup. |
| 2.5 | Email case / whitespace variants (`Max@x.com` vs `max@x.com`) | Signup passes the raw email (no trim/lowercase — `signup.tsx:63`). Supabase normalizes case server-side, and `idx_users_email_lower` exists (`schema.sql:203`), but our writes store `NEW.email` verbatim. | 🟡 | Supabase likely prevents case-variant duplicates at the auth layer, but this is **assumed, not verified**. Worth a test. |
| 2.6 | Invite-driven signup: invitee already has an account | `accept_invite` just creates the reciprocal friendship; it doesn't create an account. Fine. | 🟢 | See §3 for the signed-out-invitee friction. |
| 2.7 | Password reset used on an **OAuth-only** account | `resetPasswordForEmail` succeeds silently; `updateUser({ password })` would **set a password** on an account that previously had none — effectively converting an OAuth-only account into a password account. | ⚪ | Is that desired (a feature) or surprising (a footgun)? Needs a decision (§5). |

---

## 3. Recovery flows (password reset & account recovery)

| # | Flow | Current behavior | Handling | Gap / recovery |
|---|------|------------------|----------|----------------|
| 3.1 | Password reset — happy path | `forgot-password` → email → `auth/reset-password` exchanges the `code`, user sets a new password, then is **signed out locally** and sent to login (`reset-password.tsx:107-114`). | 🟢 | Works. |
| 3.2 | Reset requested for a non-existent email | Always shows "If an account exists…" (`forgot-password.tsx:70-77`). Non-enumerating by design; the mock mirrors this (`supabase.ts:112-115`). | 🟢 | Intentional. Side effect: a user who mistyped their email waits for a mail that never arrives, with no way to tell. |
| 3.3 | Reset link expired or already used | `exchangePasswordResetCode` throws → alert → routed back to `forgot-password` (`reset-password.tsx:72-74`). | 🟢 | Clear enough. |
| 3.4 | Reset route opened with **no code but an active session** | `reset-password` allows the password change using the existing session (`reset-password.tsx:57-67`). | 🟡 | Means anyone with an unlocked device + active session can change the password without the emailed code. Probably acceptable (device is already trusted) but worth an explicit call. |
| 3.5 | Password changed — other sessions | `signOut` after reset is **local only**; Supabase refresh tokens on other devices are **not globally revoked**. | 🔴 | After a "reset my password because I think I'm compromised," the attacker's other session survives. Needs global sign-out / token revocation. Security-sensitive (§5). |
| 3.6 | Verification email resend | **Not implemented** anywhere. | 🔴 | Blocks recovery for 1.3/1.4. Prime support-ticket generator. |
| 3.7 | Account recovery when email inbox is lost | No flow. Email is the only recovery factor (no phone, no backup code). | 🔴 | **Support-required**, and even support has no defined runbook. See §4. |
| 3.8 | Account deletion / reactivation | No self-serve deletion. `public.users` is `ON DELETE CASCADE` from `auth.users`, so a deletion is irreversible and takes the calendar, friendships, and invites with it. | 🔴 | **Support-required.** No "soft delete" or grace period. See §4 & §5. |
| 3.9 | Change email address | No flow in-app. | 🔴 | Support-required; interacts with the duplicate-email risks in §2. |

---

## 4. Recovery flows that require support (human in the loop)

These cannot be resolved by the user alone with today's code. Each needs, at
minimum, a documented internal runbook; several need product decisions before a
runbook can even exist.

1. **Lost access to signup email before verifying** (1.3 / 1.4, 3.6) — no
   resend, no self-serve. Support must resend or manually confirm.
2. **Duplicate accounts for one person** (2.4, 2.3) — no merge tooling.
   Requires manual identification and consolidation of friend graph +
   calendar, or deleting one side.
3. **Password change didn't revoke a compromised session** (3.5) — support
   must force a global token revocation.
4. **Lost email inbox / account recovery** (3.7) — no defined identity-proofing
   process. **This runbook does not exist yet.**
5. **Account deletion or data export requests** (3.8, e.g. GDPR/CCPA) — manual,
   irreversible, no tooling.
6. **"Ghost" accounts from partial signup** (1.2) — support must detect and
   either finish provisioning or delete.

> **Action:** none of these have an internal support runbook today. Creating
> those runbooks is out of scope for PRA-15 but is a direct dependency for
> launch and should be tracked as follow-up issues.

---

## 5. Dependencies on unresolved product decisions

The following edge cases **cannot be finalized** until a product decision is
made. Each blocks specific rows above.

| Decision needed | Blocks | Options / notes |
|-----------------|--------|-----------------|
| **D1. Enumeration vs. clarity on duplicate signup** | 2.1, 2.2 | Keep the privacy-preserving silent behavior (accept some confusion), or detect existing-account and nudge to sign in / reset (leaks existence). Security + UX tradeoff. |
| **D2. Account linking policy across providers** | 2.3, 2.4 | Auto-link identities by verified email? Require the same provider? Offer an explicit "link account" flow? Determines Supabase config (`link identities`) and whether `public.users.email` should be `UNIQUE` / case-folded. |
| **D3. Can OAuth-only accounts gain a password via reset?** | 2.7 | Allow (treat as "add a password") or block resets for passwordless accounts. |
| **D4. Password policy** | 1.1 | Is 6-char minimum sufficient? Add strength meter / breach (HIBP) check / max length? |
| **D5. Session revocation on password reset** | 3.5 | Global sign-out on reset (safer) vs. local-only (current). Security default should probably be global. |
| **D6. Account deletion & retention model** | 3.8, 3.9 | Hard delete vs. soft delete + grace period; self-serve vs. support-only; data export obligations. |
| **D7. Email verification enforcement** | 1.3, 1.7, 2.1 | Is "Confirm email" actually **on** in the production Supabase project? The signup code handles both modes; the intended launch posture is unconfirmed. Everything about verification edge cases hinges on this. |
| **D8. Recovery factors** | 3.7 | Email-only, or add phone/backup codes? Determines whether §4.4 is even solvable self-serve. |

---

## 6. Open questions (explicit)

1. **Is email confirmation enabled in the production Supabase project?** (D7)
   The single most load-bearing unknown — most of §1 and §2 branch on it.
2. **Does the production project auto-link identities by verified email, or
   create separate users?** (D2) Determines whether 2.3/2.4 are real today.
3. **Should `public.users.email` be `UNIQUE` and normalized (lowercased)?**
   Currently it is neither (`schema.sql:8-18`); `idx_users_email_lower` hints at
   case-insensitive intent that isn't enforced on writes.
4. **What is the deep-link re-entry behavior after an app kill mid-OAuth /
   mid-verification?** (1.4, 1.8) Untested; needs a device pass.
5. **Should the invite token survive the sign-up round-trip?** A signed-out
   invitee is told to "create an account, then **reopen this link**"
   (`app/invite/[token].tsx:31-32`) — the token is **not** carried through
   signup, so a new user must find the original link again. Is that acceptable
   friction, or should signup accept and auto-apply a pending invite?
6. **Do we need rate limiting / abuse controls on signup and password-reset
   requests** beyond Supabase defaults? (Not visible in-app.)
7. **What is the identity-proofing bar for support-assisted recovery** (§4.4)?
   Without it, account takeover via support social-engineering is the weakest
   link.

---

## 7. Acceptance criteria coverage

- **Major edge cases are documented** — §1 (partial/failed), §2
  (duplicate/conflicting), §3 (verification & recovery). ✅
- **Recovery flows that require support are identified** — §4 (6 flows). ✅
- **Dependencies on unresolved product decisions are listed** — §5 (D1–D8). ✅
- **Open questions are called out explicitly** — §6 (7 questions). ✅

## 8. Suggested follow-ups (not in scope for PRA-15)

- Resolve D1–D8; each likely spawns an implementation issue.
- Implement **verification email resend** (unblocks the most common support
  ticket — 3.6).
- Distinguish "already registered" from "verification pending" at signup, per
  the D1 decision (2.1).
- Add **global session revocation** on password reset (3.5 / D5).
- Author internal **support runbooks** for the §4 flows.
- Decide and enforce the **email uniqueness/normalization** model (open Q3).
