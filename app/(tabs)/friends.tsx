import { useEffect, useMemo, useState } from 'react';
import {
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
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { FriendWithStatus } from '../../lib/types';
import Button from '../../components/Button';
import AddFriendModal from '../../components/AddFriendModal';
import { FriendsListSkeleton } from '../../components/Skeleton';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '../../theme';

type FriendStatusState = 'in_town' | 'away' | 'returning_soon';

type FriendStatus = {
  state: FriendStatusState;
  label: string; // e.g. "In town until June 3rd"
  pillLabel: string; // e.g. "In town"
};

const STATUS_TEXTS: Record<FriendStatusState, string[]> = {
  in_town: [
    'In town until June 3rd',
    'Around all week',
    'Available all weekend',
    'Free Friday night',
  ],
  away: [
    'Away through next week',
    'Out of town until Sunday',
    'Traveling this weekend',
    'Back next Friday',
  ],
  returning_soon: [
    'Returning Wednesday',
    'Back this weekend',
    'In town Thursday',
    'Home by Friday',
  ],
};

const PILL_LABELS: Record<FriendStatusState, string> = {
  in_town: 'In town',
  away: 'Away',
  returning_soon: 'Returning soon',
};

// Deterministic FNV-style hash so the same friend keeps the same status
// between renders. TODO: replace with real availability aggregated from
// Supabase calendar entries.
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10000;
}

function mockStatusFor(friendId: string): FriendStatus {
  const states: FriendStatusState[] = ['in_town', 'away', 'returning_soon'];
  const state = states[hash(`state|${friendId}`) % states.length];
  const pool = STATUS_TEXTS[state];
  const label = pool[hash(`label|${friendId}`) % pool.length];
  return { state, label, pillLabel: PILL_LABELS[state] };
}

