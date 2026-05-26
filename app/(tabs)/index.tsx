import { useMemo, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  Pressable,
  Platform,
} from 'react-native';
import { authService } from '../../services/auth';
import { calendarService } from '../../services/calendar';
import { CalendarStatus } from '../../lib/types';

type CalendarDay = {
  dateString: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const IN_TOWN_COLOR = '#4CAF50';
const OUT_OF_TOWN_COLOR = '#E74C3C';
const MUTED_DAY_COLOR = '#F4F7FA';

const formatDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const buildCalendarDays = (monthDate: Date): CalendarDay[] => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const today = formatDateString(new Date());
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateString = formatDateString(date);

    return {
      dateString,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
      isToday: dateString === today,
    };
  });
};

export default function MyCalendarScreen() {
  const [entries, setEntries] = useState<Record<string, CalendarStatus>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  useEffect(() => {
    loadUserAndEntries();
  }, []);

  const calendarDays = useMemo(() => buildCalendarDays(currentMonth), [currentMonth]);
  const calendarWeeks = useMemo(() => {
    const weeks: CalendarDay[][] = [];

    for (let index = 0; index < calendarDays.length; index += 7) {
      weeks.push(calendarDays.slice(index, index + 7));
    }

    return weeks;
  }, [calendarDays]);

  const loadUserAndEntries = async () => {
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

  const loadEntries = async (uid: string) => {
    try {
      const calendarEntries = await calendarService.getEntries(uid);
      const statuses: Record<string, CalendarStatus> = {};

      calendarEntries.forEach((entry) => {
        statuses[entry.date] = entry.status;
      });

      setEntries(statuses);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load entries');
    }
  };

  const handleDatePress = async (date: string) => {
    if (!userId) return;

    setSelectedDate(date);
    const currentStatus = entries[date] ?? 'in_town';
    const newStatus: CalendarStatus = currentStatus === 'in_town' ? 'out_of_town' : 'in_town';
    const previousEntries = entries;

    try {
      setEntries({ ...entries, [date]: newStatus });
      await calendarService.setEntry(userId, date, newStatus);
    } catch (error: any) {
      setEntries(previousEntries);
      Alert.alert('Error', error.message || 'Failed to update calendar');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <CalendarSkeleton />
      </View>
    );
  }

  const goToPreviousMonth = () => {
    setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1));
  };

  const renderDay = (day: CalendarDay) => {
    const isHovered = hoveredDate === day.dateString;
    const status = entries[day.dateString] ?? 'in_town';
    const isOutOfTown = status === 'out_of_town';
    const backgroundColor = day.isCurrentMonth
      ? isOutOfTown
        ? OUT_OF_TOWN_COLOR
        : IN_TOWN_COLOR
      : MUTED_DAY_COLOR;

    return (
      <Pressable
        key={day.dateString}
        accessibilityRole="button"
        accessibilityLabel={`${day.dateString}, ${day.isCurrentMonth ? status.replace(/_/g, ' ') : 'outside current month'}`}
        accessibilityState={{ disabled: !day.isCurrentMonth, selected: selectedDate === day.dateString }}
        disabled={!day.isCurrentMonth}
        onHoverIn={() => setHoveredDate(day.dateString)}
        onHoverOut={() => setHoveredDate((current) => (current === day.dateString ? null : current))}
        onPressIn={() => setHoveredDate(day.dateString)}
        onPressOut={() => setHoveredDate((current) => (current === day.dateString ? null : current))}
        onPress={() => handleDatePress(day.dateString)}
        style={[
          styles.dayCell,
          { backgroundColor },
          !day.isCurrentMonth && styles.outsideMonthCell,
          day.isToday && day.isCurrentMonth && styles.todayCell,
          selectedDate === day.dateString && day.isCurrentMonth && styles.selectedCell,
          isHovered && day.isCurrentMonth && styles.hoveredCell,
        ]}
      >
        <Text
          style={[
            styles.dayText,
            !day.isCurrentMonth && styles.outsideMonthText,
            day.isToday && day.isCurrentMonth && styles.todayText,
          ]}
        >
          {day.day}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={styles.appTitle}>InTown</Text>
      </View>

      <View style={styles.calendarShell}>
        <View style={styles.monthHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={goToPreviousMonth}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>‹</Text>
          </Pressable>

          <Text style={styles.monthTitle}>
            {MONTH_LABELS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            onPress={goToNextMonth}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>›</Text>
          </Pressable>
        </View>

        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.dayGrid}>
          {calendarWeeks.map((week, index) => (
            <View key={`week-${index}`} style={styles.weekRow}>
              {week.map(renderDay)}
            </View>
          ))}
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
  calendarShell: {
    marginTop: 18,
    marginHorizontal: Platform.OS === 'web' ? 40 : 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#DCE3EA',
    borderRadius: 18,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  monthHeader: {
    minHeight: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#DCE3EA',
  },
  monthButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  monthButtonText: {
    color: '#333',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
  },
  monthTitle: {
    color: '#333',
    fontSize: 17,
    fontWeight: '800',
  },
  weekdayRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#DCE3EA',
  },
  weekdayLabel: {
    flex: 1,
    paddingVertical: 12,
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  dayGrid: {
    overflow: 'visible',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? 86 : 58,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: Platform.OS === 'web' ? 10 : 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#DCE3EA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0,
    shadowRadius: 12,
    elevation: 0,
  },
  outsideMonthCell: {
    opacity: 0.75,
  },
  hoveredCell: {
    transform: [{ scale: 1.06 }],
    borderRadius: 12,
    zIndex: 5,
    shadowOpacity: 0.18,
    elevation: 6,
  },
  selectedCell: {
    borderColor: '#1D4ED8',
    borderWidth: 2,
  },
  todayCell: {
    borderColor: '#111827',
    borderWidth: 2,
  },
  dayText: {
    color: '#fff',
    fontSize: Platform.OS === 'web' ? 16 : 13,
    fontWeight: '800',
  },
  outsideMonthText: {
    color: '#B7C3CF',
  },
  todayText: {
    textDecorationLine: 'underline',
  },
});
