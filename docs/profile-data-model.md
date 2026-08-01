# Profile Data Model — Name, Photo, and Home Location

**Issue:** PRA-16 · **Project:** Auth & Accounts · **Status:** Definition (spec)

Defines the profile fields **name**, **profile photo**, and **home location / home
base**: what each field is, whether it is required, how it is validated and
stored, and how it is displayed. This is a specification, not an implementation
change — it documents the model the app should converge on and calls out the
decisions still open.

Scope is limited to these three fields. Other profile columns (`email`,
`interests`, `social_accounts`, and the privacy fields `appear_away` /
`default_visibility`) are out of scope and mentioned only where they interact.

---

## 1. Current state (as built)

All three fields live on the `public.users` table, which extends Supabase
`auth.users` one-to-one (`database/schema.sql:8`). The TypeScript shape is
`User` in `lib/types.ts:22`.

| Field | Column | Type | Nullable | Source |
| --- | --- | --- | --- | --- |
| Name | `users.name` | `TEXT` | yes | OAuth metadata or sign-up form |
| Photo | `users.avatar_url` | `TEXT` (public URL) | yes | Uploaded to `avatars` storage bucket |
| Home location | `users.location` | `TEXT` (free text) | yes | Typed in profile editor |

Key facts grounded in the code:

- **Row lifecycle.** A profile row is created automatically on signup by the
  `handle_new_user()` trigger, which seeds `name` and `avatar_url` from the auth
  provider's metadata and falls back to the email for `name`
  (`database/schema.sql:383`). Password sign-up passes `name` through
  `authService.signUp` (`services/auth.ts:128`); OAuth maps
  `name`/`full_name` and `avatar_url`/`picture` (`services/auth.ts:42`).
- **Editing.** Name and location are edited together in the profile editor and
  saved as `name.trim() || null` / `location.trim() || null`
  (`app/(tabs)/profile.tsx:286`). The photo saves independently and immediately
  on pick/remove (`app/(tabs)/profile.tsx:406`, `:423`).
- **Photo storage.** Photos go to the public `avatars` Supabase Storage bucket
  (5 MB limit; `image/jpeg`, `image/png`, `image/webp`, `image/gif`), keyed
  `{userId}/{timestamp}.{ext}` (`database/schema.sql:27`, upload at
  `app/(tabs)/profile.tsx:159`). RLS makes objects world-readable but writable
  only inside the owner's own folder (`database/schema.sql:258`). The column
  stores the resolved **public URL**, not a storage path.