const STATUS_COLORS: Record<FriendStatusState, { text: string; bg: string }> = {
  in_town: { text: '#4D6A50', bg: 'rgba(134, 167, 137, 0.2)' },
  away: { text: '#8A3B32', bg: 'rgba(196, 90, 77, 0.18)' },
  returning_soon: { text: '#7A5A0F', bg: 'rgba(232, 197, 71, 0.25)' },
};

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
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [friendsCalendarEntries, setFriendsCalendarEntries] = useState<Record<string, any>>({});
  const [friendAvailabilityEntries, setFriendAvailabilityEntries] = useState<FriendCalendarEntry[]>([]);
  const [selectedFriendDate, setSelectedFriendDate] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    loadFriends();
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
  const loadFriends = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }
      const list = await friendsService.getFriends(user.id);
      setFriends(list);
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
  const friendsWithStatus = useMemo(
    () => friends.map((f) => ({ friend: f, status: mockStatusFor(f.id) })),
    [friends]
  );

  const inTownThisWeek = useMemo(
    () => friendsWithStatus.filter((f) => f.status.state === 'in_town').length,
    [friendsWithStatus]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friendsWithStatus;
    return friendsWithStatus.filter(({ friend }) => {
      const name = friend.name?.toLowerCase() || '';
      const email = friend.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [friendsWithStatus, searchQuery]);

  if (loading) {
    return (
      <View style={styles.outer}>
        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Friends</Text>
            </View>
          </View>
          <FriendsListSkeleton />
        </View>
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
  const showEmptyState = friends.length === 0;

      {activeTab === 'list' && (
        <View style={styles.content}>
          {friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No friends yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Search for users or invite people to join InTown
              </Text>
              <InviteFriends variant="compact" />
            </View>
          ) : (
            <FlatList
              data={friends}
              renderItem={renderFriendItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
  return (
    <View style={styles.outer}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Friends</Text>
            <Text style={styles.subtitle}>
              {friends.length} friend{friends.length === 1 ? '' : 's'} ·{' '}
              {inTownThisWeek} in town this week
            </Text>
          </View>
          {!showEmptyState && (
            <Button
              label="Add Friend"
              variant="primary"
              onPress={() => setAddOpen(true)}
              style={styles.addButton}
            />
          )}
        </View>

      {activeTab === 'calendar' && (
        <View style={styles.content}>
          <Calendar
            markedDates={markedFriendsCalendarEntries}
          <View style={styles.calendarWrapper}>
            <Calendar
            markedDates={friendsCalendarEntries}
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
        {!showEmptyState && (
          <View
            style={[
              styles.searchBar,
              searchFocused && styles.searchBarFocused,
            ]}
          >
            <Feather
              name="search"
              size={20}
              color={colors.text.tertiary}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
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
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search friends..."
              placeholderTextColor={colors.text.tertiary}
              autoCapitalize="none"
            />
          </View>
        )}

          {hasSearched && !searching && searchResults.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No users found</Text>
        {showEmptyState ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyCircle}>
              <Text style={styles.emptyGlyph}>👋</Text>
            </View>
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptyBody}>
              Add friends to see when they're in town and start planning
              together.
            </Text>
            <Button
              label="Add your first friend"
              variant="primary"
              onPress={() => setAddOpen(true)}
              style={styles.emptyButton}
            />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.friend.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.noMatch}>
                <Text style={styles.noMatchText}>No friends match "{searchQuery}"</Text>
              </View>
            }
            renderItem={({ item }) => (
              <FriendRow
                friend={item.friend}
                status={item.status}
                onMessage={() => {
                  if (typeof window !== 'undefined' && window.alert) {
                    window.alert(
                      `Message ${item.friend.name || item.friend.email} — coming soon.`
                    );
                  }
                }}
              />
            )}
          />
        )}
      </View>

      <AddFriendModal visible={addOpen} onClose={() => setAddOpen(false)} />
    </View>
  );
}

type FriendRowProps = {
  friend: FriendWithStatus;
  status: FriendStatus;
  onMessage: () => void;
};

function FriendRow({ friend, status, onMessage }: FriendRowProps) {
  const initial =
    friend.name?.charAt(0).toUpperCase() ||
    friend.email.charAt(0).toUpperCase();
  const pill = STATUS_COLORS[status.state];

  return (
    <Pressable
      style={({ hovered }: any) => [
        styles.row,
        hovered && styles.rowHover,
      ]}
    >
      <View style={styles.avatar}>
        {friend.avatar_url ? (
          <Image source={{ uri: friend.avatar_url }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarInitial}>{initial}</Text>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName}>{friend.name || friend.email}</Text>
        <Text style={[styles.rowStatus, { color: pill.text }]}>
          {status.label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.text }]}>
            {status.pillLabel}
          </Text>
        </View>
        <Pressable
          onPress={onMessage}
          accessibilityLabel="Message"
          accessibilityRole="button"
          hitSlop={6}
          style={({ pressed, hovered }: any) => [
            styles.messageButton,
            (pressed || hovered) && styles.messageButtonHover,
          ]}
        >
          <Feather
            name="message-circle"
            size={20}
            color={colors.text.secondary}
          />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    paddingTop: spacing[7],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[5],
    flexWrap: 'wrap',
  },
  headerText: {
    flexShrink: 1,
  },
  title: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.medium.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
  },
  addButton: {
    minHeight: 40,
    paddingHorizontal: spacing[4],
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.card,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[4],
  },
  searchBarFocused: {
    borderColor: colors.brand.primary,
    borderWidth: 2,
  },
  searchIcon: {
    marginRight: spacing[2],
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.primary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 80,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  rowHover: {
    backgroundColor: colors.background.secondary,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 2,
  },
  rowStatus: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  pill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  pillText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
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
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
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
  messageButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  messageButtonHover: {
    backgroundColor: colors.background.secondary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[7],
    gap: spacing[3],
  },
  emptyCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.background.secondary,
    marginBottom: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyGlyph: {
    fontSize: 28,
    lineHeight: 32,
  },
  emptyTitle: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 360,
    marginBottom: spacing[3],
  },
  emptyButton: {
    minWidth: 200,
  },
  noMatch: {
    paddingVertical: spacing[5],
    alignItems: 'center',
  },
  dateSummaryText: {
    color: '#666',
    fontSize: 14,
    lineHeight: 20,
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
    color: '#333',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    marginRight: 12,
  },
  availabilityStatus: {
    borderRadius: 999,
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
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
    borderTopColor: '#eee',
    marginTop: 24,
  },
  calendarWrapper: {
    paddingHorizontal: 16,
    paddingTop: 24,
  noMatchText: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
  },
});
