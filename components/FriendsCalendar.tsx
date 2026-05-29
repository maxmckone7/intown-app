import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
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
  HeatmapDayData,
  HEATMAP_SCALE,
} from '../lib/heatmap';
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
  showEmptyStatePrompt?: boolean;
  onDismissEmptyState?: () => void;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

// Few → most, for the legend (HEATMAP_SCALE is ordered most → few).
const LEGEND_STEPS = [...HEATMAP_SCALE].reverse();

export default function FriendsCalendar({
  totalFriends,
  groups = [],
  selectedGroupId,
  onSelectGroup,
  getDayData,
  lastUpdatedAt,
  isRefreshing,
  onDayPress,
  onAddFriendsPress,
  showEmptyStatePrompt,
  onDismissEmptyState,
}: Props) {
  const today = startOfToday();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(today));
  const [internalSelectedGroupId, setInternalSelectedGroupId] = useState<string>('all');
  const [isEmptyStateDismissed, setIsEmptyStateDismissed] = useState(false);
  const layout = useMemo(
    () => getCalendarLayout(width, { left: insets.left, right: insets.right }),
    [insets.left, insets.right, width]
  );
  const activeGroupId = selectedGroupId ?? internalSelectedGroupId;

  const filterGroups = useMemo(
    () => [...DEFAULT_GROUPS, ...groups],
    [groups]
  );

  const selectedGroup = filterGroups.find((group) => group.id === activeGroupId);
  const selectedTotalFriends =
    activeGroupId === 'all'
      ? totalFriends
      : selectedGroup?.friendIds?.length ?? 0;

  const visibleDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  // Busiest in-view day this month, for the hero summary. Reads straight from
  // getDayData so it never diverges from the cells.
  const peak = useMemo(() => {
    if (!getDayData || selectedTotalFriends <= 0) return null;
    let best: { iso: string; count: number } | null = null;
    for (const date of visibleDays) {
      if (!isSameMonth(date, viewMonth)) continue;
      const iso = ISO(date);
      const count = getDayData(iso, activeGroupId).friendsInTown;
      if (!best || count > best.count) best = { iso, count };
    }
    return best && best.count > 0 ? best : null;
  }, [getDayData, visibleDays, viewMonth, activeGroupId, selectedTotalFriends]);

  const goPrev = () => setViewMonth((d) => subMonths(d, 1));
  const goNext = () => setViewMonth((d) => addMonths(d, 1));
  const goToday = () => setViewMonth(startOfMonth(today));

  const isEmpty = selectedTotalFriends <= 0;
  const shouldShowEmptyStatePrompt =
    showEmptyStatePrompt ?? !isEmptyStateDismissed;
  const weekdayLabels = layout.compact
    ? WEEKDAYS.map((day) => day.slice(0, 1))
    : WEEKDAYS.map((day) => day.toUpperCase());
  const freshnessLabel = isRefreshing
    ? 'Refreshing availability...'
    : lastUpdatedAt
      ? `Updated ${format(lastUpdatedAt, 'h:mm a')}`
      : 'Availability not updated yet';
  const heroSubtitle = isEmpty
    ? 'Follow friends to light up the days they’re around.'
    : peak
      ? `Busiest day this month: ${format(
          new Date(`${peak.iso}T00:00:00`),
          'EEEE, MMM d'
        )} — ${peak.count} around.`
      : 'Tap any day to see who’s in town.';

  const handleDayPress = (iso: string) => {
    onDayPress?.(iso, activeGroupId);
  };

  const handleGroupSelect = (groupId: string) => {
    if (selectedGroupId === undefined) {
      setInternalSelectedGroupId(groupId);
    }
    onSelectGroup?.(groupId);
  };

  const handleDismissEmptyState = () => {
    setIsEmptyStateDismissed(true);
    onDismissEmptyState?.();
  };

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
        {!layout.compact && (
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Who’s around</Text>
            <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
          </View>
        )}

        <View style={styles.topRow}>
          <Text style={styles.freshnessLabel}>{freshnessLabel}</Text>
          <Pressable
            onPress={goToday}
            accessibilityRole="button"
            accessibilityLabel="Go to current month"
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
          <Text
            style={[styles.monthLabel, layout.compact && styles.monthLabelCompact]}
            numberOfLines={1}
          >
            {format(viewMonth, 'MMMM yyyy')}
          </Text>
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
            selectedGroupId={activeGroupId}
            onSelect={handleGroupSelect}
            onManagePress={() => {
              // DES-19 will replace this placeholder with the real
              // group management UI.
              if (typeof window !== 'undefined' && window.alert) {
                window.alert('Group management coming soon (DES-19).');
              }
            }}
          />
        </View>

        <View style={[styles.calendarFrame, { padding: layout.framePadding }]}>
          <ScrollView
            horizontal
            bounces={false}
            scrollEnabled={layout.isScrollable}
            showsHorizontalScrollIndicator={layout.isScrollable}
          >
            <View style={{ width: layout.gridWidth }}>
              <View style={[styles.weekdayRow, { gap: layout.gap }]}>
                {weekdayLabels.map((day, index) => (
                  <Text
                    key={`${day}-${index}`}
                    style={[
                      styles.weekdayLabel,
                      layout.compact && styles.weekdayLabelCompact,
                      { width: layout.cellWidth },
                    ]}
                  >
                    {day}
                  </Text>
                ))}
              </View>

              <View style={[styles.grid, { gap: layout.gap }]}>
                {visibleDays.map((date) => {
                  const iso = ISO(date);
                  const inMonth = isSameMonth(date, viewMonth);
                  const todayCell = isSameDay(date, today);
                  const data = getDayData
                    ? getDayData(iso, activeGroupId)
                    : { date: iso, friendsInTown: 0, totalFriends: selectedTotalFriends };
                  const bg = getHeatmapColor(data.friendsInTown, data.totalFriends);
                  const dayNumber = format(date, 'd');
                  const tinted = inMonth && data.totalFriends > 0;
                  const friendCountLabel = `${data.friendsInTown} of ${data.totalFriends} friends in town`;

                  return (
                    <Pressable
                      key={iso}
                      onPress={() => handleDayPress(iso)}
                      accessibilityRole="button"
                      accessibilityLabel={`${format(date, 'EEEE, MMM d')} - ${friendCountLabel}`}
                      accessibilityHint="Tap to view which friends are in town"
                      hitSlop={layout.compact ? 0 : 4}
                      style={({ pressed, hovered }: any) => [
                        styles.cell,
                        {
                          backgroundColor: tinted ? bg : colors.heatmap.empty,
                          borderRadius: layout.compact ? radius.sm : radius.md,
                          height: layout.cellHeight,
                          padding: layout.compact ? spacing[1] : spacing[2],
                          width: layout.cellWidth,
                        },
                        !inMonth && styles.cellOutsideMonth,
                        todayCell && styles.cellToday,
                        hovered && styles.cellHover,
                        pressed && styles.cellPressed,
                      ]}
                    >
                      <View style={styles.cellTopRow}>
                        <Text
                          style={[
                            styles.dayNumber,
                            layout.compact && styles.dayNumberCompact,
                            tinted && styles.dayNumberTinted,
                            !inMonth && styles.dayNumberOutsideMonth,
                          ]}
                        >
                          {dayNumber}
                        </Text>
                        {todayCell && <View style={styles.todayDot} />}
                      </View>
                      {!isEmpty && !layout.compact && (
                        <View style={styles.countPill}>
                          <Text style={styles.countPillText} numberOfLines={1}>
                            {`${data.friendsInTown} in town`}
                          </Text>
                        </View>
                      )}
                      {!isEmpty && layout.compact && (
                        <Text
                          style={[
                            styles.friendCount,
                            styles.friendCountCompact,
                            !inMonth && styles.friendCountOutsideMonth,
                          ]}
                          numberOfLines={1}
                        >
                          {data.friendsInTown}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {!isEmpty && !layout.compact && (
            <View style={styles.legend}>
              <Text style={styles.legendLabel}>Fewer</Text>
              <View style={styles.legendSwatches}>
                {LEGEND_STEPS.map((step) => (
                  <View
                    key={step.label}
                    style={[styles.legendSwatch, { backgroundColor: step.color }]}
                  />
                ))}
              </View>
              <Text style={styles.legendLabel}>More in town</Text>
            </View>
          )}
        </View>

        {isEmpty && shouldShowEmptyStatePrompt && (
          <View pointerEvents="box-none" style={styles.emptyOverlay}>
            <View style={styles.emptyCard}>
              <Pressable
                onPress={handleDismissEmptyState}
                accessibilityLabel="Dismiss add friends popup"
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed, hovered }: any) => [
                  styles.emptyCloseButton,
                  (pressed || hovered) && styles.emptyCloseButtonHover,
                ]}
              >
                <Text style={styles.emptyCloseGlyph}>×</Text>
              </Pressable>
              <View style={styles.emptyIllustration}>
                <Text style={styles.emptyIllustrationGlyph}>🏠</Text>
              </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    paddingBottom: spacing[8],
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 1200,
    position: 'relative',
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing[5],
  },
  heroTitle: {
    ...typography.display.medium,
    color: colors.text.primary,
    textAlign: 'center',
  },
  heroSubtitle: {
    ...typography.body.large,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing[2],
    maxWidth: 560,
  },
  cellTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.primary,
  },
  countPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  countPillText: {
    ...typography.calendar.meta,
    color: colors.text.primary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  legendLabel: {
    ...typography.caption,
    color: colors.text.tertiary,
  },
  legendSwatches: {
    flexDirection: 'row',
    gap: 3,
  },
  legendSwatch: {
    width: 18,
    height: 12,
    borderRadius: 3,
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
    minHeight: 44,
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
  freshnessLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.secondary,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  monthArrow: {
    width: 44,
    height: 44,
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
    ...typography.calendar.month,
    flexShrink: 1,
    color: colors.text.primary,
    minWidth: 0,
    textAlign: 'center',
  },
  monthLabelCompact: {
    fontSize: typography.display.small.fontSize,
    lineHeight: typography.display.small.lineHeight,
  },
  calendarFrame: {
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    ...shadows.sm,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: spacing[3],
  },
  weekdayLabel: {
    ...typography.calendar.weekday,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  weekdayLabelCompact: {
    fontSize: typography.caption.fontSize,
    letterSpacing: 0.6,
    lineHeight: typography.caption.lineHeight,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    justifyContent: 'space-between',
    ...shadows.sm,
  },
  cellOutsideMonth: {
    backgroundColor: colors.background.secondary,
  },
  cellToday: {
    borderWidth: 2,
    borderColor: colors.brand.primary,
    ...shadows.md,
  },
  cellHover: {
    ...shadows.md,
  },
  cellPressed: {
    transform: [{ scale: 0.95 }],
  },
  dayNumber: {
    ...typography.calendar.dayNumber,
    color: colors.text.primary,
  },
  dayNumberCompact: {
    fontSize: 20,
    lineHeight: 24,
  },
  dayNumberTinted: {
    // Soft light halo so dark numerals stay legible on saturated cells.
    textShadowColor: 'rgba(255, 255, 255, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  dayNumberOutsideMonth: {
    color: colors.text.secondary,
  },
  friendCount: {
    ...typography.calendar.meta,
    color: 'rgba(255, 255, 255, 0.85)',
    alignSelf: 'flex-end',
  },
  friendCountCompact: {
    fontSize: 10,
    letterSpacing: 0.3,
    lineHeight: 12,
  },
  friendCountOutsideMonth: {
    color: colors.text.secondary,
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
    position: 'relative',
    ...shadows.lg,
  },
  emptyCloseButton: {
    position: 'absolute',
    top: spacing[3],
    right: spacing[3],
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCloseButtonHover: {
    backgroundColor: colors.background.secondary,
  },
  emptyCloseGlyph: {
    fontSize: 24,
    lineHeight: 24,
    color: colors.text.secondary,
    fontWeight: '500',
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
  },
  emptyButton: {
    minWidth: 160,
  },
});
