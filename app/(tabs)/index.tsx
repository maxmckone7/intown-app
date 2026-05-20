import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { FriendWithStatus } from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import FriendsCalendar from '../../components/FriendsCalendar';
import DayDetailModal from '../../components/DayDetailModal';
import { colors } from '../../theme';

export default function FriendsCalendarScreen() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    loadUserAndFriends();
  }, []);

  const loadUserAndFriends = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }
      const friendsList = await friendsService.getFriends(user.id);
      setFriends(friendsList);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
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
          friends={friends}
          onDayPress={(iso) => setSelectedDate(iso)}
          onAddFriendsPress={() => router.push('/(tabs)/friends')}
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
