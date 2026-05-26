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
import { FriendWithStatus } from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import FriendsCalendar from '../../components/FriendsCalendar';
import DayDetailModal from '../../components/DayDetailModal';
import { CalendarSkeleton } from '../../components/Skeleton';
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
      <View style={styles.container}>
        <CalendarSkeleton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* InTown Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.appTitle}>InTown</Text>
      </View>

      <View style={styles.calendarWrapper}>
        <Calendar
        onDayPress={handleDatePress}
        onMonthChange={handleMonthChange}
        markedDates={{
          ...getAllMarkedDates(),
          ...(hoveredDate && {
            [hoveredDate]: {
              ...getAllMarkedDates()[hoveredDate],
              customStyles: {
                ...getAllMarkedDates()[hoveredDate]?.customStyles,
                container: {
                  ...getAllMarkedDates()[hoveredDate]?.customStyles?.container,
                  transform: [{ scale: 1.15 }],
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  elevation: 4,
                },
              },
            },
          }),
          ...(selectedDate && entries[selectedDate] && {
            [selectedDate]: {
              ...entries[selectedDate],
              customStyles: {
                ...entries[selectedDate].customStyles,
                container: {
                  ...entries[selectedDate].customStyles?.container,
                  borderWidth: 2,
                  borderColor: '#007AFF',
                },
              },
            },
          }),
        }}
        markingType="custom"
        theme={{
          todayTextColor: '#007AFF',
          selectedDayBackgroundColor: '#007AFF',
          arrowColor: '#333',
          monthTextColor: '#333',
          textDayFontWeight: '500',
          textMonthFontWeight: '700',
          textDayHeaderFontWeight: '600',
          calendarBackground: '#fff',
          textSectionTitleColor: '#666',
          textDisabledColor: '#d9e1e8',
        }}
        // Add hover support for web
        onDayLongPress={(day) => {
          // For mobile, use long press as hover alternative
          setHoveredDate(day.dateString);
          setTimeout(() => setHoveredDate(null), 200);
        }}
      />
      </View>
    </View>
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <FriendsCalendar
          totalFriends={friends.length}
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
  titleContainer: {
    paddingTop: Platform.OS === 'web' ? 24 : 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  appTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#333',
    letterSpacing: -0.5,
  inviteSection: {
    paddingHorizontal: 16,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    marginTop: 8,
  },
  calendarWrapper: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
});