- **Home location is display-only today.** `location` is free text ("City,
  State" placeholder, `app/(tabs)/profile.tsx:597`). Nothing in the app reads it
  for logic — in/out-of-town status is set manually per day on the calendar and
  never derived from `location`. It is not the same concept as a functional
  "home base."

---

## 2. Field definitions

### 2.1 Name (`name`)

The user's display name — how friends recognize them in search, the friends
list, and calendar views.

- **Purpose:** human-readable identity across the app.
- **Type / storage:** `TEXT` on `users.name`, nullable.
- **Required?** **Optional at the row level, effectively required for a complete
  profile.** The column is nullable and the trigger falls back to email, so a
  row always resolves *something*, but the product treats a missing name as an
  incomplete profile: the header shows the "Add your name" placeholder
  (`app/(tabs)/profile.tsx:117`).
- **Default / fallback:** provider name → `full_name` → email at creation
  (`database/schema.sql:390`). For display, `name` → email initial for the
  avatar monogram (`app/(tabs)/profile.tsx:114`).

### 2.2 Profile photo (`avatar_url`)

An optional square avatar shown wherever the user appears.

- **Purpose:** visual identity in the profile hero, friends list, and search.
- **Type / storage:** `TEXT` public URL on `users.avatar_url`, nullable; the
  binary lives in the `avatars` storage bucket.
- **Required?** **Optional.** When absent, the UI renders a monogram fallback
  (first letter of name, else email) on a brand-colored circle
  (`app/(tabs)/profile.tsx:524`).
- **Constraints (enforced by storage bucket):** ≤ 5 MB; MIME must be JPEG, PNG,
  WebP, or GIF (`database/schema.sql:32`). The client crops to a 1:1 aspect and
  compresses to `quality: 0.8` before upload (`app/(tabs)/profile.tsx:394`).

### 2.3 Home location / home base (`location`)

Where the user is normally based — the anchor that gives "in town" its meaning.

- **Purpose:** tells friends where "home" is. Conceptually the reference point
  for the app's core in-town / out-of-town model.
- **Type / storage:** `TEXT` free text on `users.location`, nullable.
- **Required?** **Optional** today, at both the row and product level (the
  profile summary simply shows "Not set", `app/(tabs)/profile.tsx:653`).
- **Format:** unstructured; UI nudges toward "City, State" but nothing enforces
  it. No coordinates, no place ID, no normalization.

---

## 3. Required vs. optional — summary

| Field | DB constraint | Product expectation |
| --- | --- | --- |
| `name` | Nullable (email fallback) | Expected; missing → "Add your name" prompt |
| `avatar_url` | Nullable | Optional; monogram fallback |
| `location` | Nullable | Optional |

No field is `NOT NULL` at the database level except `email`. "Required" in this
model means *product-required for a complete profile*, surfaced through prompts
and placeholders rather than hard constraints. This is deliberate: the signup
trigger must be able to create a valid row from whatever the auth provider
supplies.

---

## 4. Validation & data constraints

**Enforced today**

- Name and location are trimmed; empty strings persist as `NULL`, never `""`
  (`app/(tabs)/profile.tsx:287`).
- Photo size and MIME are enforced by the storage bucket definition
  (`database/schema.sql:32`); oversized or wrong-type uploads are rejected
  server-side.
- Photo writes are scoped to the owner's folder by RLS
  (`database/schema.sql:262`).

**Not enforced today (gaps to decide on)**

- **No length caps** on `name` or `location`. Recommend app- and DB-level max
  lengths (proposed: name ≤ 80 chars, location ≤ 120 chars) to bound storage and
  layout.
- **No character/content validation** on `name` (whitespace-only is blocked by
  the trim-to-null rule, but emoji, control characters, and impersonation-style
  values are not).
- **No structure or geocoding** on `location` — see §6.
- **No server-side re-validation** of the trimming/normalization the client
  does; a direct API write could store untrimmed values.

---

## 5. Storage & display assumptions

- **One profile row per auth user**, PK = `auth.users.id`, cascade delete
  (`database/schema.sql:9`).
- **Photo URL, not path.** `avatar_url` holds a fully-resolved public URL.
  Consequence: rotating the bucket, CDN host, or making it private would
  invalidate stored URLs. A stored **path** + on-read URL resolution would be
  more durable (open question §7).
- **Orphaned photos.** Removing a photo sets `avatar_url = NULL` but does **not**
  delete the storage object (`app/(tabs)/profile.tsx:423`); replacing a photo
  writes a new timestamped key and leaves the old one. Storage accumulates
  orphans over time — needs a cleanup story.
- **Visibility.** Profiles are readable by the owner, by accepted friends, and —
  importantly — by **any authenticated user** for search
  (`database/schema.sql:239`, `:248`). So name, photo, and location are
  effectively discoverable app-wide, not just among friends. This must inform
  how sensitive we treat `location` (a precise home address would be
  inappropriate to expose this broadly).
- **Display fallbacks** are part of the model, not just UI polish: name →
  placeholder, avatar → monogram, location → "Not set".

---

## 6. Home location: the core design decision

`location` is the least-defined field and the one that matters most to InTown's
purpose. Two viable directions:

- **A. Keep it as a display label (free text).** Lowest effort; matches today.
  "Home base" stays a human-readable string with no functional role. Good enough
  if we never key features off it.
- **B. Make it a structured home base.** Store a normalized place (city/region,
  optionally coordinates or a place ID) so it can anchor features — e.g.
  defaulting in/out-of-town detection, grouping friends by metro, or "who's home
  this weekend." Higher effort (place picker, geocoding, migration) and raises
  privacy questions given app-wide profile visibility.

**Recommendation:** ship the definition with `location` as an **optional
free-text home label** now, and treat a structured home base as a follow-up
only if a concrete feature needs it. Avoid storing precise addresses given §5
visibility.

---

## 7. Open questions

1. **Home base — label or structured?** §6. Which direction, and does any near-
   term feature actually depend on structured location? (Blocks finalizing the
   `location` field.)
2. **Visibility of location.** Given profiles are searchable by all authenticated
   users, should `location` be coarser (city/region only) or gated to friends?
3. **Is name product-required?** Do we hard-require a name at onboarding, or keep
   the email fallback + "Add your name" prompt?
4. **Length / content limits** for name and location — adopt the proposed caps
   (name ≤ 80, location ≤ 120) and add DB `CHECK`s + client validation?
5. **Photo path vs URL.** Store the storage path and resolve URLs on read, to
   survive bucket/CDN changes and enable signed URLs if the bucket ever goes
   private?
6. **Orphaned photo cleanup.** Delete the old object on replace/remove (client,
   trigger, or scheduled sweep)?
7. **Server-side validation.** Do we enforce trim/normalization and constraints
   at the API/DB layer, not just in the client editor?
