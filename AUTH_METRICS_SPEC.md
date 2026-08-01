# Auth & Accounts — Instrumentation & Success Metrics

Reference spec for how success in the auth and account flows is measured. Defines
the events and funnel points to instrument, the success measures mapped to each
flow (account creation, login, session reliability, profile completion), and the
targets that are still open questions.

- **Issue:** PRA-19 — Specify instrumentation and success metrics
- **Project:** Auth & Accounts (sign up, log in, session handling, basic profile)
- **Relevant code:** `services/auth.ts` (`authService.*`), the auth screens under
  `app/(auth)/` (`login.tsx`, `signup.tsx`, `forgot-password.tsx`) and
  `app/auth/` (`callback.tsx`, `reset-password.tsx`), session wiring in
  `lib/supabase.ts` (`onAuthStateChange`), and the profile surface in
  `app/(tabs)/profile.tsx`. This document is the source of truth for *what to
  measure and how each measure is defined*; the code is the source of truth for
  *where the flows actually branch*, and the two must agree.
- **Traceability:** PRD → *Goals*, *Success measures*, *Key requirements*,
  *Non-functional requirements*, *Open questions*. Resolves the PRD open question
  *"What concrete targets should be used for success metrics?"* to the extent it
  can be resolved now: the measures and their definitions are settled here; the
  numeric targets remain open and are listed explicitly in §6.

## 1. How to read this

The PRD names four outcomes to measure — account-creation completion, login
success, session reliability, and profile completion — but frames them as prose
and states that *"Specific targets are still to be defined."* This spec turns
each into a concrete, implementation-ready measure: the exact events it is
computed from, the numerator and denominator, and where the corresponding branch
lives in code. Sections §3–§4 are the settled parts. Section §6 is the
deliberately-unsettled part: every measure whose *target number* is not yet
agreed is listed there as an open question rather than given a made-up value.

Two definitional choices thread through the whole document:

- **A measure is only as trustworthy as its denominator.** For each rate we say
  what population it is over (attempts, eligible users, active sessions) so the
  number can't drift as instrumentation is added.
- **User error and system failure are separated.** A rider mistyping a password
  is a *successful* system doing its job; the auth service erroring is not. Where
  a flow can fail both ways (login, OAuth), the events carry enough detail to
  split the two, and the reliability measures count only system failure.

## 2. Instrumentation foundation

### 2.1 Current state — the gap

There is **no analytics or telemetry layer in the app today.** `package.json`
declares no analytics/event SDK, and no `track()`/`logEvent()` call sites exist
in `app/`, `components/`, `services/`, or `lib/`. Every event below therefore
describes an emission point that must be *added*; none can be read from existing
instrumentation. Choosing the analytics sink (see §6, open question O1) is a
prerequisite for any of these measures, and is the first gap this spec surfaces.

### 2.2 Conventions (proposed, pending O1)

So the events stay consistent once a sink is chosen:

- **Naming:** `snake_case`, `object_action` (`signup_submitted`,
  `session_lost`). Funnel steps for one flow share a prefix (`signup_*`,
  `login_*`, `session_*`, `profile_*`).
- **Common properties on every event:** `method` (`password` | `google` |
  `apple` where applicable), `platform` (`ios` | `android` | `web` — the code
  already branches on `Platform.OS`), app version, and a stable anonymous
  install id so pre-account funnel steps (e.g. `signup_screen_viewed`) can be
  stitched to the eventual user.
- **Identity:** associate events with the Supabase user id
  (`sessionData.user.id`) once available; before that, the anonymous install id
  carries the funnel. New-vs-returning is derivable from `isLikelyNewAuthUser`
  (`services/auth.ts`), which the OAuth path already computes as `isNewUser`.
- **No secrets in properties:** never attach passwords, tokens, OAuth codes, or
  reset codes (PRD → *Non-functional requirements → Security*).

## 3. Events & funnel points to instrument

Grouped by flow. "Source" points at the branch the event fires from. Error
events should carry a coarse `reason`/`error_type` (e.g. `invalid_credentials`,
`email_in_use`, `network`, `oauth_cancelled`) — never the raw message.

### 3.1 Account creation (sign up)

The funnel has a fork: password sign up can pause for email verification
(`result.session` is null → "Check your email"), whereas OAuth returns a session
inline. Both must land at the same terminal `account_created` step so the
completion rate spans methods.

