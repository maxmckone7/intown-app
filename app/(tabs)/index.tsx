import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { addFriendsPromptService } from '../../services/addFriendsPrompt';
import { FriendWithStatus } from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import FriendsCalendar from '../../components/FriendsCalendar';
import DayDetailModal from '../../components/DayDetailModal';
import { CalendarSkeleton } from '../../components/Skeleton';
import { colors } from '../../theme';

export default function FriendsCalendarScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
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
      const [friendsList, shouldShowPrompt] = await Promise.all([
        friendsService.getFriends(user.id),
        addFriendsPromptService.shouldShow(user.id),
      ]);
      setFriends(friendsList);
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
