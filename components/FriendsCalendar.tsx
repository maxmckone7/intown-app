import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfToday,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import {
  getHeatmapColor,
  getMockDayData,
  HeatmapDayData,
} from '../lib/heatmap';
import Button from './Button';
import GroupFilter from './GroupFilter';
import ManageGroupsModal from './ManageGroupsModal';
import { useGroups } from '../lib/groups-store';
import { FriendWithStatus } from '../lib/types';

type Props = {
  friends: FriendWithStatus[];
  /** Optional override — pass real aggregated data per ISO date once
   *  the Supabase query lands. Mock data is used when undefined. */
  getDayData?: (isoDate: string) => HeatmapDayData;
  onDayPress?: (isoDate: string) => void;
  onAddFriendsPress?: () => void;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

export default function FriendsCalendar({
  friends,
  getDayData,
  onDayPress,
  onAddFriendsPress,
}: Props) {
  const today = startOfToday();
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(today));
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [manageOpen, setManageOpen] = useState(false);
  const storeGroups = useGroups();

  const filterGroups = useMemo(
    () => [
      { id: 'all', label: 'All friends' },
      ...storeGroups.map((g) => ({ id: g.id, label: g.name })),
    ],
    [storeGroups]
  );

  // If the active group disappears (deleted from the manage modal),
  // fall back to "All friends" so the grid stays in a valid state.
  useEffect(() => {
    if (
      selectedGroupId !== 'all' &&
      !storeGroups.some((g) => g.id === selectedGroupId)
    ) {
      setSelectedGroupId('all');
    }
  }, [storeGroups, selectedGroupId]);

  const visibleDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  const goPrev = () => setViewMonth((d) => subMonths(d, 1));
  const goNext = () => setViewMonth((d) => addMonths(d, 1));
  const goToday = () => setViewMonth(startOfMonth(today));

  const totalFriends = friends.length;
  const isEmpty = totalFriends <= 0;

  const handleDayPress = (iso: string) => {
    if (onDayPress) onDayPress(iso);
    // DES-14 will replace this console.log with a real day-detail modal
    // eslint-disable-next-line no-console
    console.log('day pressed:', iso);
  };

  return (
    <View style={styles.outer}>
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <View />
          <Pressable
            onPress={goToday}
            style={({ pressed, hovered }: any) => [
              styles.todayPill,
              (pressed || hovered) && styles.todayPillHover,
            ]}
          >
            <Text style={styles.todayPillText}>Today</Text>
          </Pressable>
        </View>

        <View style={styles.monthRow}>
          <Pressable
            onPress={goPrev}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            style={({ pressed, hovered }: any) => [
              styles.monthArrow,
              (pressed || hovered) && styles.monthArrowHover,
            ]}
          >
            <Text style={styles.monthArrowGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{format(viewMonth, 'MMMM yyyy')}</Text>
          <Pressable
            onPress={goNext}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            style={({ pressed, hovered }: any) => [
              styles.monthArrow,
              (pressed || hovered) && styles.monthArrowHover,
            ]}
          >
            <Text style={styles.monthArrowGlyph}>›</Text>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          <GroupFilter
            groups={filterGroups}
            selectedGroupId={selectedGroupId}
            onSelect={setSelectedGroupId}
            onManagePress={() => setManageOpen(true)}
          />
        </View>

        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((day) => (
            <Text key={day} style={styles.weekdayLabel}>
              {day.toUpperCase()}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {visibleDays.map((date) => {
            const iso = ISO(date);
            const inMonth = isSameMonth(date, viewMonth);
            const todayCell = isSameDay(date, today);
            const data = getDayData
              ? getDayData(iso)
              : getMockDayData(
                  iso,
                  totalFriends,
                  selectedGroupId === 'all' ? undefined : selectedGroupId
                );
            const bg = getHeatmapColor(data.friendsInTown, data.totalFriends);
            const dayNumber = format(date, 'd');

            return (
              <Pressable
                key={iso}
                onPress={() => handleDayPress(iso)}
                style={({ pressed, hovered }: any) => [
                  styles.cell,
                  { backgroundColor: bg },
                  !inMonth && styles.cellOutsideMonth,
                  todayCell && styles.cellToday,
                  (pressed || hovered) && styles.cellHover,
                ]}
              >
                <Text style={styles.dayNumber}>{dayNumber}</Text>
                {!isEmpty && (
                  <Text style={styles.friendCount} numberOfLines={1}>
                    {data.friendsInTown} in town
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {isEmpty && (
          <View pointerEvents="box-none" style={styles.emptyOverlay}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Add friends to see the heat map come alive
              </Text>
              <Text style={styles.emptyBody}>
                Once you follow friends, every day lights up based on who's
                around.
              </Text>
              <Button
                label="Add Friends"
                variant="primary"
                onPress={onAddFriendsPress}
                style={styles.emptyButton}
              />
            </View>
          </View>
        )}
      </View>
      <ManageGroupsModal
        visible={manageOpen}
        friends={friends}
        onClose={() => setManageOpen(false)}
      />
    </View>
  );
}

const CELL_HEIGHT = 100;
const CELL_GAP = spacing[2];

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    paddingTop: spacing[7],
    paddingBottom: spacing[8],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 1200,
    position: 'relative',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  filterRow: {
    marginBottom: spacing[4],
  },
  todayPill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  todayPillHover: {
    backgroundColor: colors.background.secondary,
  },
  todayPillText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.primary,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  monthArrow: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowHover: {
    backgroundColor: colors.background.secondary,
  },
  monthArrowGlyph: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  monthLabel: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.large.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    minWidth: 280,
    textAlign: 'center',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: spacing[2],
    gap: CELL_GAP,
  },
  weekdayLabel: {
    flex: 1,
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CELL_GAP,
  },
  cell: {
    width: `${(100 - 6 * 1) / 7}%`, // approximate; gap handles the rest on web
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: `${(100 - 6) / 7}%`,
    height: CELL_HEIGHT,
    borderRadius: radius.md,
    padding: spacing[2],
    justifyContent: 'space-between',
  },
  cellOutsideMonth: {
    opacity: 0.4,
  },
  cellToday: {
    borderWidth: 2,
    borderColor: colors.brand.primary,
    ...shadows.md,
  },
  cellHover: {
    transform: [{ scale: 1.02 }],
    ...shadows.md,
  },
  dayNumber: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.large.fontSize,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  friendCount: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.85)',
    alignSelf: 'flex-end',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[5],
    maxWidth: 380,
    alignItems: 'center',
    ...shadows.lg,
  },
  emptyTitle: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  emptyBody: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing[4],
    lineHeight: 22,
  },
  emptyButton: {
    minWidth: 160,
  },
});
