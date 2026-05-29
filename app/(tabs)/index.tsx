import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
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
import { CalendarSkeleton } from '../../components/Skeleton';
import { colors } from '../../theme';

export default function FriendsCalendarScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [friendEntries, setFriendEntries] = useState<
    Array<CalendarEntry & { friend_name: string; friend_id: string }>
  >([]);
  const [visibility, setVisibility] = useState<Map<string, VisibilityLevel>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddFriendsPrompt, setShowAddFriendsPrompt] = useState(false);

  useEffect(() => {
    loadUserAndFriends();
  }, []);

  const loadUserAndFriends = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        setShowAddFriendsPrompt(false);
        return;
      }
      setUserId(user.id);
      const [friendsList, groupsList, entriesList, visibilityMap, shouldShowPrompt] =
        await Promise.all([
          friendsService.getFriends(user.id),
          friendGroupsService.getGroups(user.id),
          calendarService.getFriendsEntries(user.id),
          privacyService.getViewerVisibility(),
          addFriendsPromptService.shouldShow(user.id),
        ]);
      setFriends(friendsList);
      setFriendGroups(groupsList);
      setFriendEntries(entriesList);
      setVisibility(visibilityMap);
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
        friends={friends}
        calendarEntries={friendEntries}
        visibility={visibility}
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
