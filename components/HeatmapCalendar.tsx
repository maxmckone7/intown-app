import { useMemo, useRef } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from 'date-fns';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import { getHeatmapColors, HeatmapDayData } from '../lib/heatmap';
import Button from './Button';
import GroupFilter, { DEFAULT_GROUPS, FilterGroup } from './GroupFilter';
import { getCalendarLayout } from './calendarLayout';

type Props = {
  totalFriends: number;
  groups?: FilterGroup[];
  selectedGroupId?: string;
  onSelectGroup?: (groupId: string) => void;
  getDayData?: (isoDate: string, groupId: string) => HeatmapDayData;
  lastUpdatedAt?: Date | null;
  isRefreshing?: boolean;
  onDayPress?: (isoDate: string, groupId: string) => void;
  onAddFriendsPress?: () => void;
};

/**
 * Supported date range for the initial heat-map release (PRA-26; answers the
 * PRD "what date range" open question). Availability is forward-looking — the
 * value of this view is scanning *upcoming* dense dates — so the range runs
 * from the start of the current month through this many months ahead. The month
 * grid stays the tool for browsing arbitrary past months.
 */
const HEATMAP_MONTHS_AHEAD = 6;

// Sunday-first weekday rows, matching the rest of the calendar experience.
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Which rows get a gutter label. Odd rows (Mon/Wed/Fri) keep the column
// uncluttered while still orienting the reader, mirroring familiar heat maps.
const LABELED_ROWS = new Set([1, 3, 5]);

const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

type WeekColumn = {
  key: string;
  days: Date[];
  monthLabel: string;
};

