import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

const getSingleParam = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export default function FriendsCalendarScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    date?: string | string[];
    groupId?: string | string[];
  }>();
  const routeDate = getSingleParam(params.date);
  const routeGroupId = getSingleParam(params.groupId);
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [friendEntries, setFriendEntries] = useState<
    Array<CalendarEntry & { friend_name: string; friend_id: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [showAddFriendsPrompt, setShowAddFriendsPrompt] = useState(false);

  useEffect(() => {
    loadUserAndFriends();
  }, []);

  useEffect(() => {
    if (routeDate && isIsoDate(routeDate)) {
      setSelectedDate(routeDate);
    }

    if (routeGroupId) {
      setSelectedGroupId(routeGroupId);
    }
  }, [routeDate, routeGroupId]);

  const loadUserAndFriends = async () => {
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
      setShowAddFriendsPrompt(shouldShowPrompt);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  };

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

  const selectedGroupFriendIds = useMemo(
    () =>
      selectedGroupId === 'all'
        ? allFriendIds
        : groups.find((group) => group.id === selectedGroupId)?.friendIds ?? [],
    [allFriendIds, groups, selectedGroupId]
  );

  const modalFriends = useMemo(
    () =>
      selectedGroupId === 'all'
        ? friends
        : friends.filter((friend) => selectedGroupFriendIds.includes(friend.id)),
    [friends, selectedGroupFriendIds, selectedGroupId]
  );

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
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          getDayData={getDayData}
          onDayPress={(iso) => setSelectedDate(iso)}
          onAddFriendsPress={handleAddFriendsPress}
          showEmptyStatePrompt={showAddFriendsPrompt}
          onDismissEmptyState={dismissAddFriendsPrompt}
        />
        <View style={styles.inviteSection}>
          <InviteFriends />
        </View>
      </ScrollView>
      <DayDetailModal
        visible={selectedDate !== null}
        date={selectedDate}
        friends={modalFriends}
        calendarEntries={friendEntries}
        onClose={() => setSelectedDate(null)}
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
