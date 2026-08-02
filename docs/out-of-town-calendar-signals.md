# Supported Out-of-Town Calendar Signals

**Issue:** PRA-6 · **Project:** Google Calendar Sync · **Status:** Definition / product decision

This document is the **product decision** for which Google Calendar events and
attributes count as evidence that a user is out of town. It is a **definition**
deliverable — it fixes the supported signals, the explicitly *unsupported* and
*ambiguous* signals, the rules for resolving conflicting evidence, and the
evaluation semantics precise enough to implement and test. It does **not** ship
code; there is no Google Calendar integration in the codebase yet (today's
calendar is the manual per-day model in `services/calendar.ts`).

Its consumer is **PRA-9 (Implement out-of-town inference logic)**, whose
acceptance criteria require that "supported signals are translated into
deterministic inference logic," "ambiguous or unsupported events do not produce
unintended status changes," and "conflict handling follows the documented
product decision." This doc *is* that documented decision.

Companion issues in the project (this doc references rather than repeats them):
- **PRA-7 — Google OAuth connection.** How the calendar is connected/authorized. This doc assumes read access to the user's **primary** calendar exists.
- **PRA-8 — Sync & trigger behavior.** *When* calendar data is fetched/re-evaluated (cadence, webhooks, look-ahead/look-back window). This doc defines *what* a fetch means, not *when* it happens.
- **PRA-9 — Inference logic.** Implements the rules below. **This doc owns the decision; PRA-9 owns the implementation.**
- **PRA-10 — Status-update integration.** Writes the inferred result into the in/out status path (`calendar_entries`). Owns manual-vs-inferred precedence *at write time*; this doc states the precedence *rule* it must honor (§4, C1).
- **PRA-11 — Error handling & observability.** Surfacing sync failures and the per-day provenance this doc asks inference to record.

## Scope

**In scope:** the set of Google Calendar signals that may cause a day to be
inferred `out_of_town`; the signals that must be ignored; how contradictory
same-day evidence resolves; and the day-coverage / timezone semantics needed to
make the rules deterministic and testable.

**Out of scope (owned elsewhere):** OAuth and scopes (PRA-7); sync cadence and
the fetch window (PRA-8); the code that evaluates events (PRA-9); writing status
and the DB write path (PRA-10); failure UX and logging (PRA-11); non-Google
providers and any presence automation beyond in/out status (project *Out of
scope*).

## Current status model (what a signal must map onto)

Status is a **per-day binary** — `CalendarStatus = 'in_town' | 'out_of_town'`
(`lib/types.ts:1`) — stored as **at most one `calendar_entries` row per
(user, date)** (`database/schema.sql:51-55`, unique on user+date). There is no
partial-day, no "tentative," and no location field on a day. Every calendar
signal must therefore resolve to a decision **about whole calendar days**:
either "assert `out_of_town` for this date" or "say nothing about this date."

Two decisions follow directly from that model and frame everything below:

- **D-A — v1 calendar signals only ever assert `out_of_town`; they never assert
  `in_town`.** The absence of an away signal on a day is *not* positive evidence
  the user is in town — they may simply not calendar their travel. Treating "no
  event" as `in_town` would let the calendar silently overwrite a correct manual
  `out_of_town`. So the calendar contributes a set of **out-of-town days**;
  every other day keeps its existing (manual or default) status untouched.
- **D-B — the unit of inference is the fully-covered day.** A signal marks a
  date `out_of_town` only when an away event **covers the entire local day**
  (§5). Partial-day events (a single afternoon meeting, a 2-hour OOO block) do
  not move a per-day binary and are ignored in v1.

Legend for the tables:
**Signal disposition** — 🟢 supported (asserts `out_of_town`) · 🚫 unsupported (ignored) · ⚠️ ambiguous (ignored in v1, rule stated) · ⚪ deferred / gated on an open decision.

---

## 1. Decision principles

