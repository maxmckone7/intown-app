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

/**
 * Returns the heatmap color token for a given day based on the
 * ratio of friends in town. Mirrors the buckets in DES-11.
 *
 * If totalFriends is 0, returns the neutral background.secondary so
 * the cell is visible but recedes (the empty state owns the messaging).
 */
export function getHeatmapColor(
  friendsInTown: number,
  totalFriends: number
): string {
  if (totalFriends <= 0) return colors.background.secondary;

  const ratio = friendsInTown / totalFriends;
  if (ratio >= 0.8) return colors.heatmap.high;
  if (ratio >= 0.6) return colors.heatmap.mediumHigh;
  if (ratio >= 0.4) return colors.heatmap.mediumLow;
  return colors.heatmap.low;
}
