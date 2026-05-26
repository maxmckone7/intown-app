export const colors = {
  heatmap: {
    high: '#86A789',
    mediumHigh: '#E8C547',
    mediumLow: '#D08C5C',
    low: '#C45A4D',
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
