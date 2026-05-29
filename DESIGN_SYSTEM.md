# InTown Visual System — Foundations (Desktop Web Refresh)

> First-pass visual system for the desktop web refresh (DES-39). It defines the
> typography, color, spacing, elevation, and component principles that express a
> **warm, social, distinctly InTown** identity, and is specific enough to guide
> consistent rollout across the in-scope surfaces (heatmap home, friends, my
> calendar, profile, auth).

All tokens live in [`theme/`](theme/) and are imported from a single entry
point:

```ts
import { colors, typography, fontFamilies, spacing, radius, shadows } from '../theme';
```

Build screens by composing tokens — **never hard-code a hex value, font name,
pixel radius, or shadow** in a component. If something you need isn't a token,
add it here and to `theme/` first, then use it.

---

## 1. Identity & principles

InTown is about the warmth of knowing who's around. The interface should feel
like a sunlit room, not a dashboard.

1. **Warm, not clinical.** Cream paper backgrounds and a coral accent over the
   cool greys of a typical SaaS calendar. White is reserved for cards that
   should lift off the page.
2. **Editorial headers, quiet UI.** Fraunces (a soft serif) carries display and
   calendar headings for personality; Inter carries everything functional so
   dense information stays legible.
3. **One confident accent.** Coral (`brand.primary`) marks the single most
   important action or the active state on a surface. Overusing it cheapens it.
4. **The heatmap is the hero.** On the home surface, hierarchy bends toward the
   availability heatmap; surrounding chrome recedes.
5. **Calm motion, honest states.** Transitions are short and eased; every
   surface has explicit loading, empty, and hover/focus states.
6. **Accessible by default.** Body text ≥ 14px, visible focus rings, and color
   is never the only signal (counts/labels accompany the heatmap ramp).

---

## 2. Color

Source: [`theme/colors.ts`](theme/colors.ts). Values are warm-biased (paper +
coral) rather than neutral grey.

### Surfaces & ink

| Token | Hex | Use |
| --- | --- | --- |
| `background.primary` | `#FAF7F2` | App canvas (warm paper) |
| `background.secondary` | `#F2EDE4` | Recessed areas, inset cells, hover fills on paper |
| `background.card` | `#FFFFFF` | Cards/modals that lift off the canvas |
| `text.primary` | `#1F1B16` | Headings & primary copy (warm near-black) |
| `text.secondary` | `#5C544A` | Supporting copy, labels |
| `text.tertiary` | `#9B9388` | Meta, placeholders, disabled |
| `border.subtle` | `#E8E2D6` | Card edges, dividers |
| `border.default` | `#D4CCBC` | Inputs, pills, stronger separation |

### Brand (coral accent)

| Token | Hex | Use |
| --- | --- | --- |
| `brand.primary` | `#E94E77` | Primary buttons, active nav/filter, focus ring |
| `brand.primaryHover` | `#D63D66` | Hover/pressed on primary |
| `brand.primarySoft` | `#FCE7EE` | Tinted backgrounds: chips, ghost-button hover, accent wells |

Use exactly one primary action per view. `brand.primarySoft` is the only
approved low-emphasis way to carry the accent into a fill.

### Heatmap ramp

The availability ramp runs **warm = more friends in town → cool = fewer**, which
keeps "good news" (a full town) glowing and is distinct from a generic
green→red scale. Buckets and labels are exported as `HEATMAP_SCALE` from
[`lib/heatmap.ts`](lib/heatmap.ts) so the legend and the cells stay in sync.

| Token | Hex | Ratio in-town | Legend label |
| --- | --- | --- | --- |
| `heatmap.high` | `#86A789` | ≥ 0.8 | Most around |
| `heatmap.mediumHigh` | `#E8C547` | ≥ 0.6 | Lots around |
| `heatmap.mediumLow` | `#D08C5C` | ≥ 0.4 | Some around |
| `heatmap.low` | `#C45A4D` | > 0 | Few around |
| `heatmap.empty` | `#F2EDE4` | no friends / no data | — |

Cells always pair the color with a number ("3 in town"); never rely on hue
alone.

### Status (friend availability)

Codified from the previously ad-hoc pills so every surface reads availability
the same way. Each entry is a `{ text, bg }` pair.

| Token | Text | Background | Meaning |
| --- | --- | --- | --- |
| `status.inTown` | `#4D6A50` | `rgba(134,167,137,0.20)` | In town |
| `status.away` | `#8A3B32` | `rgba(196,90,77,0.18)` | Away / out of town |
| `status.neutral` | `text.tertiary` | `rgba(120,113,108,0.12)` | Unknown / not shared |

---

## 3. Typography

Source: [`theme/typography.ts`](theme/typography.ts). Two families, loaded in
[`app/_layout.tsx`](app/_layout.tsx).

- **Fraunces** (`fontFamilies.fraunces`) — soft serif for display headings, the
  big month label, and day numbers. Personality lives here.
