export const colors = {
  // Sequential density scale for the friends heat map. Ordered coolest -> hottest
  // by *count of friends in town*. The ramp is monotonic in luminance so density
  // survives grayscale and red/green/blue color-vision deficiencies (the buckets
  // stay rankable by lightness alone), and each `text*` token clears WCAG 4.5:1 on
  // its paired cells. See lib/heatmap.ts for the bucket thresholds. (PRA-23 / DES-11)
  heatmap: {
    none: '#EAD3A6', // 0 friends in town
    few: '#F0B267', // 1-2
    some: '#DC7C3F', // 3-5
    many: '#AE3F28', // 6+
    textDark: '#1F1B16', // foreground for none/few/some
    textLight: '#FFF7EE', // foreground for many
  },
  // Semantic in-town / away colors (green = around, red = away). Used by the
  // user's own availability calendar and positive toasts.
  status: {
    inTown: '#86A789',
    outOfTown: '#C45A4D',
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
  },
} as const;

export type Colors = typeof colors;
