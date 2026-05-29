import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { authService } from '../../services/auth';
import { calendarService } from '../../services/calendar';
import { friendGroupsService } from '../../services/friendGroups';
import { friendsService } from '../../services/friends';
import { addFriendsPromptService } from '../../services/addFriendsPrompt';
import {
  CalendarEntry,
  CalendarStatus,
  FriendGroup,
  FriendWithStatus,
} from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import FriendsCalendar from '../../components/FriendsCalendar';
import { FilterGroup } from '../../components/GroupFilter';
import DayDetailModal from '../../components/DayDetailModal';
import { CalendarSkeleton } from '../../components/Skeleton';
import { colors } from '../../theme';

const HEATMAP_POLL_INTERVAL_MS = 10000;
const REALTIME_REFRESH_DEBOUNCE_MS = 250;

type FriendCalendarEntry = CalendarEntry & {
  friend_name: string;
  friend_id: string;
};

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
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [friendEntries, setFriendEntries] = useState<FriendCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [showAddFriendsPrompt, setShowAddFriendsPrompt] = useState(false);

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

  const loadUserAndFriends = useCallback(async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        setShowAddFriendsPrompt(false);
        return;
      }

      setUserId(user.id);
      const [friendsList, groupsList, entriesList, shouldShowPrompt] = await Promise.all([
        friendsService.getFriends(user.id),
        friendGroupsService.getGroups(user.id),
        calendarService.getFriendsEntries(user.id),
        addFriendsPromptService.shouldShow(user.id),
      ]);
      setFriends(friendsList);
      setFriendGroups(groupsList);
      setFriendEntries(entriesList);
      setLastUpdatedAt(new Date());
      setShowAddFriendsPrompt(shouldShowPrompt);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
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
      const dayStatuses = statusesByDate.get(isoDate);
      const friendsInTown = groupFriendIds.filter(
        (friendId) => dayStatuses?.get(friendId) !== 'out_of_town'
      ).length;

      return {
        date: isoDate,
        friendsInTown,
        totalFriends: groupFriendIds.length,
      };
    },
    [allFriendIds, groups, statusesByDate]
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
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <FriendsCalendar
          totalFriends={friends.length}
          groups={groups}
          getDayData={getDayData}
          lastUpdatedAt={lastUpdatedAt}
          isRefreshing={isRefreshing}
          onDayPress={(iso) => setSelectedDate(iso)}
          onDayPress={(iso, groupId) => setSelectedDay({ date: iso, groupId })}
          onAddFriendsPress={handleAddFriendsPress}
          showEmptyStatePrompt={showAddFriendsPrompt}
          onDismissEmptyState={dismissAddFriendsPrompt}
        />
        <View style={styles.inviteSection}>
          <InviteFriends />
        </View>
      </ScrollView>
      <DayDetailModal
        visible={selectedDay !== null}
        date={selectedDay?.date ?? null}
        friends={dayDetailFriends}
        groupLabel={selectedGroup?.label}
        calendarEntries={friendEntries}
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
    paddingBottom: 24,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteSection: {
    paddingHorizontal: 16,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    marginTop: 8,
  },
});
