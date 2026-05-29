import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useRouter } from 'expo-router';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import Button from './Button';
import StateFeedback from './StateFeedback';
import { MyCalendarSkeleton } from './Skeleton';
import { useToast } from './ToastProvider';
import { authService } from '../services/auth';
import { calendarService } from '../services/calendar';
import { addFriendsPromptService } from '../services/addFriendsPrompt';
import { CalendarStatus } from '../lib/types';
import { getCalendarLayout } from './calendarLayout';

type DayStatus = 'in_town' | 'away';
type PersonalStatusMap = Record<string, DayStatus>;
type SaveStatus = 'saving' | 'saved' | 'error';
type SaveStatusMap = Record<string, SaveStatus>;

const DEFAULT_DAY_STATUS: DayStatus = 'in_town';
const SAVE_RETRY_DELAYS_MS = [700, 1600, 3200];
const SAVED_STATE_VISIBLE_MS = 1600;

const dayStatusToCalendarStatus = (s: DayStatus): CalendarStatus =>
  s === 'in_town' ? 'in_town' : 'out_of_town';

const calendarStatusToDayStatus = (s: CalendarStatus): DayStatus =>
  s === 'in_town' ? 'in_town' : 'away';

const statusMessage = (status: DayStatus) =>
  status === 'in_town' ? 'Status updated — in town' : 'Status updated — away';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = (d: Date) => format(d, 'yyyy-MM-dd');

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function saveStatusWithRetry(
  userId: string,
  iso: string,
  status: DayStatus
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await calendarService.setEntry(
        userId,
        iso,
        dayStatusToCalendarStatus(status)
      );
    } catch (err) {
      lastError = err;
      const retryDelay = SAVE_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined) {
        throw err;
      }
      await wait(retryDelay);
    }
  }

  throw lastError;
}

function showComingSoon(label: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
    window.alert(`${label} — coming soon.`);
  }
}

