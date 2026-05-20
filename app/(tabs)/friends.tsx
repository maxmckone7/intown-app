import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { calendarService } from '../../services/calendar';
import { CalendarEntry, CalendarStatus, User, FriendWithStatus } from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import Button from '../../components/Button';
import Header from '../../components/Header';

type FriendCalendarEntry = CalendarEntry & {
  friend_name: string;
  friend_id: string;
};

export default function FriendsScreen() {
  // Default to calendar view (heatmap) as specified
  const [activeTab, setActiveTab] = useState<'list' | 'calendar' | 'search'>('calendar');
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [friendsCalendarEntries, setFriendsCalendarEntries] = useState<Record<string, any>>({});
  const [friendsEntriesByDate, setFriendsEntriesByDate] = useState<Record<string, FriendCalendarEntry[]>>({});
  const [selectedFriendsDate, setSelectedFriendsDate] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadUserAndFriends();
  }, []);

  useEffect(() => {
    if (activeTab === 'calendar' && friends.length > 0) {
      loadFriendsCalendar();
    }
  }, [activeTab, friends]);

  const loadUserAndFriends = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }

      setUserId(user.id);
      await loadFriends(user.id);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  };

  const loadFriends = async (uid: string) => {
    try {
      const friendsList = await friendsService.getFriends(uid);
      setFriends(friendsList);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
    }
  };

  const loadFriendsCalendar = async () => {
    if (!userId) return;

    try {
      const entries = await calendarService.getFriendsEntries(userId);
      const markedDates: Record<string, any> = {};
      const availabilityByDate: Record<string, FriendCalendarEntry[]> = {};

      // Group entries by date
      const countsByDate: Record<string, { inTown: number; outOfTown: number }> = {};
      
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

      // Calculate heat map colors based on friend availability
      Object.keys(countsByDate).forEach((date) => {
        const { inTown, outOfTown } = countsByDate[date];
        const total = inTown + outOfTown;
        
        if (total === 0) {
          // Edge case: Zero friends for this date - treat as 0-25% (red)
          markedDates[date] = {
            customStyles: {
              container: {
                backgroundColor: '#F44336',
                borderRadius: 8,
              },
              text: {
                color: '#fff',
                fontWeight: '600',
              },
            },
          };
          return;
        }

        const inTownRatio = inTown / total;
        let backgroundColor: string;

        // Heat map color thresholds (no visible legend - thresholds only in code)
        // Green: 75-100% of friends in town
        // Yellow: 50-75% in town
        // Orange: 25-50% in town
        // Red: 0-25% in town
        if (inTownRatio >= 0.75) {
          // 75-100% of friends in town - Green
          backgroundColor = '#4CAF50';
        } else if (inTownRatio >= 0.5) {
          // 50-75% of friends in town - Yellow
          backgroundColor = '#FFC107';
        } else if (inTownRatio >= 0.25) {
          // 25-50% of friends in town - Orange
          backgroundColor = '#FF9800';
        } else {
          // 0-25% of friends in town - Red
          backgroundColor = '#F44336';
        }

        markedDates[date] = {
          customStyles: {
            container: {
              backgroundColor,
              borderRadius: 8,
            },
            text: {
              color: '#fff',
              fontWeight: '600',
            },
          },
        };
      });

      setFriendsCalendarEntries(markedDates);
      setFriendsEntriesByDate(availabilityByDate);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends calendar');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !userId) return;

    setSearching(true);
    try {
      const results = await friendsService.searchUsers(searchQuery, userId);
      setSearchResults(results);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to search users');
    } finally {
      setSearching(false);
    }
  };

  const handleSearchQueryChange = (value: string) => {
    setSearchQuery(value);
    if (!value.trim()) {
      setSearchResults([]);
    }
  };

  const handleFollow = async (friendId: string) => {
    if (!userId) return;

    try {
      await friendsService.followUser(userId, friendId);
      Alert.alert('Success', 'Friend added!');
      await loadFriends(userId);
      setActiveTab('list');
      setSearchQuery('');
      setSearchResults([]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to follow user');
    }
  };

  const handleUnfollow = async (friendId: string) => {
    if (!userId) return;

    Alert.alert(
      'Unfollow',
      'Are you sure you want to unfollow this friend?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unfollow',
          style: 'destructive',
          onPress: async () => {
            try {
              await friendsService.unfollowUser(userId, friendId);
              await loadFriends(userId);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to unfollow');
            }
          },
        },
      ]
    );
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

  const getFriendName = (friend: FriendWithStatus) => friend.name || friend.email;

  const renderFriendItem = ({ item }: { item: FriendWithStatus }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.name?.charAt(0).toUpperCase() || item.email.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.friendDetails}>
          <Text style={styles.friendName}>{item.name || item.email}</Text>
          <Text style={styles.friendEmail}>{item.email}</Text>
        </View>
      </View>
      <Button
        label="Unfollow"
        variant="secondary"
        size="sm"
        onPress={() => handleUnfollow(item.id)}
      />
    </View>
  );

  const renderSearchResult = ({ item }: { item: User }) => {
    const isFollowing = friends.some((f) => f.id === item.id);

    return (
      <View style={styles.friendItem}>
        <View style={styles.friendInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.name?.charAt(0).toUpperCase() || item.email.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.friendDetails}>
            <Text style={styles.friendName}>{item.name || item.email}</Text>
            <Text style={styles.friendEmail}>{item.email}</Text>
          </View>
        </View>
        {isFollowing ? (
          <Text style={styles.followingText}>Following</Text>
        ) : (
          <Button
            label="Follow"
            variant="primary"
            size="sm"
            onPress={() => handleFollow(item.id)}
          />
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const isSearchDisabled = searching || !searchQuery.trim();
  const selectedFriendAvailability = selectedFriendsDate
    ? getFriendAvailabilityForDate(selectedFriendsDate)
    : [];
  const selectedDateMark = selectedFriendsDate
    ? friendsCalendarEntries[selectedFriendsDate]
    : undefined;

  return (
    <View style={styles.container}>
      <Header />
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'calendar' && styles.activeTab]}
          onPress={() => setActiveTab('calendar')}
        >
          <Text style={[styles.tabText, activeTab === 'calendar' && styles.activeTabText]}>
            Calendar
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'list' && styles.activeTab]}
          onPress={() => setActiveTab('list')}
        >
          <Text style={[styles.tabText, activeTab === 'list' && styles.activeTabText]}>
            Friends
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'search' && styles.activeTab]}
          onPress={() => setActiveTab('search')}
        >
          <Text style={[styles.tabText, activeTab === 'search' && styles.activeTabText]}>
            Search
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'list' && (
        <View style={styles.content}>
          {friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No friends yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Search for users to add them as friends
              </Text>
            </View>
          ) : (
            <FlatList
              data={friends}
              renderItem={renderFriendItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
            />
          )}
        </View>
      )}

      {activeTab === 'calendar' && (
        <View style={styles.content}>
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
                      borderColor: '#007AFF',
                      backgroundColor:
                        selectedDateMark?.customStyles?.container?.backgroundColor || '#EAF3FF',
                      borderRadius: 8,
                    },
                    text: {
                      ...selectedDateMark?.customStyles?.text,
                      color: selectedDateMark?.customStyles?.text?.color || '#007AFF',
                      fontWeight: '700',
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
              textDayFontWeight: '400',
              textMonthFontWeight: '600',
              textDayHeaderFontWeight: '600',
              calendarBackground: '#fff',
              textSectionTitleColor: '#666',
              textDisabledColor: '#d9e1e8',
            }}
          />
          <View style={styles.dateSummary}>
            {friends.length === 0 ? (
              <>
                <Text style={styles.dateSummaryTitle}>No friends yet</Text>
                <Text style={styles.dateSummaryText}>
                  Add friends from Search to see their availability by date.
                </Text>
              </>
            ) : selectedFriendsDate ? (
              <>
                <Text style={styles.dateSummaryTitle}>
                  {formatCalendarDate(selectedFriendsDate)}
                </Text>
                {selectedFriendAvailability.map(({ friend, status }) => (
                  <View key={friend.id} style={styles.availabilityRow}>
                    <Text style={styles.availabilityName}>{getFriendName(friend)}</Text>
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
          {/* Invite Friends Section */}
          <View style={styles.inviteSection}>
            <InviteFriends />
          </View>
        </View>
      )}

      {activeTab === 'search' && (
        <View style={styles.content}>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or email..."
              value={searchQuery}
              onChangeText={handleSearchQueryChange}
              onSubmitEditing={handleSearch}
            />
            <Button
              label="Search"
              variant="primary"
              onPress={handleSearch}
              loading={searching}
              disabled={isSearchDisabled}
            />
          </View>

          {searchResults.length === 0 && searchQuery ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No users found</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              renderItem={renderSearchResult}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 16,
    color: '#555',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  list: {
    padding: 16,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  friendDetails: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  friendEmail: {
    fontSize: 16,
    color: '#6B6B6B',
  },
  followingText: {
    color: '#2E7D32',
    fontSize: 16,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
  },
  legend: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    fontSize: 14,
    color: '#666',
  },
  dateSummary: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F7FAFF',
    borderWidth: 1,
    borderColor: '#E1EDFF',
  },
  dateSummaryTitle: {
    color: '#111',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  dateSummaryText: {
    color: '#555',
    fontSize: 16,
    lineHeight: 22,
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E1EDFF',
  },
  availabilityName: {
    color: '#111',
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
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    marginTop: 20,
  },
});