1. **Precision over recall.** A wrong `out_of_town` (telling friends you're away
   when you're home) is worse than a missed one — it erodes the trust the
   project's success measures depend on. When a signal is uncertain, ignore it.
2. **Prefer structured signals to free text.** Google's native event *types*
   (e.g. Out-of-office) are unambiguous machine data; event *titles* are
   free-text and only a medium-confidence hint.
3. **Only assert absence, never presence** (D-A).
4. **Deterministic and testable.** Given the same events and timezone, inference
   must produce the same day set every run (PRA-9 AC). No heuristics that depend
   on time-of-evaluation or model guessing.
5. **The user's own calendar, the user's own attendance.** Only the connected
   user's primary calendar counts, and only events they haven't declined.

---

## 2. Supported signals (v1)

A day is inferred `out_of_town` when **at least one Supported away event covers
the full local day** (§5) **and passes all Common qualifiers** below.

### 2.1 Common qualifiers (apply to every supported signal)

An event is considered only if **all** hold:

| # | Qualifier | Why |
|---|-----------|-----|
| Q1 | On the user's **primary** calendar | Secondary/subscribed calendars (holidays, a partner's shared calendar) don't describe *this* user's whereabouts. See U4. |
| Q2 | `status` is **`confirmed`** (not `cancelled`) | Cancelled events are not evidence. |
| Q3 | The user has **not declined** — their own `attendees[].responseStatus` ∉ {`declined`} (events they own, or with no attendee list, pass) | A declined trip is not a trip you're on. See U5. |
| Q4 | The event's title/type does **not** match the **presence deny-list** (§Appendix B) | "WFH", "Work from home", etc. mean you're *home*. The deny-list overrides every positive match, including Tier A. This is conflict rule C3. |
| Q5 | The event **fully covers** the local day in question (§5) | Per D-B; partial-day away time can't move a per-day binary. |

### 2.2 Supported signal types

| # | Signal | Confidence | Disposition | Definition & rationale |
|---|--------|-----------|-------------|------------------------|
| **S1** | **Native Out-of-office event** — `eventType == "outOfOffice"` | High (Tier A) | 🟢 | Google's structured "I'm away" type, created deliberately by the user. Machine-readable, no title parsing. Each full local day it spans is asserted `out_of_town`. *Semantic caveat:* "out of office" can also mean sick/appointment, not travel — accepted in v1 as the best structured proxy for "not locally available," and narrowed by Q4 (a WFH-titled OOO is excluded). Revisit under O1. |
| **S2** | **All-day event with a travel-keyword title** — an all-day (date-based) event whose `summary` matches the **travel allowlist** (§Appendix A), single- or multi-day | Medium (Tier B) | 🟢 | Covers the common "Vacation," "PTO," "Trip to Denver" all-day blocks people already keep. All-day guarantees full-day coverage (Q5). Title match is case-insensitive, phrase/word-boundary (§5.4), **title only** — not description — to bound false positives. The allowlist is deliberately conservative and is itself a tunable decision (O2). |

Nothing else asserts `out_of_town` in v1. Everything in §3 is ignored.

> **Provenance (for PRA-9 / PRA-11).** When a day is asserted `out_of_town`,
> inference should record *which* event and signal type drove it (event id +
> S1/S2). This is what makes the result explainable and the failure modes
> debuggable; it is not a stored product field here, but a requirement passed to
> the implementing issues.

---

## 3. Unsupported & ambiguous signals (explicitly ignored in v1)

These are enumerated so PRA-9 can assert they produce **no** status change.