export default function MyCalendar() {
  const today = useMemo(() => startOfToday(), []);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(today));
  const [statusByDate, setStatusByDate] = useState<PersonalStatusMap>({});
  const [saveStateByDate, setSaveStateByDate] = useState<SaveStatusMap>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [savingOnboardingStatus, setSavingOnboardingStatus] =
    useState<DayStatus | null>(null);
  const [completingManualOnboarding, setCompletingManualOnboarding] =
    useState(false);
  const toast = useToast();
  const layout = useMemo(
    () => getCalendarLayout(width, { left: insets.left, right: insets.right }),
    [insets.left, insets.right, width]
  );

  const mountedRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const statusByDateRef = useRef<PersonalStatusMap>({});
  const serverStatusByDateRef = useRef<PersonalStatusMap>({});
  const pendingSaveByDateRef = useRef<Partial<PersonalStatusMap>>({});
  const savingByDateRef = useRef<Record<string, boolean>>({});
  const inFlightSaveByDateRef = useRef<Partial<PersonalStatusMap>>({});
  const saveStateTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );

  const clearSaveStateTimer = useCallback((iso: string) => {
    const timer = saveStateTimersRef.current[iso];
    if (timer) {
      clearTimeout(timer);
      delete saveStateTimersRef.current[iso];
    }
  }, []);

  const setSaveStateForDate = useCallback(
    (iso: string, state: SaveStatus | null) => {
      if (!mountedRef.current) return;

      clearSaveStateTimer(iso);
      setSaveStateByDate((prev) => {
        const next = { ...prev };
        if (state) {
          next[iso] = state;
        } else {
          delete next[iso];
        }
        return next;
      });

      if (state === 'saved') {
        saveStateTimersRef.current[iso] = setTimeout(() => {
          if (!mountedRef.current) return;
          setSaveStateByDate((prev) => {
            if (prev[iso] !== 'saved') return prev;
            const next = { ...prev };
            delete next[iso];
            return next;
          });
          delete saveStateTimersRef.current[iso];
        }, SAVED_STATE_VISIBLE_MS);
      }
    },
    [clearSaveStateTimer]
  );

  const replaceStatusMap = useCallback((next: PersonalStatusMap) => {
    statusByDateRef.current = next;
    if (mountedRef.current) {
      setStatusByDate(next);
    }
  }, []);

  const updateStatusForDate = useCallback((iso: string, status: DayStatus) => {
    const next = { ...statusByDateRef.current, [iso]: status };
    replaceStatusMap(next);
  }, [replaceStatusMap]);

  const processSaveForDate = useCallback(
    async (iso: string) => {
      if (savingByDateRef.current[iso]) return;

      const currentUserId = userIdRef.current;
      if (!currentUserId) return;

      const desired = pendingSaveByDateRef.current[iso];
      if (!desired) return;

      delete pendingSaveByDateRef.current[iso];
      savingByDateRef.current[iso] = true;
      inFlightSaveByDateRef.current[iso] = desired;
      setSaveStateForDate(iso, 'saving');

      try {
        await saveStatusWithRetry(currentUserId, iso, desired);
        if (!mountedRef.current) return;

        serverStatusByDateRef.current = {
          ...serverStatusByDateRef.current,
          [iso]: desired,
        };
        delete inFlightSaveByDateRef.current[iso];
        delete savingByDateRef.current[iso];

        if (pendingSaveByDateRef.current[iso]) {
          void processSaveForDate(iso);
          return;
        }

        setSaveStateForDate(iso, 'saved');
        toast.success(statusMessage(desired));
      } catch (err: any) {
        if (!mountedRef.current) return;

        delete inFlightSaveByDateRef.current[iso];
        delete savingByDateRef.current[iso];

        if (pendingSaveByDateRef.current[iso]) {
          void processSaveForDate(iso);
          return;
        }

        const rollback =
          serverStatusByDateRef.current[iso] ?? DEFAULT_DAY_STATUS;
        updateStatusForDate(iso, rollback);
        setSaveStateForDate(iso, 'error');
        toast.show(err?.message || 'Failed to save status. Your change was reverted.', {
          variant: 'info',
        });
      }
    },
    [setSaveStateForDate, toast, updateStatusForDate]
  );

  const flushPendingSaves = useCallback(() => {
    Object.keys(pendingSaveByDateRef.current).forEach((iso) => {
      void processSaveForDate(iso);
    });
  }, [processSaveForDate]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      Object.values(saveStateTimersRef.current).forEach(clearTimeout);
      saveStateTimersRef.current = {};
    };
  }, []);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setOnboardingComplete(false);

    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        setLoadError('We could not confirm your session. Please sign in again.');
        return;
      }

      setUserId(user.id);
      const [entries, needsAvailabilitySetup] = await Promise.all([
        calendarService.getEntries(user.id),
        addFriendsPromptService.shouldSetAvailability(user.id),
      ]);
      const map: PersonalStatusMap = {};
      for (const e of entries) {
        map[e.date] = calendarStatusToDayStatus(e.status);
      }
      setStatusByDate(map);
      setShowOnboardingGuide(needsAvailabilitySetup);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load your calendar');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the user's existing entries from Supabase on mount so toggles
  // persist across navigation and page reloads (ENG-84).
  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    if (userId) {
      flushPendingSaves();
    }
  }, [flushPendingSaves, userId]);

  const visibleDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  const goPrev = () => setViewMonth((d) => subMonths(d, 1));
  const goNext = () => setViewMonth((d) => addMonths(d, 1));
  const goToday = () => setViewMonth(startOfMonth(today));

  const toggleDay = (iso: string) => {
    const current = statusByDateRef.current[iso] ?? DEFAULT_DAY_STATUS;
    const next: DayStatus = current === 'in_town' ? 'away' : 'in_town';

    // Optimistically flip the cell so the UI feels instant.
    updateStatusForDate(iso, next);
    pendingSaveByDateRef.current = {
      ...pendingSaveByDateRef.current,
      [iso]: next,
    };
    setSaveStateForDate(iso, 'saving');
    void processSaveForDate(iso);
  };

  const statusFor = (iso: string): DayStatus =>
    statusByDate[iso] ?? DEFAULT_DAY_STATUS;

  const saveSummary = useMemo(() => {
    const states = Object.values(saveStateByDate);
    const savingCount = states.filter((state) => state === 'saving').length;

    if (savingCount > 0) {
      return {
        text:
          savingCount === 1
            ? 'Saving change...'
            : `Saving ${savingCount} changes...`,
        status: 'saving' as SaveStatus,
      };
    }

    if (states.includes('error')) {
      return {
        text: 'Some changes were not saved',
        status: 'error' as SaveStatus,
      };
    }

    if (states.includes('saved')) {
      return {
        text: 'All changes saved',
        status: 'saved' as SaveStatus,
      };
    }

    return null;
  }, [saveStateByDate]);

  const weekdayLabels = layout.compact
    ? WEEKDAYS.map((day) => day.slice(0, 1))
    : WEEKDAYS.map((day) => day.toUpperCase());

  const completeAvailabilityOnboarding = async () => {
    if (!userId) {
      setLoadError('We could not confirm your session. Please sign in again.');
      return;
    }

    setCompletingManualOnboarding(true);
    try {
      await addFriendsPromptService.markAvailabilitySet(userId);
      setShowOnboardingGuide(false);
      setOnboardingComplete(true);
      toast.success('Availability setup complete');
    } finally {
      setCompletingManualOnboarding(false);
    }
  };

  const setWeekAvailability = async (status: DayStatus) => {
    if (!userId) {
      setLoadError('We could not confirm your session. Please sign in again.');
      return;
    }

    setSavingOnboardingStatus(status);
    const days = eachDayOfInterval({
      start: startOfWeek(today, { weekStartsOn: 0 }),
      end: endOfWeek(today, { weekStartsOn: 0 }),
    });
    const updates = days.reduce<PersonalStatusMap>((map, date) => {
      map[ISO(date)] = status;
      return map;
    }, {});
    const previous = statusByDate;

    setStatusByDate((current) => ({ ...current, ...updates }));

    try {
      await Promise.all(
        days.map((date) =>
          calendarService.setEntry(
            userId,
            ISO(date),
            dayStatusToCalendarStatus(status)
          )
        )
      );
      await addFriendsPromptService.markAvailabilitySet(userId);
      setShowOnboardingGuide(false);
      setOnboardingComplete(true);
      toast.success(
        status === 'in_town'
          ? 'This week is marked in town'
          : 'This week is marked away'
      );
    } catch (err: any) {
      setStatusByDate(previous);
      toast.show(err?.message || 'Failed to save this week', { variant: 'info' });
    } finally {
      setSavingOnboardingStatus(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.outer}>
        <MyCalendarSkeleton />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.errorScreen}>
        <StateFeedback
          eyebrow="Calendar unavailable"
          title="We could not load your availability"
          body={loadError}
          primaryAction={{
            label: 'Try again',
            onPress: () => {
              void loadCalendar();
            },
            loading,
          }}
        />
      </View>
    );
  }

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
        {showOnboardingGuide && (
          <View style={styles.onboardingCard}>
            <Text style={styles.onboardingEyebrow}>Step 1 of 2</Text>
            <Text style={styles.onboardingTitle}>Set your availability first</Text>
            <Text style={styles.onboardingBody}>
              Friends can plan around you once your calendar has a starting
              status. Pick a quick default for this week, then invite friends.
            </Text>
            <View style={styles.onboardingSteps}>
              <View style={styles.onboardingStepActive}>
                <Text style={styles.onboardingStepNumber}>1</Text>
                <Text style={styles.onboardingStepText}>Set availability</Text>
              </View>
              <View style={styles.onboardingStep}>
                <Text style={styles.onboardingStepNumberMuted}>2</Text>
                <Text style={styles.onboardingStepTextMuted}>Invite friends</Text>
              </View>
            </View>
            <View style={styles.onboardingActions}>
              <Button
                label="In town this week"
                onPress={() => {
                  void setWeekAvailability('in_town');
                }}
                loading={savingOnboardingStatus === 'in_town'}
                disabled={savingOnboardingStatus !== null || completingManualOnboarding}
                style={styles.onboardingButton}
              />
              <Button
                label="Away this week"
                variant="secondary"
                onPress={() => {
                  void setWeekAvailability('away');
                }}
                loading={savingOnboardingStatus === 'away'}
                disabled={savingOnboardingStatus !== null || completingManualOnboarding}
                style={styles.onboardingButton}
              />
            </View>
            <Button
              label="I've set individual days"
              variant="secondary"
              onPress={() => {
                void completeAvailabilityOnboarding();
              }}
              loading={completingManualOnboarding}
              disabled={savingOnboardingStatus !== null || completingManualOnboarding}
              style={styles.manualOnboardingButton}
            />
          </View>
        )}

        {onboardingComplete && (
          <StateFeedback
            compact
            eyebrow="Step 2 of 2"
            title="Availability saved"
            body="You are ready to invite friends and see when everyone's in town."
            primaryAction={{
              label: 'Invite friends',
              onPress: () => router.push('/(tabs)'),
            }}
            style={styles.onboardingCompleteCard}
          />
        )}

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
          {saveSummary && (
            <View
              style={[
                styles.saveSummary,
                saveSummary.status === 'error' && styles.saveSummaryError,
                saveSummary.status === 'saved' && styles.saveSummarySaved,
              ]}
            >
              <Text
                style={[
                  styles.saveSummaryText,
                  saveSummary.status === 'error' && styles.saveSummaryTextError,
                  saveSummary.status === 'saved' && styles.saveSummaryTextSaved,
                ]}
              >
                {saveSummary.text}
              </Text>
            </View>
          )}
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
  errorScreen: {
    flex: 1,
    backgroundColor: colors.background.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  outerContent: {
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 1200,
  },
  onboardingCard: {
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[5],
    marginBottom: spacing[5],
    ...shadows.md,
  },
  onboardingEyebrow: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    letterSpacing: typography.label.letterSpacing,
    color: colors.brand.primary,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
  },
  onboardingTitle: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.medium.fontSize,
    lineHeight: typography.display.medium.lineHeight,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  onboardingBody: {
    maxWidth: 640,
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    lineHeight: typography.body.default.lineHeight,
    color: colors.text.secondary,
  },
  onboardingSteps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[5],
  },
  onboardingStepActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: 'rgba(0, 122, 255, 0.12)',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  onboardingStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.background.secondary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  onboardingStepNumber: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
  },
  onboardingStepNumberMuted: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.text.tertiary,
  },
  onboardingStepText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '700',
    color: colors.text.primary,
  },
  onboardingStepTextMuted: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '700',
    color: colors.text.secondary,
  },
  onboardingActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[5],
  },
  onboardingButton: {
    minWidth: 180,
  },
  manualOnboardingButton: {
    alignSelf: 'flex-start',
    minWidth: 220,
    marginTop: spacing[3],
  },
  onboardingCompleteCard: {
    maxWidth: '100%',
    marginBottom: spacing[5],
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
  saveSummary: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: 'rgba(233, 78, 119, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(233, 78, 119, 0.22)',
  },
  saveSummarySaved: {
    backgroundColor: 'rgba(134, 167, 137, 0.14)',
    borderColor: 'rgba(134, 167, 137, 0.35)',
  },
  saveSummaryError: {
    backgroundColor: 'rgba(196, 90, 77, 0.14)',
    borderColor: 'rgba(196, 90, 77, 0.35)',
  },
  saveSummaryText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
    color: colors.brand.primary,
  },
  saveSummaryTextSaved: {
    color: '#4D6A50',
  },
  saveSummaryTextError: {
    color: '#8A3B32',
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
  cellSaving: {
    borderColor: colors.brand.primary,
  },
  cellSaveError: {
    borderColor: '#8A3B32',
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
  saveBadge: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  saveBadgeSaved: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  saveBadgeError: {
    backgroundColor: 'rgba(255, 246, 244, 0.95)',
  },
  saveBadgeText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand.primary,
    letterSpacing: 0.2,
  },
  saveBadgeTextError: {
    color: '#8A3B32',
  },
});
