import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { authService } from '../../services/auth';
import { calendarService } from '../../services/calendar';
import { friendsService } from '../../services/friends';
import { privacyService } from '../../services/privacy';
import { CalendarStatus, FriendWithStatus, VisibilityLevel } from '../../lib/types';
import { isFriendInTown, isFriendVisible } from '../../lib/heatmap';
import Button from '../../components/Button';
import AddFriendModal from '../../components/AddFriendModal';
import InviteFriends from '../../components/InviteFriends';
import { FriendsListSkeleton } from '../../components/Skeleton';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '../../theme';

type FriendStatusState = 'in_town' | 'away' | 'unknown';

type FriendStatus = {
  state: FriendStatusState;
  label: string; // e.g. "In town until June 3rd"
  pillLabel: string; // e.g. "In Town"
};

const STATUS_COLORS: Record<FriendStatusState, { text: string; bg: string }> = {
  in_town: { text: '#4D6A50', bg: 'rgba(134, 167, 137, 0.2)' },
  away: { text: '#8A3B32', bg: 'rgba(196, 90, 77, 0.18)' },
  unknown: { text: colors.text.tertiary, bg: 'rgba(120, 113, 108, 0.12)' },
};

const buildStatus = (
  level: VisibilityLevel | undefined,
  status: CalendarStatus | undefined
): FriendStatus => {
  // Friend has hidden their calendar from you.
  if (!isFriendVisible(level)) {
    return { state: 'unknown', label: 'Availability hidden', pillLabel: 'Hidden' };
  }
  if (isFriendInTown(level, status)) {
    return { state: 'in_town', label: 'In town today', pillLabel: 'In Town' };
  }
  // Limited friends don't share their away days, so we can't claim they're away.
  if (level === 'limited') {
    return { state: 'unknown', label: 'No status shared', pillLabel: 'Private' };
  }
  return { state: 'away', label: 'Away today', pillLabel: 'Away' };
};

export default function FriendsScreen() {
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [todayStatuses, setTodayStatuses] = useState<Record<string, CalendarStatus>>({});
  const [visibility, setVisibility] = useState<Map<string, VisibilityLevel>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    loadFriends();
  }, []);

  const loadFriends = async () => {
    try {
      const user = await authService.getCurrentUser();
      if (!user) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }
      const today = format(new Date(), 'yyyy-MM-dd');
      const [list, entries, visibilityMap] = await Promise.all([
        friendsService.getFriends(user.id),
        calendarService.getFriendsEntries(user.id, today, today),
        privacyService.getViewerVisibility(),
      ]);
      setFriends(list);
      setVisibility(visibilityMap);
      setTodayStatuses(
        entries.reduce<Record<string, CalendarStatus>>((statuses, entry) => {
          statuses[entry.user_id] = entry.status;
          return statuses;
        }, {})
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  };

  const friendsWithStatus = useMemo(
    () =>
      friends.map((friend) => ({
        friend,
        status: buildStatus(visibility.get(friend.id), todayStatuses[friend.id]),
      })),
    [friends, todayStatuses, visibility]
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

  const showEmptyState = friends.length === 0;

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
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search friends..."
              placeholderTextColor={colors.text.tertiary}
              autoCapitalize="none"
            />
          </View>
        )}

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
            <InviteFriends variant="compact" />
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
  messageButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  noMatchText: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
  },
});
