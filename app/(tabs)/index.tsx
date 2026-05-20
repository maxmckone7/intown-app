import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { calendarService } from '../../services/calendar';
import {
  CalendarEntry,
  CalendarStatus,
  FriendWithStatus,
} from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import { colors } from '../../theme';

type FriendCalendarEntry = CalendarEntry & {
  friend_name: string;
  friend_id: string;
};

export default function FriendsCalendarScreen() {
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [friendsCalendarEntries, setFriendsCalendarEntries] = useState<
    Record<string, any>
  >({});
  const [friendsEntriesByDate, setFriendsEntriesByDate] = useState<
    Record<string, FriendCalendarEntry[]>
  >({});
  const [selectedFriendsDate, setSelectedFriendsDate] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadUserAndFriends();
  }, []);

  useEffect(() => {
    if (userId && friends.length > 0) {
      loadFriendsCalendar();
    }
  }, [userId, friends]);

  const loadUserAndFriends = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }
      setUserId(user.id);
      const friendsList = await friendsService.getFriends(user.id);
      setFriends(friendsList);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  };

  const loadFriendsCalendar = async () => {
    if (!userId) return;

    try {
      const entries = await calendarService.getFriendsEntries(userId);
      const markedDates: Record<string, any> = {};
      const availabilityByDate: Record<string, FriendCalendarEntry[]> = {};
      const countsByDate: Record<
        string,
        { inTown: number; outOfTown: number }
      > = {};

      entries.forEach((entry) => {
        if (!availabilityByDate[entry.date]) {
          availabilityByDate[entry.date] = [];
        }
        availabilityByDate[entry.date].push(entry);

        if (!countsByDate[entry.date]) {
          countsByDate[entry.date] = { inTown: 0, outOfTown: 0 };
        }
        if (entry.status === 'in_town') {
          countsByDate[entry.date].inTown++;
        } else {
          countsByDate[entry.date].outOfTown++;
        }
      });

      Object.keys(countsByDate).forEach((date) => {
        const { inTown, outOfTown } = countsByDate[date];
        const total = inTown + outOfTown;

        if (total === 0) {
          markedDates[date] = {
            customStyles: {
              container: {
                backgroundColor: colors.heatmap.low,
                borderRadius: 8,
              },
              text: { color: '#fff', fontWeight: '600' },
            },
          };
          return;
        }

        const inTownRatio = inTown / total;
        let backgroundColor: string;

        if (inTownRatio >= 0.8) {
          backgroundColor = colors.heatmap.high;
        } else if (inTownRatio >= 0.6) {
          backgroundColor = colors.heatmap.mediumHigh;
        } else if (inTownRatio >= 0.4) {
          backgroundColor = colors.heatmap.mediumLow;
        } else {
          backgroundColor = colors.heatmap.low;
        }

        markedDates[date] = {
          customStyles: {
            container: {
              backgroundColor,
              borderRadius: 8,
            },
            text: { color: '#fff', fontWeight: '600' },
          },
        };
      });

      setFriendsCalendarEntries(markedDates);
      setFriendsEntriesByDate(availabilityByDate);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends calendar');
    }
  };

  const handleFriendsDatePress = (day: DateData) => {
    setSelectedFriendsDate(day.dateString);
  };

  const getFriendAvailabilityForDate = (date: string) =>
    friends.map((friend) => {
      const explicitEntry = friendsEntriesByDate[date]?.find(
        (entry) => entry.friend_id === friend.id
      );
      return {
        friend,
        status: (explicitEntry?.status || 'in_town') as CalendarStatus,
      };
    });

  const formatCalendarDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  const getFriendName = (friend: FriendWithStatus) =>
    friend.name || friend.email;

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
      </View>
    );
  }

  const selectedFriendAvailability = selectedFriendsDate
    ? getFriendAvailabilityForDate(selectedFriendsDate)
    : [];
  const selectedDateMark = selectedFriendsDate
    ? friendsCalendarEntries[selectedFriendsDate]
    : undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Calendar
        onDayPress={handleFriendsDatePress}
        markedDates={{
          ...friendsCalendarEntries,
          ...(selectedFriendsDate && {
            [selectedFriendsDate]: {
              ...selectedDateMark,
              customStyles: {
                ...selectedDateMark?.customStyles,
                container: {
                  ...selectedDateMark?.customStyles?.container,
                  borderWidth: 2,
                  borderColor: colors.brand.primary,
                  backgroundColor:
                    selectedDateMark?.customStyles?.container
                      ?.backgroundColor || colors.background.secondary,
                  borderRadius: 8,
                },
                text: {
                  ...selectedDateMark?.customStyles?.text,
                  color:
                    selectedDateMark?.customStyles?.text?.color ||
                    colors.brand.primary,
                  fontWeight: '700',
                },
              },
            },
          }),
        }}
        markingType="custom"
        theme={{
          todayTextColor: colors.brand.primary,
          selectedDayBackgroundColor: colors.brand.primary,
          arrowColor: colors.text.primary,
          monthTextColor: colors.text.primary,
          textDayFontWeight: '400',
          textMonthFontWeight: '600',
          textDayHeaderFontWeight: '600',
          calendarBackground: colors.background.card,
          textSectionTitleColor: colors.text.secondary,
          textDisabledColor: colors.border.default,
        }}
      />

      <View style={styles.dateSummary}>
        {friends.length === 0 ? (
          <>
            <Text style={styles.dateSummaryTitle}>No friends yet</Text>
            <Text style={styles.dateSummaryText}>
              Add friends to see their availability by date.
            </Text>
          </>
        ) : selectedFriendsDate ? (
          <>
            <Text style={styles.dateSummaryTitle}>
              {formatCalendarDate(selectedFriendsDate)}
            </Text>
            {selectedFriendAvailability.map(({ friend, status }) => (
              <View key={friend.id} style={styles.availabilityRow}>
                <Text style={styles.availabilityName}>
                  {getFriendName(friend)}
                </Text>
                <Text
                  style={[
                    styles.availabilityStatus,
                    status === 'in_town'
                      ? styles.availabilityInTown
                      : styles.availabilityOutOfTown,
                  ]}
                >
                  {status === 'in_town' ? 'In town' : 'Out of town'}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={styles.dateSummaryTitle}>Friend availability</Text>
            <Text style={styles.dateSummaryText}>
              Tap any date to see which friends are in town or out of town.
            </Text>
          </>
        )}
      </View>

      <View style={styles.inviteSection}>
        <InviteFriends />
      </View>
    </ScrollView>
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
  dateSummary: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  dateSummaryTitle: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  dateSummaryText: {
    color: colors.text.secondary,
    fontSize: 16,
    lineHeight: 22,
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  availabilityName: {
    color: colors.text.primary,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    marginRight: 12,
  },
  availabilityStatus: {
    borderRadius: 999,
    fontSize: 14,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  availabilityInTown: {
    backgroundColor: '#E8F5E9',
    color: '#2E7D32',
  },
  availabilityOutOfTown: {
    backgroundColor: '#FFEBEE',
    color: '#C62828',
  },
  inviteSection: {
    paddingTop: 24,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    marginTop: 8,
  },
});
