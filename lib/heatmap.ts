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

/**
 * Deterministic hash → number in [0, 1).
 * Same input date always yields the same output, so the heatmap is
 * stable across renders and month navigations.
 */
function hashDate(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to unsigned 32-bit, then to [0, 1)
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Mock data generator — produces a stable HeatmapDayData per
 * (group, ISO date) pair.
 *
 * `groupId` folds into the hash so selecting a different group from
 * the GroupFilter (DES-15) visibly recolors the grid. When omitted,
 * behaves like the original DES-13 mock for "all friends".
 *
 * TODO: replace with a real Supabase query that aggregates friend
 * availability per day, scoped by selected group. The component
 * should keep working unchanged once `friendsInTown`/`totalFriends`
 * come from the server.
 */
export function getMockDayData(
  isoDate: string,
  totalFriends: number,
  groupId?: string
): HeatmapDayData {
  if (totalFriends <= 0) {
    return { date: isoDate, friendsInTown: 0, totalFriends: 0 };
  }
  const seed = groupId ? `${groupId}|${isoDate}` : isoDate;
  const ratio = hashDate(seed);
  const friendsInTown = Math.round(ratio * totalFriends);
  return { date: isoDate, friendsInTown, totalFriends };
}