| # | Signal | Disposition | Decision & reasoning |
|---|--------|-------------|----------------------|
| U1 | **Timed meetings with a `location`** (e.g. a 2 pm meeting in another city) | 🚫 | A single timed meeting doesn't establish a full away day (D-B), and treating any out-of-city meeting as travel over-fires for commuters and hybrid workers. |
| U2 | **Geocoding the `location` string / distance-from-home** inference | ⚪ | The profile has a home location (PRA-16), but resolving free-text locations, geocoding, and picking a distance threshold is error-prone and heavy. Deferred; strong candidate for v2 (O4). |
| U3 | **Working-location events** — `eventType == "workingLocation"` (home / office / custom) | 🚫 | Describes *where you work*, not travel. "Home"/"office" are explicitly in-town-ish; a "custom" location is unstructured and unreliable. Reconsider only via O4. |
| U4 | **Events on secondary / subscribed / shared calendars** (public holidays, sports schedules, a friend's calendar) | 🚫 | Fails Q1 — not evidence about this user. A "US Holidays" entry is not a trip. |
| U5 | **Events the user declined or hasn't accepted** (`declined`; `needsAction`/`tentative` treated as not-attending for away purposes) | 🚫 | Fails Q3. A declined trip / an unanswered invite is not confirmed travel. Whether `tentative` should count is O3. |
| U6 | **`eventType` = `focusTime`, `birthday`, `fromGmail`** | 🚫 / ⚪ | Focus time and birthdays aren't travel. `fromGmail` (auto-created flight/hotel confirmations) is a genuinely strong future signal but needs Gmail scope and parsing — deferred to O5. |
| U7 | **Partial-day OOO / away blocks** (an OOO covering only part of a day) | ⚠️ | Real but sub-day; can't move a per-day binary (D-B). Ignored. If a *different*, full-day supported event also covers the day, that day still fires via S1/S2. |
| U8 | **Keyword-less all-day events** ("Mom's birthday," "Rent due," generic all-day reminders) | 🚫 | All-day alone is not travel; only the allowlist match (S2) qualifies. |
| U9 | **"Working from home" / WFH, however expressed** (title, or an OOO/all-day event carrying a WFH term) | ⚠️ 🚫 | Actively means *in town*. Enforced by the deny-list (Q4), which overrides any positive match. Never asserts `out_of_town`, and per D-A never asserts `in_town` either. |
| U10 | **Recurring events** (daily/weekly), including recurring all-day items | 🚫 (v1) | A recurring all-day "Gym" or weekly standup shouldn't flip status repeatedly. v1 evaluates only **single-instance** away events; recurring-instance handling is O6. |
| U11 | **`transparency: transparent` (Free) timed events** | 🚫 | "Free" busy-state plus timed ⇒ not a full away day. (All-day events are Free by default, so *transparency is not used to gate S2* — S2 relies on all-day + allowlist, not busy state.) |
| U12 | **Private/visibility-restricted event contents** where only free/busy is readable | ⚪ | If the granted scope yields only free/busy (no titles/types), S1/S2 can't be evaluated → no assertion (D-A holds: silence, not a guess). Scope choice is PRA-7; behavior under reduced scope is O7. |

---

## 4. Conflict handling rules

When multiple events (or a manual entry) bear on the **same date**, resolve in
this order. These are the "conflict handling rules … when multiple events
suggest different outcomes" required by the issue.

- **C1 — Manual entry wins over inference (precedence, not merge).** If the user
  has manually set a day's status, calendar inference must **not** overwrite it.
  The calendar's out-of-town set is applied only to days the user hasn't
  explicitly set. *(Enforcement lives in PRA-10's write path; the decision is
  fixed here. Open sub-question O8: do we ever re-assert after the manual
  override's trip window passes, and do we mark inferred days so a later sync can
  correct its own earlier guess?)*
- **C2 — Away evidence dominates same-day non-away events.** If a day is covered
  by a Supported away event (S1/S2) **and** also has ordinary in-town meetings,
  the day is `out_of_town`. Away evidence is not out-voted by the presence of
  normal calendar activity. (This is why we never infer `in_town` from busy
  meetings — D-A.)
- **C3 — Deny-list overrides all positive matches.** A day whose only/overlapping
  driver matches the presence deny-list (WFH etc., Q4/U9) is **not** asserted,
  even if it is a native OOO (S1). Presence terms beat away terms.
- **C4 — Cancelled/declined never contribute** (Q2/Q3). A cancelled duplicate of
  an otherwise-qualifying event does not keep the day away; another *qualifying*
  copy would.
- **C5 — Multiple qualifying away events on one day are idempotent.** The day is
  `out_of_town` once; record the earliest-created (or lowest event-id, for
  determinism) qualifying event as the provenance driver. No double-processing.
- **C6 — No calendar-internal presence contradiction is possible in v1.** Because
  the calendar emits only `out_of_town` (D-A), two supported events can never
  disagree about a day — they can only agree or one can be ignored. This is
  deliberate: it removes an entire class of tie-breaks. If v2 adds positive
  in-town signals, this rule must be revisited.

---

## 5. Evaluation & matching semantics (for determinism / testability)

These make "covers the full day" and "matches a keyword" unambiguous so PRA-9's
tests are deterministic.

### 5.1 The reference timezone
Days are evaluated in the **user's primary-calendar timezone** (the calendar's
`timeZone`), not the device timezone and not UTC. A "day" is the local civil
day `[00:00, 24:00)` in that zone. Rationale: `out_of_town` is a human, local-day
concept; using UTC would misclassify evenings/mornings near the date boundary.