| Event | Fires when | Source |
| ----- | ---------- | ------ |
| `signup_screen_viewed` | Sign-up screen mounts | `app/(auth)/signup.tsx` |
| `signup_submitted` | Password sign-up submitted (post client-validation) | `handleSignUp` → `authService.signUp` |
| `signup_validation_failed` | Client blocks submit (missing field, password < 6) | `handleSignUp` guards |
| `signup_failed` | `authService.signUp` throws (e.g. email in use) | `services/auth.ts:signUp` |
| `signup_verification_pending` | Sign-up succeeded but `session` is null | `handleSignUp` → `setPendingVerificationEmail` |
| `signup_verification_completed` | Verification link handled, session established | `app/auth/callback.tsx` |
| `oauth_started` | Google/Apple sign-up begins | `completeOAuthSignIn` (`services/auth.ts:81`) |
| `oauth_cancelled` | Auth session returns non-`success` | `completeOAuthSignIn` |
| `oauth_failed` | OAuth returns error / no code / exchange error | `completeOAuthSignIn` |
| `account_created` | New user reaches a valid session (any method); tag `method`, `is_new_user` | `signUp` w/ session, `completeOAuthSignIn` (`isNewUser`) |
| `profile_ensured` | `ensureUserProfile` upsert succeeds | `services/auth.ts:ensureUserProfile` |

### 3.2 Log in

| Event | Fires when | Source |
| ----- | ---------- | ------ |
| `login_screen_viewed` | Login screen mounts | `app/(auth)/login.tsx` |
| `login_submitted` | Password login submitted | `authService.signIn` |
| `login_validation_failed` | Client blocks submit (empty fields) | `login.tsx` guards |
| `login_failed` | `signIn` throws / returns no user; tag `reason` (`invalid_credentials` vs `network`/`server`) | `services/auth.ts:signIn` |
| `login_succeeded` | Session returned; tag `method` | `signIn`, `completeOAuthSignIn` |
| `password_reset_requested` | Reset email requested | `authService.requestPasswordReset` |
| `password_reset_completed` | Code exchanged + `updatePassword` succeeds | `exchangePasswordResetCode` → `updatePassword` |

### 3.3 Session handling

Session reliability is the measure with the least existing signal, so its events
matter most. `lib/supabase.ts` exposes `onAuthStateChange`; the app should
distinguish a session that ended **because the user asked** (`signOut`) from one
that ended **unexpectedly** (refresh failure / server-side invalidation).

| Event | Fires when | Source |
| ----- | ---------- | ------ |
| `session_restored` | Persisted session loads on cold start | `getSession` on app open |
| `session_refreshed` | Token refresh succeeds (`TOKEN_REFRESHED`) | `onAuthStateChange` (`lib/supabase.ts:248`) |
| `session_refresh_failed` | Refresh fails while user was active | refresh path |
| `session_lost` | Session becomes invalid with **no** explicit `signOut` first | `onAuthStateChange` `SIGNED_OUT` not preceded by user action |
| `signout` | User signs out deliberately; excluded from "unexpected loss" | `authService.signOut` |

### 3.4 Basic profile

The three basic-profile fields per the PRD map to `User.name`,
`User.avatar_url` (photo), and `User.location` (home location / home base) in
`lib/types.ts`. Which of these are *required* for "complete" is an open question
(§6, O2); the events are field-agnostic so the definition can be set without
re-instrumenting.

| Event | Fires when | Source |
| ----- | ---------- | ------ |
| `profile_viewed` | Profile tab opens | `app/(tabs)/profile.tsx` |
| `profile_saved` | Name / home-location save succeeds; tag which fields changed | `profile.tsx` save (`location` at `:288`) |
| `avatar_upload_started` / `avatar_upload_succeeded` / `avatar_upload_failed` | Photo upload lifecycle | `profile.tsx` (`uploadAvatar`, `:406`) |
| `avatar_removed` | Photo cleared | `profile.tsx:430` |
| `profile_completed` | All fields deemed *required* by O2 are non-empty (fires once, on the save that crosses the threshold) | derived in `profile.tsx` |

## 4. Success measures mapped to the flows

Each PRD success measure, made concrete. "Target" is intentionally left as *TBD
(§6)* wherever no number is agreed — this spec defines the measure, not the goal
line.

| # | PRD measure | Rate = numerator / denominator | Built from | Target |
| - | ----------- | ------------------------------ | ---------- | ------ |
| M1 | High account-creation completion | `account_created` / `signup_submitted ∪ oauth_started` | §3.1 | TBD — O3 |
| M2 | High login success | `login_succeeded` / `login_submitted ∪ oauth_started (login)` | §3.2 | TBD — O3 |
| M3 | Low unexpected session loss | `session_lost` / active-session-days (sessions restored + refreshed) | §3.3 | TBD — O3 |
| M4 | High profile completion | `profile_completed` / activated accounts | §3.4 | TBD — O2, O3 |

### 4.1 M1 — Account-creation completion

Numerator: users reaching `account_created`. Denominator: sign-up **starts** —
`signup_submitted` (password) plus `oauth_started` on the sign-up screen. Because
the password path can pause at `signup_verification_pending`, report M1 as a
two-step funnel:

`signup_submitted → signup_verification_pending → signup_verification_completed → account_created`

