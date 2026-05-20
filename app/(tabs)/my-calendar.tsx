import { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { authService } from '../../services/auth';
import { calendarService } from '../../services/calendar';
import { CalendarStatus } from '../../lib/types';
import { colors } from '../../theme';

export default function MyCalendarScreen() {
  const [entries, setEntries] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    loadUserAndEntries();

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.textContent = `
        .react-native-calendars__day-container:hover {
          transform: scale(1.15) !important;
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          z-index: 10 !important;
        }
        .react-native-calendars__day-text:hover {
          transform: scale(1.15) !important;
        }
      `;
      document.head.appendChild(style);

      return () => {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      };
    }
  }, []);

  const loadUserAndEntries = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }

      setUserId(user.id);
      await loadEntries(user.id);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async (uid: string) => {
    try {
      const calendarEntries = await calendarService.getEntries(uid);
      const markedDates: Record<string, any> = {};

      calendarEntries.forEach((entry) => {
        markedDates[entry.date] = {
          customStyles: {
            container: {
              backgroundColor: entry.status === 'in_town' ? '#66BB6A' : '#EF5350',
              borderRadius: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.15,
              shadowRadius: 3,
              elevation: 3,
            },
            text: {
              color: '#fff',
              fontWeight: '600',
            },
          },
        };
      });

      setEntries(markedDates);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load entries');
    }
  };

  const getDatesInMonth = (year: number, month: number): string[] => {
    const dates: string[] = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
  };

  const getAllMarkedDates = (): Record<string, any> => {
    const allMarked: Record<string, any> = {};
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const datesInMonth = getDatesInMonth(year, month);

    datesInMonth.forEach((date) => {
      if (entries[date]) {
        allMarked[date] = entries[date];
      } else {
        allMarked[date] = {
          customStyles: {
            container: {
              backgroundColor: '#66BB6A',
              borderRadius: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 2,
              elevation: 2,
            },
            text: {
              color: '#fff',
              fontWeight: '600',
            },
          },
        };
      }
    });

    return allMarked;
  };

  const handleDatePress = async (day: { dateString: string }) => {
    if (!userId) return;

    const date = day.dateString;
    setSelectedDate(date);

    const existingEntry = entries[date];
    let currentStatus: CalendarStatus;

    if (existingEntry) {
      const bgColor = existingEntry.customStyles?.container?.backgroundColor;
      currentStatus = (bgColor === '#66BB6A' || bgColor === '#4CAF50') ? 'in_town' : 'out_of_town';
    } else {
      currentStatus = 'in_town';
    }

    const newStatus: CalendarStatus = currentStatus === 'in_town' ? 'out_of_town' : 'in_town';

    try {
      const optimisticEntry = {
        customStyles: {
          container: {
            backgroundColor: newStatus === 'in_town' ? '#66BB6A' : '#EF5350',
            borderRadius: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15,
            shadowRadius: 3,
            elevation: 3,
          },
          text: {
            color: '#fff',
            fontWeight: '600',
          },
        },
      };
      setEntries({ ...entries, [date]: optimisticEntry });

      await calendarService.setEntry(userId, date, newStatus);
      await loadEntries(userId);
    } catch (error: any) {
      await loadEntries(userId);
      Alert.alert('Error', error.message || 'Failed to update calendar');
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const handleMonthChange = (month: any) => {
    setCurrentMonth(new Date(month.year, month.month - 1));
  };

  return (
    <View style={styles.container}>
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
        onDayLongPress={(day) => {
          setHoveredDate(day.dateString);
          setTimeout(() => setHoveredDate(null), 200);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