### 5.2 "Covers the full local day"
- **All-day (date) events:** Google encodes all-day events with `start.date`
  inclusive and **`end.date` exclusive** (the day *after* the last away day).
  Covered days = every date in `[start.date, end.date)`. A "Vacation" with
  `start.date = 2026-08-10`, `end.date = 2026-08-14` covers **Aug 10, 11, 12,
  13** — **not** Aug 14. Getting this exclusive end right is the single most
  common implementation bug; it is called out explicitly for PRA-9 tests.
- **Timed (dateTime) events, e.g. multi-day OOO:** a local day D is covered iff
  `start ≤ localMidnight(D)` and `end ≥ localMidnight(D+1)`. A timed event that
  starts midday or ends midday does **not** cover that boundary day (U7).

### 5.3 Which dates get evaluated
Only dates inside PRA-8's active sync window (look-back / look-ahead) are
evaluated; dates outside it are never asserted. The window definition is PRA-8's;
inference must not assert a day it wasn't asked to evaluate.

### 5.4 Keyword matching (S2, Appendix A/B)
- Case-insensitive; match against `summary` (title) only.
- **Phrase entries** ("out of town", "annual leave") match as contiguous
  substrings on word boundaries; **single-word entries** ("vacation", "pto")
  match as whole words (`\bvacation\b`) so "vacationing-fund" or "pto-review"
  don't false-fire. Emoji/leading icons in titles are ignored.
- The **deny-list is checked first**; a deny-list hit disqualifies the event
  regardless of any allowlist hit (C3). Example: "WFH — no meetings day" never
  qualifies; "Holiday party" is excluded because "holiday" is intentionally
  *not* a bare allowlist word (see Appendix A note).

---

## 6. Representative scenarios (expected outcomes)

A starter test matrix for PRA-9. TZ = user's primary-calendar zone.

| # | Event(s) on the day | Expected | Rule |
|---|---------------------|----------|------|
| 1 | All-day "Vacation" Aug 10–14 (end exclusive) | `out_of_town` for **Aug 10–13**; Aug 14 untouched | S2, §5.2 |
| 2 | Native OOO, full day, "Out of office" | `out_of_town` | S1 |
| 3 | OOO 1 pm–3 pm only | no change | U7/D-B |
| 4 | All-day "WFH" | no change | U9/Q4/C3 |
| 5 | Native OOO titled "WFH today" | no change (deny-list overrides S1) | C3 |
| 6 | All-day "Vacation" **and** a 10 am team meeting | `out_of_town` | C2 |
| 7 | 2 pm meeting, location "Denver, CO", user in NYC | no change | U1/U2 |
| 8 | "US Holidays" all-day entry on a subscribed calendar | no change | U4/Q1 |
| 9 | All-day "Trip to Denver" the user **declined** | no change | U5/Q3 |
| 10 | Cancelled all-day "Vacation" | no change | U2-status/Q2/C4 |
| 11 | Weekly recurring all-day "On call" | no change (v1) | U10 |
| 12 | Day already **manually** set `in_town`, plus all-day "Vacation" | stays manual `in_town`; inference suppressed | C1 |
| 13 | All-day "Holiday party" | no change (title not an allowlist word) | §5.4 |
| 14 | Working-location "Custom: Austin" all day | no change | U3 |
| 15 | Gmail-derived flight "SFO→JFK" | no change (v1) | U6/O5 |

