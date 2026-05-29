import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { authService } from '../../services/auth';
import { calendarService } from '../../services/calendar';
import { friendGroupsService } from '../../services/friendGroups';
import { friendsService } from '../../services/friends';
import { privacyService } from '../../services/privacy';
import { addFriendsPromptService } from '../../services/addFriendsPrompt';
import {
  CalendarEntry,
  CalendarStatus,
  FriendGroup,
  FriendWithStatus,
  VisibilityLevel,
} from '../../lib/types';
import { isFriendInTown, isFriendVisible } from '../../lib/heatmap';
import InviteFriends from '../../components/InviteFriends';
import FriendsCalendar from '../../components/FriendsCalendar';
import { FilterGroup } from '../../components/GroupFilter';
import DayDetailModal from '../../components/DayDetailModal';
import { CalendarSkeleton, InviteCardSkeleton } from '../../components/Skeleton';
import StateFeedback from '../../components/StateFeedback';
import Button from '../../components/Button';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme';

const CONTENT_PADDING_BOTTOM = 24;
const HEATMAP_POLL_INTERVAL_MS = 10000;
const REALTIME_REFRESH_DEBOUNCE_MS = 250;

type FriendCalendarEntry = CalendarEntry & {
  friend_name: string;
  friend_id: string;
};

const getSingleParam = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
type SelectedDay = {
  date: string;
  groupId: string;
};

