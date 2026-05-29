export const colors = {
  heatmap: {
    high: '#86A789',
    mediumHigh: '#E8C547',
    mediumLow: '#D08C5C',
    low: '#C45A4D',
    // Neutral fill for days with no friends / no data (matches the recessed
    // paper surface so empty days recede). See DESIGN_SYSTEM.md §2.
    empty: '#F2EDE4',
  },
  background: {
    primary: '#FAF7F2',
    secondary: '#F2EDE4',
    card: '#FFFFFF',
  },
  text: {
    primary: '#1F1B16',
    secondary: '#5C544A',
    tertiary: '#9B9388',
  },
  border: {
    subtle: '#E8E2D6',
    default: '#D4CCBC',
  },
  brand: {
    primary: '#E94E77',
    primaryHover: '#D63D66',
    // Low-emphasis coral tint for chips, ghost-button hover, accent wells.
    primarySoft: '#FCE7EE',
  },
  // Friend availability pills/badges. text = ink, bg = tinted fill.
  status: {
    inTown: { text: '#4D6A50', bg: 'rgba(134, 167, 137, 0.2)' },
    away: { text: '#8A3B32', bg: 'rgba(196, 90, 77, 0.18)' },
    neutral: { text: '#9B9388', bg: 'rgba(120, 113, 108, 0.12)' },
  },
  // Focus-visible ring (web) and any explicit focus affordance.
  focusRing: '#E94E77',
} as const;

export type Colors = typeof colors;