---

## 7. Open questions / follow-ups that block or shape implementation

Captured per the issue's fourth acceptance criterion. **O1–O3 and O8 should be
resolved before PRA-9 is considered fully specified;** the rest can trail as v2
scope.

1. **O1 — Keep native OOO in scope as `out_of_town`?** OOO ≠ strictly "out of
   town" (sick days, local appointments). Decision taken: **yes**, narrowed by
   the deny-list. Confirm with product, or downgrade OOO to Tier B. *(Affects
   precision directly.)*
2. **O2 — The travel allowlist contents (Appendix A).** Which terms are in, and
   is the list localized (non-English titles)? The allowlist is the main
   precision/recall dial. Needs an explicit owner + review cadence.
3. **O3 — Does `tentative` attendance count?** v1 says no (U5). Confirm, or add
   a lower-confidence tier for tentatively-accepted trips.
4. **O4 — Location/geocoding signal (v2).** Should a resolved location far from
   the PRA-16 home location become a supported signal, and at what distance? Also
   governs U3 working-location "custom."
5. **O5 — Gmail-derived travel (`fromGmail` flights/hotels).** High-value, needs
   Gmail scope (coordinate with PRA-7) and parsing rules. In or out for this
   project?
6. **O6 — Recurring away events.** v1 ignores them (U10). Do we support a
   recurring all-day "Working remotely from Spain" block, and how do exceptions
   to a recurrence interact with C1?
7. **O7 — Reduced OAuth scope / free-busy-only.** If PRA-7 grants only free/busy,
   S1/S2 can't be read. Confirm the scope requested, or define a free/busy-only
   fallback (likely: assert nothing — D-A).
8. **O8 — Manual-vs-inferred lifecycle (with PRA-10).** Are inferred days flagged
   so a later sync can *correct its own* earlier assertion (e.g. a trip that got
   cancelled) without touching manual days? And once set, when does an inferred
   `out_of_town` expire back to baseline? This is the boundary between this
   decision (C1) and PRA-10's write model.
9. **O9 — Multi-calendar selection.** v1 uses the primary calendar only (Q1). Do
   power users need to pick *which* calendar carries their travel (many keep a
   dedicated "Personal/Travel" calendar)? Ties to PRA-7 scopes.

---

## 8. Acceptance-criteria coverage

- **Supported signal types explicitly documented** — §2 (S1 native OOO, S2 travel-keyword all-day) with common qualifiers and the confidence tiers. ✅
- **Unsupported / ambiguous signals explicitly documented** — §3 (U1–U12), including geocoding, working-location, secondary calendars, declined, partial-day, WFH, recurring, free/busy-only. ✅
- **Conflict handling rules defined** — §4 (C1–C6): manual-wins, away-dominates, deny-list-overrides, cancelled/declined-excluded, idempotency, and why no calendar-internal contradiction exists in v1. ✅
- **Blocking follow-up questions captured** — §7 (O1–O9), with O1–O3/O8 flagged as gating PRA-9. ✅

## Appendix A — Travel-keyword allowlist (initial, S2)

Conservative starting set; tuning is O2. Single words match on word boundaries;
phrases match as contiguous substrings (§5.4).

`vacation` · `vacay` · `pto` · `ooo` · `out of office` · `out of town` ·
`out-of-town` · `traveling` · `travelling` · `on vacation` · `annual leave` ·
`on leave` · `trip to` · `road trip` · `holidays` (plural only)

**Excluded on purpose** (false-positive risk): bare `holiday`, bare `leave`,
bare `away`, bare `trip`, `party`, `remote`. Add only with a test case in §6.

## Appendix B — Presence deny-list (overrides all matches, Q4/C3)

`wfh` · `w/f/h` · `work from home` · `working from home` · `home office` ·
`remote day` · `in office` · `in the office` · `on-site` · `onsite` · `back in town`

Any event whose title matches a deny-list entry is disqualified from asserting
`out_of_town`, even a native OOO (S1). Per D-A it still never asserts `in_town`.