so a low completion rate can be attributed to *drop at verification* (the
`isLikelyNewAuthUser`/verification fork in `services/auth.ts`) versus *submit
failure* (`signup_failed`). Whether verification counts as part of "completion"
depends on whether it is required at all — open question O4. Report `method` and
`platform` breakdowns; the `Platform.OS` split already exists in the flow.

### 4.2 M2 — Login success

Numerator: `login_succeeded`. Denominator: `login_submitted` plus login-screen
`oauth_started`. Split the failures: `login_failed` with
`reason = invalid_credentials` is **user error** and must not be read as system
unreliability, whereas `network`/`server` reasons are. Track a companion
**login system-failure rate** = `login_failed(reason ∈ {network, server})` /
attempts, which is the reliability half of the PRD's *Reliability* NFR and should
trend to ~0 independently of how often users mistype passwords.

### 4.3 M3 — Session reliability

Expressed as its inverse, an **unexpected-session-loss rate**: `session_lost`
(§3.3 — invalidations *not* preceded by a deliberate `signout`) over active
session exposure (restored + refreshed session-days). This directly measures the
PRD goal *"sessions remain valid and predictable"* and the *"Low rate of
unexpected session loss"* success measure. The exact refresh/expiry behavior that
defines "expected" is unspecified (open question O5), so this measure ships with
its definition of *unexpected* pinned to "no explicit sign-out preceded it" and
should be revisited once O5 is answered.

### 4.4 M4 — Profile completion

Numerator: `profile_completed` (all *required* basic fields set). Denominator:
activated accounts (reached `account_created`). The measure is fully defined
**except** which fields are required — name, photo, and home location are the
candidates (`lib/types.ts`), but "required vs optional" is open question O2. Until
O2 is answered, instrument all three fields individually (per-field set-rate from
`profile_saved`/`avatar_upload_succeeded`) so completion can be computed under
whichever definition is chosen without re-instrumenting.

## 5. Instrumentation gaps (things to build, beyond targets)

Distinct from the unset *targets* in §6 — these are missing *capabilities*
without which the measures cannot be computed at all:

1. **No analytics sink exists** (§2.1). Nothing is instrumented today; the SDK/
   destination must be chosen and wired first (O1).
2. **No deliberate-vs-unexpected sign-out signal.** M3 needs `session_lost` to
   exclude user-initiated `signOut`; `onAuthStateChange` currently can't tell them
   apart without an added marker around `authService.signOut`.
3. **No "activated account" definition in code.** M4's denominator assumes a
   clear activation point; today `account_created` is the closest proxy and should
   be adopted explicitly.
4. **Verification-completion event has no dedicated hook.** `app/auth/callback.tsx`
   handles both OAuth return and email verification; the two need distinct events
   to attribute M1 drop-off at verification.

## 6. Open questions — unset targets

These are unresolved and must not be silently defaulted. Each blocks a measure
from being *evaluated* (not from being *collected*).

- **O1 — Analytics destination.** Which SDK/warehouse receives these events? No
  choice exists yet; blocks all of §3–§4. *(New — surfaced by this spec.)*
- **O2 — Required profile fields.** Which of name / photo / home location are
  *required* for `profile_completed`? Sets M4's numerator. *(PRD open question:
  "Which profile fields are required versus optional?")*
- **O3 — Numeric targets.** The actual goal lines for M1–M4 (e.g. "≥ X%
  account-creation completion", "≤ Y% unexpected session loss"). Undefined.
  *(PRD: "Specific targets are still to be defined" / "What concrete targets
  should be used for success metrics?")*
- **O4 — Verification requirement.** Is email verification required during/after
  sign up? Determines whether M1's completion point is a verified session or the
  initial submit. *(PRD open question.)*
- **O5 — Session expiry/refresh behavior.** The expected refresh cadence and
  expiry rules that define which losses are "unexpected" for M3. The lifecycle is
  now defined end to end in `SESSION_HANDLING_SPEC.md` (PRA-14) — including the
  "no explicit sign-out preceded it" definition M3 relies on; what stays open
  there (token TTLs of record, the deliberate-vs-unexpected marker) is what still
  gates M3's evaluation. *(PRD open question: "What session expiration and refresh
  behavior is expected?")*
- **O6 — Auth methods in scope.** Required methods / whether social login/SSO
  count; decides which `method` breakdowns M1–M2 must report. *(PRD open
  questions on auth methods and social login/SSO.)*

## 7. Change checklist

When editing an auth/session/profile flow or these measures:

1. If a flow gains or moves a branch (new provider, changed verification fork,
   new required profile field), add/adjust the matching event in §3 so the
   funnel still spans the whole flow.
2. Keep every rate in §4 defined by an explicit numerator **and** denominator;
   never introduce a measure without stating its population.
3. Keep user error and system failure separable (§4.2) — reliability measures
   count only system failure.
4. When an open question in §6 is answered, replace the *TBD*/definition it
   gates in §3–§4 and delete it from §6 in the same change, so the doc never
   claims a target it doesn't have.
5. Never add PII/secrets to event properties (§2.2).
