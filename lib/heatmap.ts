import { colors } from '../theme';

export type HeatmapDayData = {
  date: string; // YYYY-MM-DD
  friendsInTown: number;
  totalFriends: number;
};

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
