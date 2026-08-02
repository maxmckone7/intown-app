import { describe, expect, it } from '@jest/globals';

import {
  contrastRatio,
  cvdLuminance,
  CVD_TYPES,
  isStrictlyDecreasing,
  relativeLuminance,
} from '../test/support/color';
import { colors } from './colors';

const { heatmap, background } = colors;

// The density ramp, ordered coolest -> hottest by count of friends in town,
// paired with the foreground token each bucket uses in getHeatmapColors. Kept
// in sync with lib/heatmap.ts; edits to either the hexes or the pairing must
// keep every assertion below true.
const BUCKETS = [
  { name: 'none', bg: heatmap.none, fg: heatmap.textDark },
  { name: 'few', bg: heatmap.few, fg: heatmap.textDark },
  { name: 'some', bg: heatmap.some, fg: heatmap.textDark },
  { name: 'many', bg: heatmap.many, fg: heatmap.textLight },
] as const;

const WCAG_AA_NORMAL = 4.5;
const MIN_BG_SEPARATION = 1.3;

describe('heat-map palette: foreground contrast', () => {
  it.each(BUCKETS)(
    '$name text clears WCAG AA (4.5:1) on its cell',
    ({ bg, fg }) => {
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    }
  );
});

describe('heat-map palette: separation from the page background', () => {
  it.each(BUCKETS)(
    '$name cell is distinguishable (>= 1.3:1) from the page background',
    ({ bg }) => {
      expect(contrastRatio(bg, background.primary)).toBeGreaterThanOrEqual(
        MIN_BG_SEPARATION
      );
    }
  );
});

describe('heat-map palette: luminance is monotonic without hue', () => {
  const ordered = BUCKETS.map((b) => b.bg);

  it('is strictly decreasing in grayscale luminance from none -> many', () => {
    const lums = ordered.map(relativeLuminance);
    expect(isStrictlyDecreasing(lums)).toBe(true);
  });

  it.each(CVD_TYPES)(
    'stays strictly rankable by lightness under %s',
    (type) => {
      const lums = ordered.map((bg) => cvdLuminance(bg, type));
      expect(isStrictlyDecreasing(lums)).toBe(true);
    }
  );
});