- **Inter** (`fontFamilies.inter`) — UI sans for body, labels, captions, and all
  dense/functional text.

| Role | Token | Size / line | Family |
| --- | --- | --- | --- |
| Display L | `typography.display.large` | 48 / 56 | Fraunces SemiBold |
| Display M | `typography.display.medium` | 32 / 38 | Fraunces SemiBold |
| Display S | `typography.display.small` | 24 / 30 | Fraunces Medium |
| Body L | `typography.body.large` | 18 / 26 | Inter Regular |
| Body | `typography.body.default` | 16 / 24 | Inter Regular |
| Body S | `typography.body.small` | 14 / 20 | Inter Regular |
| Label | `typography.label` | 13 / 18, +0.5 tracking | Inter Medium |
| Caption | `typography.caption` | 12 / 16 | Inter Regular |
| Calendar / month | `typography.calendar.month` | 36 / 42, −0.8 tracking | Fraunces SemiBold |
| Calendar / weekday | `typography.calendar.weekday` | 11, +1.4, uppercase | Inter Medium |
| Calendar / day number | `typography.calendar.dayNumber` | 28, tabular-nums | Fraunces Medium |
| Calendar / meta | `typography.calendar.meta` | 11, uppercase | Inter Medium |

Guidelines: one Display element per view (the page's reason for being); never
stack two serif sizes adjacently; keep body copy at Body or Body S; uppercase
only via the `label`/`weekday`/`meta` tokens that bake in tracking.

---

## 4. Spacing & radius

**Spacing** ([`theme/spacing.ts`](theme/spacing.ts)) is a 4px-based step scale —
always reference `spacing[n]`, don't invent in-between pixel values.

| Step | px | Typical use |
| --- | --- | --- |
| `spacing[1]` | 4 | Icon ↔ label gaps |
| `spacing[2]` | 8 | Tight stacks, pill padding |
| `spacing[3]` | 12 | Control padding, grid gaps |
| `spacing[4]` | 16 | Card padding, default gap |
| `spacing[5]` | 24 | Section spacing |
| `spacing[6]` | 32 | Page gutters, large gaps |
| `spacing[7]` | 48 | Top-of-screen breathing room |
| `spacing[8]` | 64 | Hero / section separation |

**Radius** ([`theme/radius.ts`](theme/radius.ts)): `sm` 8 (chips, inner tiles),
`md` 12 (inputs, cells, buttons), `lg` 16 (cards, modals), `full` 999 (pills,
avatars). Nest smaller radii inside larger surfaces.

**Layout width.** Centered content columns cap at a `maxWidth` (≈800 for lists,
≈1200 for the calendar) and self-center, so desktop never stretches lines to
unreadable widths.

---

## 5. Elevation (shadows)

Source: [`theme/shadows.ts`](theme/shadows.ts). Shadows are soft and warm-tinted
(cast in `#1F1B16` at low opacity), never hard black. Elevation maps to intent:

| Token | Use |
| --- | --- |
| `shadows.sm` | Resting cards, cells, pills |
| `shadows.md` | Hovered/raised cards, today cell |
| `shadows.lg` | Popovers, the empty-state card |
| `shadows.xl` | Modals / day-detail overlay |

Raise by one step on hover; don't combine borders + heavy shadows on the same
element (pick the one that fits the surface's elevation).

---

## 6. Component principles

- **Cards** — `background.card`, `radius.lg`, 1px `border.subtle`, `shadows.sm`,
  `spacing[5]` padding. The standard container for a discrete chunk of content.
- **Buttons** ([`components/Button.tsx`](components/Button.tsx)) — `primary`
  (coral fill, white text), `secondary` (card fill, `border.default`),
  `destructive`. `radius.md`, ≥44px tall, hover raises elevation / deepens fill.
  One primary per view.
- **Pills / filters / chips** — `radius.full`. Selected = coral fill + white
  text; unselected = card fill + `border.default`; hover = `background.secondary`
  (on paper) or `brand.primarySoft` (for accent chips).
- **Inputs** — `radius.md`, 1px `border.default`, `background.secondary` or card
  fill; focus shows the coral ring. Always pair with a `label`-token field name.
- **Modals / overlays** — centered `background.card` at `radius.lg`/`shadows.xl`
  over a warm scrim (`rgba(31,27,22,~0.45)`); close affordance top-right; Escape
  closes on web.
- **Focus** — use `colors.focusRing` (coral). The web focus-visible ring is
  injected globally in `app/_layout.tsx`; native relies on platform handling.
- **States** — every data surface ships loading (skeleton), empty (illustrated
  prompt with a single primary action), and interactive hover/pressed states.

---

## 7. Using & extending the system

- Import tokens from `../theme`; compose them in `StyleSheet.create`.
- Need a value that isn't a token? Add it to the relevant `theme/` file **and**
  document it here in the same change, then consume the token. No raw literals
  in components.
- Keep additions **semantic** (`status.away`) rather than literal
  (`red`) so the palette can evolve in one place.
