import { useMemo, useState } from 'react';
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
import GroupFilter, { DEFAULT_GROUPS } from './GroupFilter';

type Props = {
  totalFriends: number;
  /** Optional override — pass real aggregated data per ISO date once
   *  the Supabase query lands. Mock data is used when undefined. */
  getDayData?: (isoDate: string) => HeatmapDayData;
  onDayPress?: (isoDate: string) => void;
  onAddFriendsPress?: () => void;
  showEmptyStatePrompt?: boolean;
  onDismissEmptyState?: () => void;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

export default function FriendsCalendar({
  totalFriends,
  getDayData,
  onDayPress,
  onAddFriendsPress,
  showEmptyStatePrompt,
  onDismissEmptyState,
}: Props) {
  const today = startOfToday();
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(today));
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [isEmptyStateDismissed, setIsEmptyStateDismissed] = useState(false);

  const visibleDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  const goPrev = () => setViewMonth((d) => subMonths(d, 1));
  const goNext = () => setViewMonth((d) => addMonths(d, 1));
  const goToday = () => setViewMonth(startOfMonth(today));

  const isEmpty = totalFriends <= 0;
  const shouldShowEmptyStatePrompt =
    showEmptyStatePrompt ?? !isEmptyStateDismissed;

  const handleDayPress = (iso: string) => {
    if (onDayPress) onDayPress(iso);
    // DES-14 will replace this console.log with a real day-detail modal
    // eslint-disable-next-line no-console
    console.log('day pressed:', iso);
  };

  const handleDismissEmptyState = () => {
    setIsEmptyStateDismissed(true);
    onDismissEmptyState?.();
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
            groups={DEFAULT_GROUPS}
            selectedGroupId={selectedGroupId}
            onSelect={setSelectedGroupId}
            onManagePress={() => {
              // DES-19 will replace this placeholder with the real
              // group management UI.
              if (typeof window !== 'undefined' && window.alert) {
                window.alert('Group management coming soon (DES-19).');
              }
            }}
          />
        </View>

        <View style={styles.calendarFrame}>
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
                  <Text
                    style={[
                      styles.dayNumber,
                      !inMonth && styles.dayNumberOutsideMonth,
                    ]}
                  >
                    {dayNumber}
                  </Text>
                  {!isEmpty && (
                    <Text style={styles.friendCount} numberOfLines={1}>
                      {data.friendsInTown} in town
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
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
    ...typography.calendar.month,
    color: colors.text.primary,
    minWidth: 280,
    textAlign: 'center',
  },
  calendarFrame: {
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    padding: spacing[3],
    ...shadows.sm,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: spacing[3],
    gap: CELL_GAP,
  },
  weekdayLabel: {
    flex: 1,
    ...typography.calendar.weekday,
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
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[2],
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
    transform: [{ scale: 1.02 }],
    ...shadows.md,
  },
  dayNumber: {
    ...typography.calendar.dayNumber,
    color: colors.text.primary,
  },
  dayNumberOutsideMonth: {
    color: colors.text.secondary,
  },
  friendCount: {
    ...typography.calendar.meta,
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
    position: 'relative',
    ...shadows.lg,
  },
  emptyCloseButton: {
    position: 'absolute',
    top: spacing[3],
    right: spacing[3],
    width: 32,
    height: 32,
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
