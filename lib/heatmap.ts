import { colors } from '../theme';
import { CalendarStatus, VisibilityLevel } from './types';

export type HeatmapDayData = {
  date: string; // YYYY-MM-DD
  friendsInTown: number;
  totalFriends: number;
};

/**
 * Whether a friend should appear in the viewer's calendar at all. Friends who
 * set you to 'hidden' (or who are appearing away) are dropped from both the
 * in-town count and the denominator.
 */
export function isFriendVisible(level: VisibilityLevel | undefined): boolean {
  return (level ?? 'full') !== 'hidden';
}

/**
 * Whether a (visible) friend counts as "in town" on a day, honoring their
 * shared visibility level:
 *   full    - optimistic: in town unless they explicitly marked out_of_town
 *   limited - only counts when they explicitly marked in_town (away days are
 *             private, so we must NOT assume they're around)
 *   hidden  - never
 */
export function isFriendInTown(
  level: VisibilityLevel | undefined,
  status: CalendarStatus | undefined
): boolean {
  const resolved = level ?? 'full';
  if (resolved === 'hidden') return false;
  if (resolved === 'limited') return status === 'in_town';
  return status !== 'out_of_town';
}

export type HeatmapCellColors = {
  /** Cell background. */
  background: string;
  /** Legible text color for this cell (day number + count), >= WCAG 4.5:1. */
  foreground: string;
};

/**
 * Returns the background + foreground colors for a day cell based on the
 * *count* of friends in town — the literal "density of in-town friends"
 * this view exists to show (PRA-23 / DES-11).
 *
 * Density is keyed on the absolute count, not the in-town/total ratio: one
 * friend around is low density whether you follow 1 friend or 50, so a lone
 * friend never reads "hotter" than a day with several friends around.
 *
 * If totalFriends is 0 the viewer follows nobody, so we return the neutral
 * background.secondary (with primary text) — the empty state owns the messaging
 * and the cell recedes. A day where friends *are* followed but none are in town
 * still gets the coolest heat tone so it reads as data, not emptiness.
 */
export function getHeatmapColors(
  friendsInTown: number,
  totalFriends: number
): HeatmapCellColors {
  if (totalFriends <= 0) {
    return {
      background: colors.background.secondary,
      foreground: colors.text.primary,
    };
  }

  if (friendsInTown >= 6) {
    return { background: colors.heatmap.many, foreground: colors.heatmap.textLight };
  }
  if (friendsInTown >= 3) {
    return { background: colors.heatmap.some, foreground: colors.heatmap.textDark };
  }
  if (friendsInTown >= 1) {
    return { background: colors.heatmap.few, foreground: colors.heatmap.textDark };
  }
  return { background: colors.heatmap.none, foreground: colors.heatmap.textDark };
}
