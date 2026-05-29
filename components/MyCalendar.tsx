import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
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
import { useToast } from './ToastProvider';
import { authService } from '../services/auth';
import { calendarService } from '../services/calendar';
import { CalendarStatus } from '../lib/types';
import { getCalendarLayout } from './calendarLayout';

type DayStatus = 'in_town' | 'away';
type PersonalStatusMap = Record<string, DayStatus>;

const DEFAULT_DAY_STATUS: DayStatus = 'in_town';

const dayStatusToCalendarStatus = (s: DayStatus): CalendarStatus =>
  s === 'in_town' ? 'in_town' : 'out_of_town';

const calendarStatusToDayStatus = (s: CalendarStatus): DayStatus =>
  s === 'in_town' ? 'in_town' : 'away';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

function showComingSoon(label: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
    window.alert(`${label} — coming soon.`);
  }
}

export default function MyCalendar() {
  const today = startOfToday();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(today));
  const [statusByDate, setStatusByDate] = useState<PersonalStatusMap>({});
  const [userId, setUserId] = useState<string | null>(null);
  const toast = useToast();
  const layout = useMemo(
    () => getCalendarLayout(width, { left: insets.left, right: insets.right }),
    [insets.left, insets.right, width]
  );

  // Load the user's existing entries from Supabase on mount so toggles
  // persist across navigation and page reloads (ENG-84).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await authService.getCurrentUser();
        if (!user || !mounted) return;
        setUserId(user.id);
        const entries = await calendarService.getEntries(user.id);
        if (!mounted) return;
        const map: PersonalStatusMap = {};
        for (const e of entries) {
          map[e.date] = calendarStatusToDayStatus(e.status);
        }
        setStatusByDate(map);
      } catch (err: any) {
        if (mounted) {
          toast.show(err?.message || 'Failed to load your calendar', {
            variant: 'info',
          });
        }
      }
    })();
    return () => {
      mounted = false;
    };
    // toast is stable across renders via context; intentionally not in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  const goPrev = () => setViewMonth((d) => subMonths(d, 1));
  const goNext = () => setViewMonth((d) => addMonths(d, 1));
  const goToday = () => setViewMonth(startOfMonth(today));

  const toggleDay = async (iso: string) => {
    const current = statusByDate[iso] ?? DEFAULT_DAY_STATUS;
    const next: DayStatus = current === 'in_town' ? 'away' : 'in_town';

    // Optimistically flip the cell so the UI feels instant.
    setStatusByDate((prev) => ({ ...prev, [iso]: next }));

    if (!userId) {
      // Entries haven't loaded yet (or auth not resolved). Don't persist;
      // the optimistic flip will be reconciled on next mount.
      toast.success(
        next === 'in_town' ? 'Status updated — in town' : 'Status updated — away'
      );
      return;
    }

    try {
      await calendarService.setEntry(
        userId,
        iso,
        dayStatusToCalendarStatus(next)
      );
      toast.success(
        next === 'in_town' ? 'Status updated — in town' : 'Status updated — away'
      );
    } catch (err: any) {
      // Revert local state if the save fails so the UI matches the server.
      setStatusByDate((prev) => ({ ...prev, [iso]: current }));
      toast.show(err?.message || 'Failed to save status', { variant: 'info' });
    }
  };

  const statusFor = (iso: string): DayStatus =>
    statusByDate[iso] ?? DEFAULT_DAY_STATUS;
  const weekdayLabels = layout.compact
    ? WEEKDAYS.map((day) => day.slice(0, 1))
    : WEEKDAYS.map((day) => day.toUpperCase());

  return (
    <ScrollView
      style={styles.outer}
      contentContainerStyle={[
        styles.outerContent,
        {
          paddingTop: layout.compact ? spacing[4] : spacing[7],
          paddingBottom: spacing[8] + insets.bottom,
          paddingLeft: layout.paddingLeft,
          paddingRight: layout.paddingRight,
        },
      ]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.inner}>
        <View style={styles.titleBlock}>
          <Text style={[styles.pageTitle, layout.compact && styles.pageTitleCompact]}>
            My Calendar
          </Text>
          <Text style={styles.pageSubtitle}>
            Tap any day to toggle your status
          </Text>
        </View>

        <View style={styles.topRow}>
          <View style={styles.bulkRow}>
            <Pressable
              onPress={() => showComingSoon('Mark week as in town')}
              accessibilityRole="button"
              style={({ pressed, hovered }: any) => [
                styles.bulkButton,
                styles.bulkInTown,
                (pressed || hovered) && styles.bulkInTownHover,
              ]}
            >
              <Text style={[styles.bulkText, styles.bulkInTownText]}>
                Mark week as in town
              </Text>
            </Pressable>
            <Pressable
              onPress={() => showComingSoon('Mark week as away')}
              accessibilityRole="button"
              style={({ pressed, hovered }: any) => [
                styles.bulkButton,
                styles.bulkAway,
                (pressed || hovered) && styles.bulkAwayHover,
              ]}
            >
              <Text style={[styles.bulkText, styles.bulkAwayText]}>
                Mark week as away
              </Text>
            </Pressable>
          </View>
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
                  const status = statusFor(iso);
                  const bg =
                    status === 'in_town' ? colors.heatmap.high : colors.heatmap.low;
                  const dayNumber = format(date, 'd');
                  const fullStatusLabel = status === 'in_town' ? 'In Town' : 'Away';
                  const statusLabel =
                    layout.compact && status === 'in_town' ? 'In' : fullStatusLabel;

                  return (
                    <Pressable
                      key={iso}
                      onPress={() => toggleDay(iso)}
                      accessibilityRole="button"
                      accessibilityLabel={`${format(date, 'EEEE, MMM d')} - ${fullStatusLabel}`}
                      accessibilityHint="Tap to toggle in town or away"
                      hitSlop={layout.compact ? 0 : 4}
                      style={({ pressed, hovered }: any) => [
                        styles.cell,
                        {
                          backgroundColor: bg,
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
                      <View
                        style={[
                          styles.cellInnerStroke,
                          { borderRadius: (layout.compact ? radius.sm : radius.md) - 2 },
                        ]}
                        pointerEvents="none"
                      />
                      <Text
                        style={[
                          styles.dayNumber,
                          layout.compact && styles.dayNumberCompact,
                          !inMonth && styles.dayNumberOutsideMonth,
                        ]}
                      >
                        {dayNumber}
                      </Text>
                      <Text
                        style={[
                          styles.statusLabel,
                          layout.compact && styles.statusLabelCompact,
                          !inMonth && styles.statusLabelOutsideMonth,
                        ]}
                        numberOfLines={1}
                      >
                        {statusLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  outerContent: {
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 1200,
  },
  titleBlock: {
    marginBottom: spacing[5],
  },
  pageTitle: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.large.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  pageTitleCompact: {
    fontSize: typography.display.medium.fontSize,
    lineHeight: typography.display.medium.lineHeight,
  },
  pageSubtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
    gap: spacing[3],
    flexWrap: 'wrap',
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  bulkButton: {
    minHeight: 44,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bulkInTown: {
    backgroundColor: 'rgba(134, 167, 137, 0.12)',
    borderColor: 'rgba(134, 167, 137, 0.5)',
  },
  bulkInTownHover: {
    backgroundColor: 'rgba(134, 167, 137, 0.22)',
  },
  bulkInTownText: {
    color: '#4D6A50',
  },
  bulkAway: {
    backgroundColor: 'rgba(196, 90, 77, 0.12)',
    borderColor: 'rgba(196, 90, 77, 0.5)',
  },
  bulkAwayHover: {
    backgroundColor: 'rgba(196, 90, 77, 0.22)',
  },
  bulkAwayText: {
    color: '#8A3B32',
  },
  bulkText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
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
    position: 'relative',
    overflow: 'hidden',
    ...shadows.sm,
  },
  cellInnerStroke: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: radius.md - 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
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
  dayNumberOutsideMonth: {
    color: colors.text.secondary,
  },
  statusLabel: {
    ...typography.calendar.meta,
    color: 'rgba(255, 255, 255, 0.9)',
    alignSelf: 'flex-end',
  },
  statusLabelCompact: {
    fontSize: 9,
    letterSpacing: 0.3,
    lineHeight: 12,
  },
  statusLabelOutsideMonth: {
    color: colors.text.secondary,
  },
});
