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
  Platform,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { calendarService } from '../../services/calendar';
import { CalendarEntry, User, FriendWithStatus } from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';

type FriendCalendarEntry = CalendarEntry & { friend_name: string; friend_id: string };

const showConfirmation = (
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void | Promise<void>
) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) {
      void onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: confirmText,
      style: 'destructive',
      onPress: () => {
        void onConfirm();
      },
    },
  ]);
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
  const [friendAvailabilityEntries, setFriendAvailabilityEntries] = useState<FriendCalendarEntry[]>([]);
  const [selectedFriendDate, setSelectedFriendDate] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadUserAndFriends();
  }, []);

  useEffect(() => {
    if (activeTab === 'calendar' && friends.length > 0) {
      loadFriendsCalendar();
    } else if (activeTab === 'calendar') {
      setFriendsCalendarEntries({});
      setFriendAvailabilityEntries([]);
      setSelectedFriendDate(null);
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
      setFriendAvailabilityEntries(entries);

      // Group entries by date
      const entriesByDate: Record<string, { inTown: number; outOfTown: number }> = {};
      
      entries.forEach((entry: any) => {
        if (!entriesByDate[entry.date]) {
          entriesByDate[entry.date] = { inTown: 0, outOfTown: 0 };
        }
        if (entry.status === 'in_town') {
          entriesByDate[entry.date].inTown++;
        } else {
          entriesByDate[entry.date].outOfTown++;
        }
      });

      // Calculate heat map colors based on friend availability
      Object.keys(entriesByDate).forEach((date) => {
        const { inTown, outOfTown } = entriesByDate[date];
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
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends calendar');
    }
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();

    if (!query) {
      Alert.alert('Search', 'Enter a name or email to search.');
      return;
    }

    if (!userId) {
      Alert.alert('Error', 'Not authenticated');
      return;
    }

    setSearching(true);
    try {
      const results = await friendsService.searchUsers(query, userId);
      setSearchResults(results);
      setHasSearched(true);
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
      setHasSearched(false);
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
      setHasSearched(false);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to follow user');
    }
  };

  const handleUnfollow = async (friendId: string) => {
    if (!userId) return;

    showConfirmation(
      'Unfollow',
      'Are you sure you want to unfollow this friend?',
      'Unfollow',
      async () => {
        try {
          await friendsService.unfollowUser(userId, friendId);
          await loadFriends(userId);
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to unfollow');
        }
      }
    );
  };

  const handleFriendsCalendarDatePress = (day: DateData) => {
    setSelectedFriendDate(day.dateString);
  };

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
      <TouchableOpacity
        style={styles.unfollowButton}
        onPress={() => handleUnfollow(item.id)}
      >
        <Text style={styles.unfollowButtonText}>Unfollow</Text>
      </TouchableOpacity>
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
          <TouchableOpacity
            style={styles.followButton}
            onPress={() => handleFollow(item.id)}
          >
            <Text style={styles.followButtonText}>Follow</Text>
          </TouchableOpacity>
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

  const searchDisabled = searching || !searchQuery.trim() || !userId;
  const selectedFriendEntries = selectedFriendDate
    ? friendAvailabilityEntries.filter((entry) => entry.date === selectedFriendDate)
    : [];
  const selectedInTownFriends = selectedFriendEntries.filter((entry) => entry.status === 'in_town');
  const selectedOutOfTownFriends = selectedFriendEntries.filter(
    (entry) => entry.status === 'out_of_town'
  );
  const markedFriendsCalendarEntries = {
    ...friendsCalendarEntries,
    ...(selectedFriendDate && {
      [selectedFriendDate]: {
        ...friendsCalendarEntries[selectedFriendDate],
        customStyles: {
          ...friendsCalendarEntries[selectedFriendDate]?.customStyles,
          container: {
            backgroundColor:
              friendsCalendarEntries[selectedFriendDate]?.customStyles?.container?.backgroundColor ||
              '#EAF3FF',
            borderRadius: 8,
            ...friendsCalendarEntries[selectedFriendDate]?.customStyles?.container,
            borderWidth: 2,
            borderColor: '#007AFF',
          },
          text: {
            color:
              friendsCalendarEntries[selectedFriendDate]?.customStyles?.text?.color || '#007AFF',
            fontWeight: '700',
            ...friendsCalendarEntries[selectedFriendDate]?.customStyles?.text,
          },
        },
      },
    }),
  };

  return (
    <View style={styles.container}>
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
            markedDates={markedFriendsCalendarEntries}
            markingType="custom"
            onDayPress={handleFriendsCalendarDatePress}
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
          <View style={styles.dateDetails}>
            {selectedFriendDate ? (
              <>
                <Text style={styles.dateDetailsTitle}>{selectedFriendDate}</Text>
                {selectedFriendEntries.length === 0 ? (
                  <Text style={styles.dateDetailsEmpty}>
                    No friend availability updates for this date.
                  </Text>
                ) : (
                  <>
                    <Text style={styles.dateDetailsSection}>
                      In town ({selectedInTownFriends.length})
                    </Text>
                    <Text style={styles.dateDetailsNames}>
                      {selectedInTownFriends.map((entry) => entry.friend_name).join(', ') || 'None'}
                    </Text>
                    <Text style={styles.dateDetailsSection}>
                      Out of town ({selectedOutOfTownFriends.length})
                    </Text>
                    <Text style={styles.dateDetailsNames}>
                      {selectedOutOfTownFriends.map((entry) => entry.friend_name).join(', ') ||
                        'None'}
                    </Text>
                  </>
                )}
              </>
            ) : (
              <Text style={styles.dateDetailsEmpty}>
                Tap a date to see which friends have shared availability.
              </Text>
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
              returnKeyType="search"
            />
            <TouchableOpacity
              style={[styles.searchButton, searchDisabled && styles.disabledButton]}
              onPress={handleSearch}
              disabled={searchDisabled}
            >
              {searching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.searchButtonText}>Search</Text>
              )}
            </TouchableOpacity>
          </View>

          {hasSearched && !searching && searchResults.length === 0 ? (
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
    color: '#666',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  friendEmail: {
    fontSize: 14,
    color: '#666',
  },
  followButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  followButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  unfollowButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  unfollowButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  followingText: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
  },
  dateDetails: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F5F9FF',
    borderWidth: 1,
    borderColor: '#D6E9FF',
  },
  dateDetailsTitle: {
    color: '#333',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  dateDetailsSection: {
    color: '#333',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  dateDetailsNames: {
    color: '#666',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  dateDetailsEmpty: {
    color: '#666',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
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
  searchButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
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
  inviteSection: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    marginTop: 20,
  },
});

