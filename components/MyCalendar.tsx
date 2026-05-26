import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
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
import { useToast } from './ToastProvider';
import { authService } from '../services/auth';
import { calendarService } from '../services/calendar';
import { CalendarStatus } from '../lib/types';

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
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(today));
  const [statusByDate, setStatusByDate] = useState<PersonalStatusMap>({});
  const [userId, setUserId] = useState<string | null>(null);
  const toast = useToast();

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

  return (
    <ScrollView
      style={styles.outer}
      contentContainerStyle={styles.outerContent}
    >
      <View style={styles.inner}>
        <View style={styles.titleBlock}>
          <Text style={styles.pageTitle}>My Calendar</Text>
          <Text style={styles.pageSubtitle}>
            Click any day to toggle your status
          </Text>
        </View>

        <View style={styles.topRow}>
          <View style={styles.bulkRow}>
            <Pressable
              onPress={() => showComingSoon('Mark week as in town')}
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
            const status = statusFor(iso);
            const bg =
              status === 'in_town' ? colors.heatmap.high : colors.heatmap.low;
            const dayNumber = format(date, 'd');
            const statusLabel = status === 'in_town' ? 'In town' : 'Away';

            return (
              <Pressable
                key={iso}
                onPress={() => toggleDay(iso)}
                accessibilityRole="button"
                accessibilityLabel={`${format(date, 'EEEE, MMM d')} — ${statusLabel}`}
                accessibilityHint="Tap to toggle in town or away"
                style={({ pressed, hovered }: any) => [
                  styles.cell,
                  { backgroundColor: bg },
                  !inMonth && styles.cellOutsideMonth,
                  todayCell && styles.cellToday,
                  hovered && styles.cellHover,
                  pressed && styles.cellPressed,
                ]}
              >
                <View style={styles.cellInnerStroke} pointerEvents="none" />
                <Text style={styles.dayNumber}>{dayNumber}</Text>
                <Text style={styles.statusLabel} numberOfLines={1}>
                  {statusLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const CELL_HEIGHT = 100;
const CELL_GAP = spacing[2];

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  outerContent: {
    paddingTop: spacing[7],
    paddingBottom: spacing[8],
    paddingHorizontal: spacing[4],
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
    height: 36,
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
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: `${(100 - 6) / 7}%`,
    height: CELL_HEIGHT,
    borderRadius: radius.md,
    padding: spacing[2],
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
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
    opacity: 0.4,
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
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.large.fontSize,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  statusLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    alignSelf: 'flex-end',
    letterSpacing: 0.3,
  },
});
