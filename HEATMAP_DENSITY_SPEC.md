# Heat Map Density Rules & Color Scale

Reference spec for the friends calendar heat map. Defines how the count of
in-town friends on a date maps to a density tier, how each tier is treated
visually, and the accessibility guarantees the color scale must hold.

- **Issue:** PRA-28 — Define heat map density rules and color scale
- **Project:** Heat Map View
- **Implemented by:** `lib/heatmap.ts` (`getHeatmapColors`), `theme/colors.ts`
  (`colors.heatmap`); consumed by `components/HeatmapCalendar.tsx` and
  `components/FriendsCalendar.tsx`. This document is the source of truth for the
  *rules*; the code is the source of truth for the *values*, and the two must
  agree.
- **Traceability:** PRD → Overview, Goals, Non-functional requirements, Open
  questions. Resolves the PRD open question *"What exact color scale should be
  used for low-to-high density?"*

## 1. What density means

Density is keyed on the **absolute count of friends in town on a date**, not the
in-town/total ratio. Rationale: one friend around is low density whether you
follow 1 friend or 50, so a lone friend must never read "hotter" than a date
with several friends around. This keeps coloring comparable across riders with
very different friend-list sizes (PRD: *Goals* — "Make high-density and
low-density dates visually obvious").

The count is produced by the existing group-scoped aggregation (`getDayData`),
which reuses friend availability signals rather than introducing a separate
source of truth (PRD: *In scope*, *Dependencies*). Who counts as "in town" on a
date honors each friend's shared visibility level and is defined in
`lib/heatmap.ts` (`isFriendVisible` / `isFriendInTown`); it is out of scope for
this document, which starts from the resolved count.

## 2. Density tiers

Four density tiers plus one non-data state. Thresholds are inclusive lower
bounds; a date lands in the highest tier whose threshold it meets.

| Tier       | In-town friend count | Token            | Meaning                          |
| ---------- | -------------------- | ---------------- | -------------------------------- |
| None       | `0`                  | `heatmap.none`   | Friends followed, none in town   |
| Few        | `1–2`                | `heatmap.few`    | A couple of friends around       |
| Some       | `3–5`                | `heatmap.some`   | A handful around                 |
| Many       | `6+`                 | `heatmap.many`   | Dense — several friends around   |
| No friends | `totalFriends == 0`  | *(neutral)*      | Viewer follows nobody yet        |

**Boundary rules**

- The tiers are `[0,0]`, `[1,2]`, `[3,5]`, `[6,∞)`. There is no upper cap: a date
  with 6 friends and a date with 60 share the `Many` treatment. Density is a
  scanning aid, not a precise readout — the exact number is available on tap
  (day detail, PRA-24).
- **None vs. No-friends are distinct.** A date where friends *are* followed but
  none are in town (`count == 0`, `totalFriends > 0`) still gets the coolest
  *heat* tone (`heatmap.none`) so it reads as data. Only when the viewer follows
  nobody (`totalFriends == 0`) does the cell fall back to a neutral, non-heat
  background (`background.secondary` + `text.primary`) and recede — the empty
  state owns that messaging, not the cell.
- Density calculations are pure functions of the count and are deterministic:
  identical inputs always produce identical treatment (PRD: *Non-functional
  requirements* — "Density calculations must be consistent for identical
  inputs").

### Why these cutoffs

The buckets are deliberately coarse (4 heat levels) so tiers are separable at a
glance and at small cell sizes in the GitHub-contributions-style grid; more
levels would blur together. The `1–2 / 3–5 / 6+` split gives roughly
even perceptual steps for typical friend-list sizes while keeping "a lone
friend" (`Few`) visibly cooler than "a real cluster" (`Many`). If a rider base
with much larger friend lists shifts the useful range, re-tune the thresholds in
`getHeatmapColors` and the swatch count here together — the tier *rules* live in
one function so the month grid, heat map grid, and legend stay consistent.

## 3. Count → visual treatment

Each tier maps to a cell **background** and a paired **foreground** (day number
and, where shown, the count). Values are the `colors.heatmap.*` tokens in
`theme/colors.ts`.

| Tier       | Background          | Foreground token      | Foreground hex |
| ---------- | ------------------- | --------------------- | -------------- |
| None       | `#EAD3A6`           | `heatmap.textDark`    | `#1F1B16`      |
| Few        | `#F0B267`           | `heatmap.textDark`    | `#1F1B16`      |
| Some       | `#DC7C3F`           | `heatmap.textDark`    | `#1F1B16`      |
| Many       | `#AE3F28`           | `heatmap.textLight`   | `#FFF7EE`      |
| No friends | `#F2EDE4` (`background.secondary`) | `text.primary` | `#1F1B16` |

The ramp runs **coolest → hottest by count** (pale sand → warm amber → burnt
orange → deep red-brown). Foreground flips from dark ink to warm off-white at the
`Many` tier, where the background is dark enough that dark text would fail
contrast.

**Legend.** The heat map view renders these four swatches in tier order between a
`Fewer` and `More` label so the scale is self-documenting
(`components/HeatmapCalendar.tsx`). The legend shows only the four *heat* tiers;
the neutral no-friends state is not a density level and is not in the legend.

## 4. Accessibility & contrast expectations

The scale must satisfy these properties. They are enforced by the token values
in `theme/colors.ts`; changing any heatmap color requires re-checking all of
them. Ratios below are computed with the WCAG 2.x relative-luminance formula.

### 4.1 Text legibility — every cell clears WCAG AA (≥ 4.5:1)

Foreground/background pairing per tier is chosen so text on every cell clears the
AA threshold for normal-size text:

| Pair                                | Contrast | AA (4.5:1) |
| ----------------------------------- | -------- | ---------- |
| `none` `#EAD3A6` / ink `#1F1B16`    | 11.71:1  | ✅ (also AAA) |
| `few` `#F0B267` / ink `#1F1B16`     | 9.19:1   | ✅ (also AAA) |
| `some` `#DC7C3F` / ink `#1F1B16`    | 5.71:1   | ✅         |
| `many` `#AE3F28` / off-white `#FFF7EE` | 5.59:1 | ✅         |
| no-friends `#F2EDE4` / `#1F1B16`    | 14.68:1  | ✅ (also AAA) |

This is the "must remain legible and accessible" requirement from the PRD
*Non-functional requirements*. AA is the bar; the cooler tiers clear AAA (7:1)
comfortably. The two warm tiers sit at ~5.6:1 — above AA but the tightest in the
scale, so treat them as the constraint when adjusting either warm swatch.

### 4.2 Density survives grayscale and color-vision deficiency

The ramp is **monotonic in luminance** — lightness strictly decreases as count
increases — so the tiers stay rank-orderable by brightness alone, without relying
on hue. This means density reads correctly in grayscale and under
red/green/blue color-vision deficiencies (the failure mode a warm sand→red ramp
would otherwise have).

| Tier | Relative luminance |
| ---- | ------------------ |
| None | 0.668 |
| Few  | 0.514 |
| Some | 0.300 |
| Many | 0.127 |

Because lightness alone encodes density, hue is redundant reinforcement, not the
sole channel — this is the "clear visual contrast" requirement (PRD:
*Non-functional requirements*). Any re-tune must preserve strict monotonic
descent here.

### 4.3 Adjacent tiers are distinguishable

Neighboring buckets differ enough in luminance to be told apart, with separation
widening toward the hot end:

| Step         | Background contrast |
| ------------ | ------------------- |
| None → Few   | 1.27:1 |
| Few → Some   | 1.61:1 |
| Some → Many  | 1.98:1 |

These are intentionally modest (a sequential ramp *should* step smoothly), but
combined with §4.2's monotonic luminance they keep tiers separable. Do not
compress them further.

### 4.4 Non-color cues

Color is never the only signal. The exact count is one tap away (day detail,
PRA-24), the legend labels direction in words (`Fewer` / `More`), and the day
number is always present on the cell. Riders who cannot distinguish two adjacent
tiers by color can still resolve density through these channels.

## 5. Change checklist

When editing any `colors.heatmap.*` value or a threshold in `getHeatmapColors`:

1. Keep the tier rules in `getHeatmapColors` as the single source — the month
   grid, heat map grid, and legend all read from it.
2. Re-verify every row in §4.1 stays ≥ 4.5:1.
3. Re-verify §4.2 luminance stays strictly monotonic by count.
4. Update the tables in §2–§4 so this doc and the code still agree.
5. Keep the legend swatch count equal to the number of heat tiers.