function showAlert(title: string, message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function formatDayForMessage(isoDate: string): string {
  return format(new Date(`${isoDate}T00:00:00`), 'EEEE, MMM d');
}

function openEmail(recipients: string[], subject: string, body: string) {
  const uniqueRecipients = Array.from(new Set(recipients.filter(Boolean)));
  if (uniqueRecipients.length === 0) {
    showAlert('No email available', 'This friend does not have an email address.');
    return;
  }

  const url = `mailto:${uniqueRecipients.join(',')}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;

  Linking.openURL(url).catch(() => {
    showAlert('Message unavailable', 'Could not open your email app.');
  });
}

export default function FriendsCalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    date?: string | string[];
    groupId?: string | string[];
  }>();
  const routeDate = getSingleParam(params.date);
  const routeGroupId = getSingleParam(params.groupId);
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [visibility, setVisibility] = useState<Map<string, VisibilityLevel>>(new Map());
  const [friendEntries, setFriendEntries] = useState<FriendCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [showAddFriendsPrompt, setShowAddFriendsPrompt] = useState(false);
  const [needsAvailabilitySetup, setNeedsAvailabilitySetup] = useState(false);

  const refreshFriendEntries = useCallback(
    async (
      currentUserId: string,
      options: { showRefreshing?: boolean; showErrors?: boolean } = {}
    ) => {
      const { showRefreshing = false, showErrors = false } = options;

      try {
        if (showRefreshing) {
          setIsRefreshing(true);
        }

        const entriesList = await calendarService.getFriendsEntries(currentUserId);
        setFriendEntries(entriesList);
        setLastUpdatedAt(new Date());
      } catch (error: any) {
        if (showErrors) {
          Alert.alert('Error', error.message || 'Failed to refresh availability');
        } else if (__DEV__) {
          console.warn('Failed to refresh heatmap availability:', error);
        }
      } finally {
        if (showRefreshing) {
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (routeDate && isIsoDate(routeDate)) {
      setSelectedDay({ date: routeDate, groupId: routeGroupId || 'all' });
    }

    if (routeGroupId) {
      setSelectedGroupId(routeGroupId);
    }
  }, [routeDate, routeGroupId]);

  const loadUserAndFriends = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        setLoadError('We could not confirm your session. Please sign in again.');
        setShowAddFriendsPrompt(false);
        return;
      }

      setUserId(user.id);
      const [
        friendsList,
        groupsList,
        entriesList,
        visibilityMap,
        shouldShowPrompt,
        shouldSetAvailability,
      ] = await Promise.all([
        friendsService.getFriends(user.id),
        friendGroupsService.getGroups(user.id),
        calendarService.getFriendsEntries(user.id),
        privacyService.getViewerVisibility(),
        addFriendsPromptService.shouldShow(user.id),
        addFriendsPromptService.shouldSetAvailability(user.id),
      ]);
      setFriends(friendsList);
      setFriendGroups(groupsList);
      setFriendEntries(entriesList);
      setVisibility(visibilityMap);
      setLastUpdatedAt(new Date());
      setNeedsAvailabilitySetup(shouldSetAvailability);
      setShowAddFriendsPrompt(!shouldSetAvailability && shouldShowPrompt);
    } catch (error: any) {
      setLoadError(error.message || 'Failed to load your friends calendar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUserAndFriends();
  }, [loadUserAndFriends]);

  useEffect(() => {
    if (!userId || friends.length === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      void refreshFriendEntries(userId);
    }, HEATMAP_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [friends.length, refreshFriendEntries, userId]);

  useEffect(() => {
    if (!userId || friends.length === 0 || typeof supabase.channel !== 'function') {
      return undefined;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      refreshTimer = setTimeout(() => {
        void refreshFriendEntries(userId, { showRefreshing: true });
      }, REALTIME_REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase.channel(`friends-calendar:${userId}`);
    friends.forEach((friend) => {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'calendar_entries',
          filter: `user_id=eq.${friend.id}`,
        },
        scheduleRefresh
      );
    });
    channel.subscribe();

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      if (typeof supabase.removeChannel === 'function') {
        void supabase.removeChannel(channel);
      } else if (typeof channel.unsubscribe === 'function') {
        void channel.unsubscribe();
      }
    };
  }, [friends, refreshFriendEntries, userId]);

  const dismissAddFriendsPrompt = () => {
    setShowAddFriendsPrompt(false);
    if (userId) {
      void addFriendsPromptService.dismiss(userId);
    }
  };

  const handleAddFriendsPress = () => {
    dismissAddFriendsPrompt();
    router.push('/(tabs)/friends');
  };

  const handleSetAvailabilityPress = () => {
    router.push('/(tabs)/my-calendar');
  };

  const groups = useMemo<FilterGroup[]>(
    () =>
      friendGroups.map((group) => ({
        id: group.id,
        label: group.name,
        friendIds: group.friend_ids,
      })),
    [friendGroups]
  );

  const allFriendIds = useMemo(() => friends.map((friend) => friend.id), [friends]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedDay?.groupId),
    [groups, selectedDay?.groupId]
  );

  const dayDetailFriends = useMemo(() => {
    if (!selectedDay || selectedDay.groupId === 'all') {
      return friends;
    }

    const groupFriendIds = new Set(selectedGroup?.friendIds ?? []);
    return friends.filter((friend) => groupFriendIds.has(friend.id));
  }, [friends, selectedDay, selectedGroup?.friendIds]);

  const statusesByDate = useMemo(() => {
    const byDate = new Map<string, Map<string, CalendarStatus>>();

    for (const entry of friendEntries) {
      if (!byDate.has(entry.date)) {
        byDate.set(entry.date, new Map<string, CalendarStatus>());
      }
      byDate.get(entry.date)!.set(entry.user_id, entry.status);
    }

    return byDate;
  }, [friendEntries]);

  const getDayData = useCallback(
    (isoDate: string, groupId: string) => {
      const groupFriendIds =
        groupId === 'all'
          ? allFriendIds
          : groups.find((group) => group.id === groupId)?.friendIds ?? [];
      // Friends who hid their calendar (or are appearing away) drop out of the
      // count entirely; the rest are counted per their shared visibility level.
      const visibleFriendIds = groupFriendIds.filter((friendId) =>
        isFriendVisible(visibility.get(friendId))
      );
      const dayStatuses = statusesByDate.get(isoDate);
      const friendsInTown = visibleFriendIds.filter((friendId) =>
        isFriendInTown(visibility.get(friendId), dayStatuses?.get(friendId))
      ).length;

      return {
        date: isoDate,
        friendsInTown,
        totalFriends: visibleFriendIds.length,
      };
    },
    [allFriendIds, groups, statusesByDate, visibility]
  );

  const handleMessageFriend = useCallback(
    (friend: FriendWithStatus, date: string) => {
      const displayDate = formatDayForMessage(date);
      const friendName = friend.name || friend.email;
      openEmail(
        [friend.email],
        `InTown on ${displayDate}`,
        `Hey ${friendName}, I saw you're in town on ${displayDate}. Want to catch up?`
      );
    },
    []
  );

  const handleProposeHangout = useCallback(
    (availableFriends: FriendWithStatus[], date: string) => {
      const displayDate = formatDayForMessage(date);
      const names = availableFriends
        .map((friend) => friend.name || friend.email)
        .join(', ');

      openEmail(
        availableFriends.map((friend) => friend.email),
        `Hang out on ${displayDate}?`,
        `Hey${names ? ` ${names}` : ''}, looks like we're all in town on ${displayDate}. Want to plan something?`
      );
    },
    []
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <CalendarSkeleton />
        <View style={styles.inviteSection}>
          <InviteCardSkeleton />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.errorContainer}>
        <StateFeedback
          eyebrow="Calendar unavailable"
          title="We could not load this page"
          body={loadError}
          primaryAction={{
            label: 'Try again',
            onPress: () => {
              void loadUserAndFriends();
            },
            loading,
          }}
        />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: CONTENT_PADDING_BOTTOM + insets.bottom },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {needsAvailabilitySetup && (
          <View style={styles.onboardingCard}>
            <View style={styles.onboardingCopy}>
              <Text style={styles.onboardingEyebrow}>First run</Text>
              <Text style={styles.onboardingTitle}>
                Set your availability before inviting friends
              </Text>
              <Text style={styles.onboardingBody}>
                Start with your own calendar so friends know when you are in
                town. After that, we will guide you into inviting people.
              </Text>
              <View style={styles.stepRow}>
                <View style={styles.stepPillActive}>
                  <Text style={styles.stepTextActive}>1. Availability</Text>
                </View>
                <View style={styles.stepPill}>
                  <Text style={styles.stepText}>2. Invite friends</Text>
                </View>
              </View>
            </View>
            <Button
              label="Set availability"
              onPress={handleSetAvailabilityPress}
              style={styles.onboardingButton}
            />
          </View>
        )}
        <FriendsCalendar
          totalFriends={friends.length}
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          getDayData={getDayData}
          lastUpdatedAt={lastUpdatedAt}
          isRefreshing={isRefreshing}
          onDayPress={(iso, groupId) => setSelectedDay({ date: iso, groupId })}
          onAddFriendsPress={handleAddFriendsPress}
          showEmptyStatePrompt={showAddFriendsPrompt}
          onDismissEmptyState={dismissAddFriendsPrompt}
        />
        {!needsAvailabilitySetup && (
          <View style={styles.inviteSection}>
            <InviteFriends />
          </View>
        )}
      </ScrollView>
      <DayDetailModal
        visible={selectedDay !== null}
        date={selectedDay?.date ?? null}
        friends={dayDetailFriends}
        groupLabel={selectedGroup?.label}
        calendarEntries={friendEntries}
        visibility={visibility}
        onClose={() => setSelectedDay(null)}
        onMessage={handleMessageFriend}
        onProposeHangout={handleProposeHangout}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    paddingBottom: CONTENT_PADDING_BOTTOM,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    padding: spacing[4],
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onboardingCard: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    marginTop: spacing[7],
    marginHorizontal: spacing[4],
    marginBottom: -spacing[4],
    padding: spacing[5],
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadows.md,
  },
  onboardingCopy: {
    flex: 1,
    minWidth: 260,
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
    fontSize: typography.display.small.fontSize,
    lineHeight: typography.display.small.lineHeight,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  onboardingBody: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    lineHeight: typography.body.default.lineHeight,
    color: colors.text.secondary,
    maxWidth: 620,
  },
  stepRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  stepPillActive: {
    borderRadius: radius.full,
    backgroundColor: 'rgba(0, 122, 255, 0.12)',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  stepPill: {
    borderRadius: radius.full,
    backgroundColor: colors.background.secondary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  stepTextActive: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
  },
  stepText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '700',
    color: colors.text.secondary,
  },
  onboardingButton: {
    minWidth: 180,
  },
  inviteSection: {
    paddingHorizontal: 16,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    marginTop: 8,
  },
});
