import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
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

export default function FriendsCalendarScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [friendEntries, setFriendEntries] = useState<
    Array<CalendarEntry & { friend_name: string; friend_id: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddFriendsPrompt, setShowAddFriendsPrompt] = useState(false);
  const [needsAvailabilitySetup, setNeedsAvailabilitySetup] = useState(false);

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
        shouldShowPrompt,
        shouldSetAvailability,
      ] = await Promise.all([
        friendsService.getFriends(user.id),
        friendGroupsService.getGroups(user.id),
        calendarService.getFriendsEntries(user.id),
        addFriendsPromptService.shouldShow(user.id),
        addFriendsPromptService.shouldSetAvailability(user.id),
      ]);
      setFriends(friendsList);
      setFriendGroups(groupsList);
      setFriendEntries(entriesList);
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
        contentContainerStyle={styles.content}
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
          getDayData={getDayData}
          onDayPress={(iso) => setSelectedDate(iso)}
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
        visible={selectedDate !== null}
        date={selectedDate}
        friends={friends}
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
