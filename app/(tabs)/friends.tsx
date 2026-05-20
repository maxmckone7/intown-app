import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { authService } from '../../services/auth';
import { friendsService } from '../../services/friends';
import { User, FriendWithStatus } from '../../lib/types';
import Button from '../../components/Button';
import { colors } from '../../theme';

export default function FriendsScreen() {
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

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

  const runSearch = async (query: string) => {
    if (!query.trim() || !userId) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await friendsService.searchUsers(query, userId);
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
      setSearchQuery('');
      setSearchResults([]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to follow user');
    }
  };

  const handleUnfollow = (friendId: string) => {
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

  const renderFriendItem = ({ item }: { item: FriendWithStatus }) => (
    <View style={styles.friendItem}>
      <View style={styles.friendInfo}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.name?.charAt(0).toUpperCase() ||
              item.email.charAt(0).toUpperCase()}
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
              {item.name?.charAt(0).toUpperCase() ||
                item.email.charAt(0).toUpperCase()}
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
        <ActivityIndicator size="large" color={colors.brand.primary} />
      </View>
    );
  }

  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email..."
          placeholderTextColor={colors.text.tertiary}
          value={searchQuery}
          onChangeText={handleSearchQueryChange}
          onSubmitEditing={() => runSearch(searchQuery)}
          returnKeyType="search"
        />
        <Button
          label="Search"
          variant="primary"
          onPress={() => runSearch(searchQuery)}
          loading={searching}
          disabled={!isSearchActive || searching}
        />
      </View>

      {isSearchActive ? (
        searchResults.length === 0 ? (
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
        )
      ) : friends.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No friends yet</Text>
          <Text style={styles.emptyStateSubtext}>
            Search above to find people to follow.
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
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.background.card,
    color: colors.text.primary,
  },
  list: {
    padding: 16,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
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
    backgroundColor: colors.brand.primary,
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
    color: colors.text.primary,
    marginBottom: 4,
  },
  friendEmail: {
    fontSize: 16,
    color: colors.text.tertiary,
  },
  followingText: {
    color: '#2E7D32',
    fontSize: 16,
    fontWeight: '700',
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
    color: colors.text.primary,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 16,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
