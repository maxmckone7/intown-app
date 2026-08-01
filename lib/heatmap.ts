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
 * Resolve the set of friend ids in scope for a group selection, guarding
 * against the two ways the inputs can be dirty:
 *
 *   1. Membership drift — `friend_groups.friend_ids` is a denormalized array
 *      that can still list someone you've since removed. A stale member has no
 *      visibility rule and no calendar entry, so downstream it would default to
 *      "in town" and inflate the count, disagreeing with the day-detail list
 *      (which already intersects membership with the friend set). So we
 *      intersect the group's membership with the current accepted-friends set.
 *      See PRA-25.
 *   2. Duplicate ids — a doubled id in either array would otherwise be counted
 *      twice. We collapse to a set so each friend contributes at most once.
 *
 * Pass `groupFriendIds` as null/undefined for the "all friends" (unscoped)
 * selection. Note that an *empty* array is deliberately NOT the same as
 * null: an empty group scopes to nobody, whereas null means no scoping.
 */
export function scopeFriendIds(
  allFriendIds: Iterable<string>,
  groupFriendIds?: Iterable<string> | null
): string[] {
  const friendSet = new Set(allFriendIds);
  if (groupFriendIds == null) {
    return [...friendSet];
  }

  const scoped = new Set<string>();
  for (const friendId of groupFriendIds) {
    if (friendSet.has(friendId)) {
      scoped.add(friendId);
    }
  }
  return [...scoped];
}

/**
 * Compute the in-town friend density for a single date from the existing
 * Calendar (per-date statuses) and In/Out Status (visibility) signals — the
 * core PRA-27 aggregation. Pure and deterministic: the same inputs always
 * produce the same `HeatmapDayData`, independent of iteration order, wall
 * clock, or how sparse the data is.
 *
 * `scopedFriendIds` should already be group-resolved (see `scopeFriendIds`).
 * `statusesForDate` is the map of friend id -> status for THIS date; it is
 * optional because most dates have no entries at all — an empty/undefined map
 * is the common "empty date" case, not an error. Friends hidden from the viewer
 * drop out of both the count and the denominator; everyone else is counted per
 * their shared visibility level.
 */
export function aggregateDayDensity(
  date: string,
  scopedFriendIds: Iterable<string>,
  visibility: ReadonlyMap<string, VisibilityLevel>,
  statusesForDate?: ReadonlyMap<string, CalendarStatus>
): HeatmapDayData {
  const counted = new Set<string>();
  let friendsInTown = 0;
  let totalFriends = 0;

  for (const friendId of scopedFriendIds) {
    // Defensive dedupe so a repeated id can't be counted twice, even if the
    // caller passed a raw array rather than a scoped set.
    if (counted.has(friendId)) continue;
    counted.add(friendId);

    const level = visibility.get(friendId);
    if (!isFriendVisible(level)) continue;

    totalFriends += 1;
    if (isFriendInTown(level, statusesForDate?.get(friendId))) {
      friendsInTown += 1;
    }
  }

  return { date, friendsInTown, totalFriends };
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