export default function HeatmapCalendar({
  totalFriends,
  groups = [],
  selectedGroupId,
  onSelectGroup,
  getDayData,
  lastUpdatedAt,
  isRefreshing,
  onDayPress,
  onAddFriendsPress,
}: Props) {
  const today = useMemo(() => startOfToday(), []);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<WeekColumn>>(null);
  const layout = useMemo(
    () => getCalendarLayout(width, { left: insets.left, right: insets.right }),
    [insets.left, insets.right, width]
  );

  // Compact cells keep the whole range scannable at a glance; roomier cells on
  // wider screens stay comfortably tappable.
  const cellSize = layout.compact ? 16 : 22;
  const cellGap = layout.compact ? 3 : 4;
  const monthLabelHeight = 18;
  const columnStride = cellSize + cellGap;
  // Each cell carries a trailing marginBottom (incl. the last one), so the
  // stack is 7 full strides tall beneath the month-label row.
  const gridHeight = monthLabelHeight + columnStride * 7;

  const activeGroupId = selectedGroupId ?? 'all';
  const filterGroups = useMemo(() => [...DEFAULT_GROUPS, ...groups], [groups]);
  const selectedGroup = filterGroups.find((group) => group.id === activeGroupId);
  const selectedTotalFriends =
    activeGroupId === 'all' ? totalFriends : selectedGroup?.friendIds?.length ?? 0;
  const isEmpty = selectedTotalFriends <= 0;

  // Build the supported range as whole weeks so every column is a full 7-day
  // stack. Memoized on `today` so the column list is stable across renders.
  const weeks = useMemo<WeekColumn[]>(() => {
    const rangeStart = startOfWeek(startOfMonth(today), { weekStartsOn: 0 });
    const rangeEnd = endOfWeek(
      endOfMonth(addMonths(startOfMonth(today), HEATMAP_MONTHS_AHEAD)),
      { weekStartsOn: 0 }
    );
    const allDays = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

    const columns: WeekColumn[] = [];
    let previousMonth = -1;
    for (let i = 0; i < allDays.length; i += 7) {
      const days = allDays.slice(i, i + 7);
      const firstDay = days[0];
      const month = firstDay.getMonth();
      // Label the first column of each month (and always the very first one).
      const monthLabel =
        month !== previousMonth ? format(firstDay, 'MMM') : '';
      previousMonth = month;
      columns.push({ key: ISO(firstDay), days, monthLabel });
    }
    return columns;
  }, [today]);

  const todayWeekIndex = useMemo(() => {
    const index = weeks.findIndex((week) =>
      week.days.some((day) => isSameDay(day, today))
    );
    return index < 0 ? 0 : index;
  }, [today, weeks]);

  const getColumnLayout = (_: unknown, index: number) => ({
    length: columnStride,
    offset: columnStride * index,
    index,
  });

  const scrollToToday = () => {
    listRef.current?.scrollToIndex({
      index: todayWeekIndex,
      animated: true,
      viewPosition: 0.5,
    });
  };

  const handleDayPress = (iso: string) => {
    // Consistent with the month grid (PRA-24): tapping a date opens its detail.
    // With no friends followed there's no density to explore, so it's a no-op.
    if (isEmpty) return;
    onDayPress?.(iso, activeGroupId);
  };

  const freshnessLabel = isRefreshing
    ? 'Refreshing availability...'
    : lastUpdatedAt
      ? `Updated ${format(lastUpdatedAt, 'h:mm a')}`
      : 'Availability not updated yet';

  const renderColumn = ({ item }: { item: WeekColumn }) => (
    <View style={{ marginRight: cellGap }}>
      <View style={{ height: monthLabelHeight, justifyContent: 'flex-end' }}>
        {item.monthLabel ? (
          <Text style={styles.monthTick} numberOfLines={1}>
            {item.monthLabel}
          </Text>
        ) : null}
      </View>
      {item.days.map((date) => {
        const iso = ISO(date);
        const todayCell = isSameDay(date, today);
        const data = getDayData
          ? getDayData(iso, activeGroupId)
          : { date: iso, friendsInTown: 0, totalFriends: selectedTotalFriends };
        const { background } = getHeatmapColors(
          data.friendsInTown,
          data.totalFriends
        );
        const friendCountLabel = `${data.friendsInTown} of ${data.totalFriends} friends in town`;

        return (
          <Pressable
            key={iso}
            onPress={() => handleDayPress(iso)}
            disabled={isEmpty}
            accessibilityRole={isEmpty ? undefined : 'button'}
            accessibilityLabel={`${format(date, 'EEEE, MMM d')} - ${friendCountLabel}`}
            accessibilityHint={
              isEmpty ? undefined : 'Tap to view which friends are in town'
            }
            hitSlop={Math.max(0, Math.floor((44 - cellSize) / 2))}
            style={({ pressed, hovered }: any) => [
              styles.cell,
              {
                backgroundColor: background,
                height: cellSize,
                width: cellSize,
                marginBottom: cellGap,
              },
              todayCell && styles.cellToday,
              hovered && styles.cellHover,
              pressed && styles.cellPressed,
            ]}
          />
        );
      })}
    </View>
  );

  return (
    <View
      style={[
        styles.outer,
        {
          paddingLeft: layout.paddingLeft,
          paddingRight: layout.paddingRight,
          paddingTop: layout.compact ? spacing[4] : spacing[7],
        },
      ]}
    >
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <Text style={styles.freshnessLabel}>{freshnessLabel}</Text>
          <Pressable
            onPress={scrollToToday}
            accessibilityRole="button"
            accessibilityLabel="Scroll to today"
            style={({ pressed, hovered }: any) => [
              styles.todayPill,
              (pressed || hovered) && styles.todayPillHover,
            ]}
          >
            <Text style={styles.todayPillText}>Today</Text>
          </Pressable>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>Density heat map</Text>
          <Text style={styles.subtitle}>
            Warmer squares mean more friends in town. Scroll ahead to spot the
            busiest dates, then tap one for details.
          </Text>
        </View>

        <View style={styles.filterRow}>
          <GroupFilter
            groups={filterGroups}
            selectedGroupId={activeGroupId}
            onSelect={(groupId) => onSelectGroup?.(groupId)}
            onManagePress={() => {
              if (typeof window !== 'undefined' && window.alert) {
                window.alert('Group management coming soon (DES-19).');
              }
            }}
          />
        </View>

        <View style={[styles.calendarFrame, { padding: layout.framePadding }]}>
          {isEmpty ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIllustration}>
                <Text style={styles.emptyIllustrationGlyph}>🔥</Text>
              </View>
              <Text style={styles.emptyTitle}>
                Add friends to light up the heat map
              </Text>
              <Text style={styles.emptyBody}>
                Once you follow friends, each square warms up based on how many
                are around that day.
              </Text>
              <Button
                label="Add Friends"
                variant="primary"
                onPress={onAddFriendsPress}
                style={styles.emptyButton}
              />
            </View>
          ) : (
            <View style={[styles.gridRow, { height: gridHeight }]}>
              <View style={styles.weekdayGutter}>
                <View style={{ height: monthLabelHeight }} />
                {WEEKDAY_INITIALS.map((initial, index) => (
                  <View
                    key={index}
                    style={{ height: cellSize, marginBottom: cellGap }}
                  >
                    {LABELED_ROWS.has(index) ? (
                      <Text style={[styles.weekdayLabel, { lineHeight: cellSize }]}>
                        {initial}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>

              <FlatList
                ref={listRef}
                data={weeks}
                horizontal
                keyExtractor={(item) => item.key}
                renderItem={renderColumn}
                getItemLayout={getColumnLayout}
                initialScrollIndex={todayWeekIndex}
                initialNumToRender={12}
                windowSize={7}
                showsHorizontalScrollIndicator
                onScrollToIndexFailed={() => {
                  // getItemLayout makes this unreachable, but guard anyway so a
                  // race never crashes the view.
                }}
              />
            </View>
          )}
        </View>

        {!isEmpty && (
          <View style={styles.legend}>
            <Text style={styles.legendLabel}>Fewer</Text>
            <View style={styles.legendSwatches}>
              {[
                colors.heatmap.none,
                colors.heatmap.few,
                colors.heatmap.some,
                colors.heatmap.many,
              ].map((swatch) => (
                <View
                  key={swatch}
                  style={[styles.legendSwatch, { backgroundColor: swatch }]}
                />
              ))}
            </View>
            <Text style={styles.legendLabel}>More</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingBottom: spacing[8],
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
  freshnessLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.secondary,
  },
  todayPill: {
    minHeight: 44,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    justifyContent: 'center',
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
  titleBlock: {
    marginBottom: spacing[4],
  },
  title: {
    ...typography.display.small,
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    lineHeight: typography.body.small.lineHeight,
    color: colors.text.secondary,
    maxWidth: 520,
  },
  filterRow: {
    marginBottom: spacing[4],
  },
  calendarFrame: {
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    ...shadows.sm,
  },
  gridRow: {
    flexDirection: 'row',
  },
  weekdayGutter: {
    marginRight: spacing[2],
  },
  weekdayLabel: {
    ...typography.calendar.weekday,
    fontSize: 10,
    letterSpacing: 0.4,
    color: colors.text.tertiary,
    textAlign: 'center',
    width: 12,
  },
  monthTick: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.text.tertiary,
  },
  cell: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  cellToday: {
    borderWidth: 2,
    borderColor: colors.brand.primary,
  },
  cellHover: {
    ...shadows.sm,
  },
  cellPressed: {
    transform: [{ scale: 0.9 }],
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  legendLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
  },
  legendSwatches: {
    flexDirection: 'row',
    gap: spacing[1],
  },
  legendSwatch: {
    width: 16,
    height: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[5],
  },
  emptyIllustration: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  emptyIllustrationGlyph: {
    fontSize: 32,
    lineHeight: 36,
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
    maxWidth: 360,
  },
  emptyButton: {
    minWidth: 160,
  },
});
