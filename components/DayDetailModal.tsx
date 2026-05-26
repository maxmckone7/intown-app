import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { format } from 'date-fns';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import { FriendWithStatus } from '../lib/types';
import { useReducedMotion } from '../lib/use-reduced-motion';

type Props = {
  visible: boolean;
  /** ISO date (YYYY-MM-DD) — undefined when modal is closed */
  date: string | null;
  /** Real friends list; mock statuses are layered on top per date */
  friends: FriendWithStatus[];
  onClose: () => void;
  onMessage?: (friendId: string) => void;
};

// Mock status pool — TODO: replace with real per-friend availability
// once the Supabase aggregation lands.
const STATUS_OPTIONS = [
  'Available all weekend',
  'Just visiting',
  'In town until Tuesday',
  'Free Friday night',
  'Around all week',
  'Quick trip — hit me up',
];

/**
 * Deterministic FNV-style hash → number in [0, 1). Same input always
 * yields the same output so the same date+friend reuses its slot/status.
 */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function inTownForDate(friendId: string, isoDate: string): boolean {
  // ~55% of friends are in town for any given day, deterministic per pair
  return hash(`${friendId}|${isoDate}`) > 0.45;
}

function statusForDate(friendId: string, isoDate: string): string {
  const idx = Math.floor(hash(`status|${friendId}|${isoDate}`) * STATUS_OPTIONS.length);
  return STATUS_OPTIONS[Math.min(idx, STATUS_OPTIONS.length - 1)];
}

function formatHeaderDate(isoDate: string): string {
  return format(new Date(`${isoDate}T00:00:00`), 'EEEE, MMM d');
}

export default function DayDetailModal({
  visible,
  date,
  friends,
  onClose,
  onMessage,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          damping: 18,
          stiffness: 220,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      opacity.setValue(0);
      translateY.setValue(30);
    }
  }, [visible, opacity, translateY, reducedMotion]);

  // ESC key support on web
  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const inTownFriends = useMemo(() => {
    if (!date) return [];
    return friends
      .filter((f) => inTownForDate(f.id, date))
      .map((f) => ({ friend: f, status: statusForDate(f.id, date) }));
  }, [date, friends]);

  if (!date) return null;

  const headerDate = formatHeaderDate(date);
  const totalFriends = friends.length;
  const inTownCount = inTownFriends.length;
  const subtitle =
    totalFriends === 0
      ? 'No friends yet'
      : `${inTownCount} of ${totalFriends} friend${totalFriends === 1 ? '' : 's'} in town`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Close day details"
      >
        <Animated.View style={[styles.backdropFade, { opacity }]} />
        <Animated.View
          style={[
            styles.card,
            { opacity, transform: [{ translateY }] },
          ]}
          // Stop the inner press from bubbling to the backdrop
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{headerDate}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed, hovered }: any) => [
                styles.closeButton,
                (pressed || hovered) && styles.closeButtonHover,
              ]}
            >
              <Text style={styles.closeGlyph}>×</Text>
            </Pressable>
          </View>

          {inTownFriends.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIllustration}>
                <Text style={styles.emptyIllustrationGlyph}>🏖️</Text>
              </View>
              <Text style={styles.emptyTitle}>
                Nobody's around on this day yet
              </Text>
              <Text style={styles.emptyBody}>Try checking nearby weekends.</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>In Town</Text>
                <View style={styles.sectionDivider} />
              </View>
              {inTownFriends.map(({ friend, status }) => {
                const initial =
                  friend.name?.charAt(0).toUpperCase() ||
                  friend.email.charAt(0).toUpperCase();
                return (
                  <Pressable
                    key={friend.id}
                    style={({ hovered }: any) => [
                      styles.friendRow,
                      hovered && styles.friendRowHover,
                    ]}
                  >
                    <View style={styles.avatar}>
                      {friend.avatar_url ? (
                        <Image
                          source={{ uri: friend.avatar_url }}
                          style={styles.avatarImage}
                        />
                      ) : (
                        <Text style={styles.avatarInitial}>{initial}</Text>
                      )}
                    </View>
                    <View style={styles.friendBody}>
                      <Text style={styles.friendName}>
                        {friend.name || friend.email}
                      </Text>
                      <Text style={styles.friendStatus}>{status}</Text>
                    </View>
                    <Pressable
                      onPress={() => onMessage?.(friend.id)}
                      accessibilityRole="button"
                      style={({ pressed, hovered }: any) => [
                        styles.messageButton,
                        (pressed || hovered) && styles.messageButtonHover,
                      ]}
                    >
                      <Text style={styles.messageButtonText}>Message</Text>
                    </Pressable>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  backdropFade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(31, 27, 22, 0.4)',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: 600,
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    padding: spacing[6],
    ...shadows.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonHover: {
    backgroundColor: colors.background.secondary,
  },
  closeGlyph: {
    fontSize: 24,
    lineHeight: 24,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    gap: 4,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  sectionLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
  },
  sectionDivider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    padding: spacing[3],
    borderRadius: radius.md,
    gap: spacing[3],
  },
  friendRowHover: {
    backgroundColor: colors.background.secondary,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    fontSize: typography.body.small.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  friendBody: {
    flex: 1,
  },
  friendName: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: 2,
  },
  friendStatus: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
  },
  messageButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.sm,
    backgroundColor: 'transparent',
  },
  messageButtonHover: {
    backgroundColor: '#FCE7EE',
  },
  messageButtonText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[4],
  },
  emptyIllustration: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  emptyIllustrationGlyph: {
    fontSize: 32,
    lineHeight: 36,
  },
  emptyTitle: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: 4,
  },
  emptyBody: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
