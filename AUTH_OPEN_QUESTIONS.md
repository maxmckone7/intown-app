# Auth & Accounts — Open Product Questions & Acceptance Criteria

Tracks the unresolved decisions that block an implementation-ready definition
for the Auth & Accounts area, and records the decisions the current code has
already settled so downstream work can rely on them.

- **Issue:** PRA-20 — Resolve open product questions and acceptance criteria
- **Project:** Auth & Accounts ([PRD](https://linear.app/rideshare-company/project/auth-and-accounts-acb081eeaa13))
- **Lead / default owner:** Max McKone (project lead)
- **Traceability:** Each question below maps 1:1 to an entry in the PRD
  *Open questions* section. Where the shipped code already answers a question,
  this document states that as the **current state** and flags only the residual
  decision as **Open**. The code is the source of truth for behavior; this doc is
  the source of truth for what is *decided* vs. what still blocks downstream work.
- **Key source files:** `services/auth.ts`, `lib/supabase.ts`,
  `app/(auth)/login.tsx`, `app/(auth)/signup.tsx`,
  `app/(auth)/forgot-password.tsx`, `app/auth/reset-password.tsx`,
  `app/auth/callback.tsx`, `app/(tabs)/profile.tsx`, `database/schema.sql`.

Status legend: **Decided** (settled in code/config, no further product input
needed) · **Partially decided** (default in place, one product call outstanding)
· **Open** (blocks downstream work until answered).

---

## 1. Authentication method decisions

**PRD question:** *Which authentication methods are required?*

**Status:** Partially decided.

**Current state.** Three methods are implemented in `services/auth.ts` and wired
into both `login.tsx` and `signup.tsx`:

- Email + password (`supabase.auth.signUp` / `signInWithPassword`).
- Google OAuth (`signInWithGoogle`) — offered on all platforms.
- Apple OAuth (`signInWithApple`) — button rendered only when
  `Platform.OS === 'ios'`.

Password policy is a **client-side minimum of 6 characters**, enforced in
`signup.tsx` and `reset-password.tsx` only (no server-side or complexity rule).

**Open decisions:**

- Is email + password *required*, or should the product push toward social-only
  sign-in? (Affects whether the password policy needs hardening.)
- Confirm the password policy of record (min length, complexity, breached-password
  check). The current `< 6` check is a placeholder and is not enforced server-side.

**Owner / follow-up:** Product lead (Max McKone) for the method set; Eng lead for
the password-policy backstop (Supabase Auth password settings). Track as a
sub-issue under the Auth & Accounts project.

---

## 2. Verification requirements

**PRD question:** *Is account verification required during or after sign up?*

**Status:** Open — code supports it, but enforcement is a config/product call.

**Current state.** Email verification is *supported but not asserted by the app*.
`signUp` passes `emailRedirectTo` → `auth/callback`, and `signup.tsx` already
handles the unverified case: when Supabase returns no session it shows a
"Check your email" pending-verification screen. Whether a session is returned
immediately depends entirely on the **Supabase project's "Confirm email"
setting** — the app does not force verification on its own.

**Open decisions:**

- Is email confirmation **mandatory** before first use, or optional?
- If mandatory, what is the unverified-user experience (blocked vs. limited
  access), and is there a resend-verification path? (No resend UI exists today.)
- Any verification for social sign-ups (email comes pre-verified from Google/Apple)?

**Owner / follow-up:** Product lead decides mandatory vs. optional; Eng lead sets
the matching Supabase Auth toggle so app behavior and config agree. **Blocks**
the signup acceptance criteria and any "account-creation completion" metric.

---

## 3. Password reset / account recovery requirements

**PRD question:** *What password reset or account recovery flows are required?*

**Status:** Password reset **decided & implemented**; broader recovery **open**.

**Current state.** A full password-reset flow ships:
`requestPasswordReset` → email link → `app/auth/reset-password.tsx` →
`exchangePasswordResetCode` → `updatePassword` → forced sign-out → login. It is
reachable from the login screen ("Forgot password?") and from
`profile.tsx` ("Reset Password"). Messaging is **non-enumerating** ("If an InTown
account exists for …"), matching the mock's non-enumerating `resetPasswordForEmail`.

**Open decisions (gaps in recovery beyond password):**

- **Account deletion / deactivation** — not implemented anywhere. Required for
  app-store compliance if accounts are user-facing.
- **Email change** — the account email is not editable in the UI; no re-verification
  flow exists for changing it.
- **Recovery when the only method is a social provider** (user has no password) —
  the reset flow assumes a password account.
- Reset-link expiry window and rate-limiting expectations (currently Supabase defaults).

**Owner / follow-up:** Product lead to scope deletion + email-change (likely their
own issues); Eng lead to confirm link expiry/rate-limit config.

---

## 4. Social login / SSO scope decisions

**PRD question:** *Are social login or SSO options in scope?*

**Status:** Partially decided.

**Current state.** Google and Apple OAuth are in scope and implemented (§1).
Apple is gated to iOS. OAuth uses the `intown://auth/callback` redirect scheme
via `expo-auth-session` and `WebBrowser.openAuthSessionAsync`, with
`app/auth/callback.tsx` completing the code exchange.

**Open decisions:**

- **Apple sign-in is required by App Store Guideline 4.8** when other third-party
  sign-in is offered — confirm we render it wherever the review requires (today it
  is iOS-only; verify web/App Store expectations).
- Is Apple (or Google) expected to work on **web and Android**, or intentionally
  iOS-only for Apple?
- **Enterprise SSO (SAML/OIDC)** — assumed out of scope; confirm and record so it
  isn't silently expected downstream.

**Owner / follow-up:** Product lead confirms the provider matrix and compliance
requirement; Eng lead validates redirect/deep-link config per platform.

---

## 5. Profile field requirements and edit rules — fields

**PRD question:** *Which profile fields are required versus optional?*

**Status:** Open — the shipped field set exceeds the PRD's stated scope.

**Current state.** `database/schema.sql` `public.users` stores: `email`
(**NOT NULL**), `name`, `avatar_url`, `location`, `interests TEXT[]`,
`social_accounts JSONB` (instagram / x / linkedin / website). In the UI
(`profile.tsx`) **every field except email is optional** — name renders an
"Add your name" placeholder when empty.

**Conflict to resolve.** The PRD scopes basic profile to **name, photo, and home
location** and lists "advanced profile customization beyond the fields already
listed" as **out of scope** — but `interests` and `social_accounts` are already
built and shipped. Either the PRD scope or the code needs to be reconciled.

**Open decisions:**

- Which fields are **required** for a complete profile? The PRD's "high completion
  rate for *required* basic profile setup" metric is undefined until this is set.
  (Candidate: name + home location required; photo + others optional.)
- Are `interests` and `social_accounts` officially **in scope** (update the PRD) or
  should they be deferred/removed?
- "Home location / home base" (PRD term) vs. the free-text `location` field — is a
  structured home base needed, or is free text sufficient?

**Owner / follow-up:** Product lead owns the required-field decision and the PRD
scope reconciliation. **Blocks** the profile-completion success metric.

---

## 6. Profile field requirements and edit rules — edit rules

**PRD question:** *What are the exact rules for editing profile data after initial
setup?*

**Status:** Partially decided.

**Current state.** In `profile.tsx`: name / location / interests / social accounts
are edited together behind an **Edit → Save** action; the avatar **autosaves**
immediately on pick/remove (with an "updates save automatically" hint). Empty
inputs are normalized to `null`; interests are comma-split and trimmed; social
handles are trimmed and empties dropped. There is **no field-level validation**
(social URLs, location format, name length are unvalidated) and **no
re-verification** on any edit.

**Open decisions:**

- Validation rules per field (e.g., URL validation for `website`/`linkedin`,
  max lengths, allowed characters for `name`).
- Should changing email be supported, and if so require re-verification? (See §3.)
- Any moderation/safety rules for user-visible fields (name, interests) shown to
  friends?

**Owner / follow-up:** Design + Product for the validation/edit ruleset; Eng lead
to add server-side validation. Lower priority than §5 but needed before profile
data is trusted downstream.

---

## 7. Session expiration and refresh expectations

**PRD question:** *What session expiration and refresh behavior is expected?*

**Status:** Partially decided (defaults in place). Behavior now defined end to
end in `SESSION_HANDLING_SPEC.md` (PRA-14); the residual product/config decisions
below remain open and are mirrored as that spec's §7 open questions.

**Current state.** The real client (`lib/supabase.ts`) is configured with
`autoRefreshToken: true`, `persistSession: true` (backed by `AsyncStorage`), and
`detectSessionInUrl: false`. Actual token lifetimes are **governed by the Supabase
project config**, not the app — Supabase defaults are a ~1-hour access token with
a rotating refresh token. The dev mock hard-codes `expires_in: 3600`.
`reset-password.tsx` deliberately signs the user out after a password change.

**Open decisions:**

- Confirm the **access-token TTL and refresh-token lifetime** of record in Supabase
  (defaults vs. an explicit product choice).
- Expected behavior on refresh failure / expired session — silent re-login vs.
  bounce to login (today `profile.tsx` redirects to login when `getCurrentUser`
  is null, but there is no global expiry handler).
- **"Low rate of unexpected session loss"** target needs a number (see §9).
- Multi-device / concurrent-session and remote-sign-out expectations.

**Owner / follow-up:** Eng lead confirms the Supabase token settings and documents
them; Product lead sets the acceptable session-loss target.

---

## 8. Platform-specific requirements

**PRD question:** *Are there platform-specific requirements that should be captured
separately?*

**Status:** Partially decided — several platform branches already exist.

**Current state.** The app already branches on platform in many places:

- Navigation: `router.push` on web vs. `router.replace` on native after auth.
- Alerts: `window.alert` on web vs. `Alert.alert` on native (repeated `showAlert`).
- Layout: desktop breakpoint `width >= 900` on web (`login.tsx`).
- `KeyboardAvoidingView` behavior differs iOS vs. other.
- Apple sign-in button is iOS-only.
- OAuth redirect uses the `intown://` deep-link scheme; `detectSessionInUrl: false`
  means web OAuth relies on the explicit `auth/callback` route.

**Open decisions:**

- **Web OAuth redirect** configuration and allowed redirect URLs (native deep-link
  is set up; web needs its own confirmed redirect handling).
- Deep-link scheme registration (`intown://`) across iOS/Android builds.
- Apple review requirements for the App Store build (ties to §4).
- Is web a **supported production target** for auth, or dev-only?

**Owner / follow-up:** Eng lead owns the per-platform redirect/config matrix;
Product lead confirms which platforms are officially supported at launch.

---

## 9. Concrete success targets

**PRD question:** *What concrete targets should be used for success metrics?*

**Status:** Open — the PRD names metric *categories* but states "Specific targets
are still to be defined." This is the single biggest undefined item.

**Current state.** No analytics/target instrumentation for auth exists in the repo.
The PRD lists four measure categories: account-creation completion, login success
rate, unexpected session-loss rate, and required-profile completion.

**Proposed targets to ratify (placeholders, need product sign-off):**

| Metric | Definition | Proposed target |
| ------ | ---------- | --------------- |
| Account-creation completion | Users who start sign-up and reach an active session (incl. verification if mandatory, §2) | ≥ 85% |
| Login success rate | Successful logins ÷ login attempts (excluding wrong-password) | ≥ 98% |
| Unexpected session loss | Sessions ending in forced re-login not initiated by the user, per active user per month | ≤ 1% |
| Required-profile completion | New users completing the required fields (per §5) within first session | ≥ 70% |

**Open decisions:**

- Ratify or replace each target above.
- Define measurement: what events must be instrumented, and where (Supabase logs
  vs. product analytics). No instrumentation exists yet.

**Owner / follow-up:** Product lead ratifies targets; Eng lead scopes the
instrumentation. **Blocks** the project's stated success measures.

---

## 10. Gaps that block downstream work

Ordered by how much they block an implementation-ready definition.

| # | Gap | Blocks | Owner |
| - | --- | ------ | ----- |
| 1 | Success targets undefined and no instrumentation (§9) | Every PRD success measure | Product lead + Eng lead |
| 2 | Email verification mandatory vs. optional (§2) | Sign-up acceptance criteria, creation metric | Product lead |
| 3 | Required vs. optional profile fields + PRD scope conflict on interests/socials (§5) | Profile-completion metric, PRD scope | Product lead |
| 4 | Password policy of record; `< 6` placeholder, no server enforcement (§1) | Security NFR | Eng lead |
| 5 | Account deletion + email change absent (§3, §6) | Recovery scope, store compliance | Product lead |
| 6 | Session TTL/refresh lifetimes not documented; no global expiry handler (§7) | Session-loss target, reliability NFR | Eng lead |
| 7 | Web OAuth redirect + deep-link + Apple-review config per platform (§4, §8) | Cross-platform launch | Eng lead |
| 8 | Per-field profile validation + moderation rules (§6) | Data trust downstream | Product + Design |

**Next step:** Product lead (Max McKone) to triage rows 1–3 and 5 into decisions or
dedicated issues; Eng lead to confirm rows 4, 6, 7 against Supabase project config.
Once rows 1–3 are answered, the Auth & Accounts PRD can move from *Idea* to an
implementation-ready state.
