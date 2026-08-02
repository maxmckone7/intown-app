import { describe, expect, it } from '@jest/globals';

import { colors } from '../theme';
import { getHeatmapColors } from './heatmap';

const { heatmap, background, text } = colors;

// Expected cell colors per density bucket, derived from the theme tokens so
// these expectations track the palette rather than hard-coding hexes.
const NONE = { background: heatmap.none, foreground: heatmap.textDark };
const FEW = { background: heatmap.few, foreground: heatmap.textDark };
const SOME = { background: heatmap.some, foreground: heatmap.textDark };
const MANY = { background: heatmap.many, foreground: heatmap.textLight };
const NEUTRAL = { background: background.secondary, foreground: text.primary };

describe('getHeatmapColors bucketing', () => {
  // friendsInTown, totalFriends, expected bucket, label
  const cases: Array<[number, number, typeof NONE, string]> = [
    [0, 8, NONE, '0 in town -> none'],
    [1, 8, FEW, '1 (lower boundary) -> few'],
    [2, 8, FEW, '2 -> few'],
    [3, 8, SOME, '3 (boundary) -> some'],
    [5, 8, SOME, '5 (upper) -> some'],
    [6, 8, MANY, '6 (boundary) -> many'],
    [12, 20, MANY, '12 -> many'],
  ];

  it.each(cases)('%d of %d reads %s', (inTown, total, expected) => {
    expect(getHeatmapColors(inTown, total)).toEqual(expected);
  });

  it('places the bucket boundaries at exactly 1, 3 and 6', () => {
    // One below each threshold stays in the cooler bucket; the threshold itself
    // steps up. This pins the inclusive lower boundaries against silent drift.
    expect(getHeatmapColors(0, 8)).toEqual(NONE);
    expect(getHeatmapColors(1, 8)).toEqual(FEW);
    expect(getHeatmapColors(2, 8)).toEqual(FEW);
    expect(getHeatmapColors(3, 8)).toEqual(SOME);
    expect(getHeatmapColors(5, 8)).toEqual(SOME);
    expect(getHeatmapColors(6, 8)).toEqual(MANY);
  });
});

describe('getHeatmapColors edge cases', () => {
  it('recedes to a neutral cell when the viewer follows nobody (total 0)', () => {
    expect(getHeatmapColors(0, 0)).toEqual(NEUTRAL);
  });

  it('treats a negative total as "follows nobody" and recedes', () => {
    expect(getHeatmapColors(0, -1)).toEqual(NEUTRAL);
  });

  it('gives the coolest heat tone (not neutral) when friends are followed but none are in town', () => {
    // Distinguishes "data: nobody around today" from "empty: you follow no one".
    const result = getHeatmapColors(0, 5);
    expect(result).toEqual(NONE);
    expect(result).not.toEqual(NEUTRAL);
  });

  it('guards against a negative in-town count by clamping to none', () => {
    expect(getHeatmapColors(-3, 5)).toEqual(NONE);
  });
});

describe('getHeatmapColors density is count-based, not a ratio', () => {
  it('reads a single in-town friend as "few" regardless of how many are followed', () => {
    expect(getHeatmapColors(1, 1)).toEqual(FEW);
    expect(getHeatmapColors(1, 50)).toEqual(FEW);
  });

  it('never lets one lone friend outrank several (1 of 1 < 4 of 10)', () => {
    // A ratio scale would flip these: 1/1 = 100% vs 4/10 = 40%. Density is the
    // absolute headcount, so four friends around must read hotter than one.
    expect(getHeatmapColors(1, 1)).toEqual(FEW);
    expect(getHeatmapColors(4, 10)).toEqual(SOME);
  });
});
