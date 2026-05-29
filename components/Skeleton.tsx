import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import {
  colors,
  radius,
  shadows,
  spacing,
} from '../theme';
import { useReducedMotion } from '../lib/use-reduced-motion';

type DimensionValue = number | `${number}%` | 'auto';

type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: ViewStyle;
};

/**
 * A single shimmer block. Animates opacity between 0.5 and 1 in a loop
 * so the placeholder feels alive without being distracting. Disables
 * the loop when the user prefers reduced motion.
 */
export default function Skeleton({
  width = '100%',
  height = 16,
  radius: r = 8,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.6)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);

  return (
    <Animated.View
      style={[
        styles.block,
        { width, height, borderRadius: r, opacity },
        style,
      ]}
    />
  );
}

/**
 * Friends Calendar skeleton — month header + weekday strip + 6-row grid
 * of 100px cells, all in the neutral secondary background. Used while
 * the homepage waits for the friends list to load.
 */
export function CalendarSkeleton() {
  return (
    <View style={styles.calendarWrap}>
      <View style={styles.calendarHeader}>
        <Skeleton width={64} height={28} radius={14} />
        <Skeleton width={240} height={40} radius={8} />
        <Skeleton width={64} height={28} radius={14} />
      </View>
      <View style={styles.calendarWeekRow}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} width={`${100 / 7}%`} height={14} radius={4} />
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {Array.from({ length: 42 }).map((_, i) => (
          <Skeleton
            key={i}
            width={`${(100 - 6) / 7}%`}
            height={100}
            radius={12}
            style={styles.calendarCell}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Friends list skeleton — 5 row placeholders for avatar + name + status.
 */
export function FriendsListSkeleton() {
  return (
    <View style={styles.listWrap}>
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <Skeleton width={48} height={48} radius={24} />
          <View style={styles.listText}>
            <Skeleton width="55%" height={16} radius={4} />
            <Skeleton width="35%" height={12} radius={4} style={styles.listSubText} />
          </View>
          <Skeleton width={84} height={28} radius={14} />
        </View>
      ))}
    </View>
  );
}

/**
 * My Calendar skeleton — mirrors the controls and personal calendar grid so
 * first load and retry states keep the page layout stable.
 */
export function MyCalendarSkeleton() {
  return (
    <View style={styles.personalCalendarWrap}>
      <Skeleton width={220} height={48} radius={8} />
      <Skeleton width={260} height={18} radius={4} style={styles.personalSubtitle} />
      <View style={styles.personalControls}>
        <Skeleton width={180} height={36} radius={18} />
        <Skeleton width={160} height={36} radius={18} />
        <Skeleton width={84} height={36} radius={18} style={styles.personalToday} />
      </View>
      <CalendarSkeleton />
    </View>
  );
}

/**
 * Invite card skeleton — used while the home screen is loading the prompt
 * and calendar prerequisites.
 */
export function InviteCardSkeleton() {
  return (
    <View style={styles.inviteCard}>
      <Skeleton width={180} height={28} radius={6} />
      <Skeleton width={260} height={16} radius={4} style={styles.inviteSubtitle} />
      <View style={styles.inviteInputRow}>
        <Skeleton width="68%" height={48} radius={12} />
        <Skeleton width={116} height={48} radius={12} />
      </View>
      <View style={styles.inviteActions}>
        <Skeleton width="100%" height={52} radius={12} />
        <Skeleton width="100%" height={52} radius={12} />
      </View>
    </View>
  );
}

/**
 * Profile skeleton — large round avatar + name + email lines.
 */
export function ProfileHeroSkeleton() {
  return (
    <View style={styles.profilePage}>
      <View style={styles.profileHero}>
        <Skeleton width={120} height={120} radius={60} />
        <Skeleton width={200} height={28} radius={6} style={styles.profileName} />
        <Skeleton width={160} height={16} radius={4} style={styles.profileEmail} />
      </View>
      <View style={styles.profileCard}>
        <Skeleton width={180} height={28} radius={6} />
        <Skeleton width="100%" height={72} radius={12} style={styles.profileField} />
        <Skeleton width="100%" height={72} radius={12} style={styles.profileField} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.background.secondary,
  },

  calendarWrap: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingTop: spacing[7],
    paddingHorizontal: spacing[4],
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[5],
  },
  calendarWeekRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  calendarCell: {
    ...shadows.sm,
  },

  personalCalendarWrap: {
    flex: 1,
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingTop: spacing[7],
    paddingHorizontal: spacing[4],
  },
  personalSubtitle: {
    marginTop: spacing[2],
  },
  personalControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[5],
  },
  personalToday: {
    marginLeft: 'auto',
  },

  inviteCard: {
    width: '100%',
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[5],
    ...shadows.sm,
  },
  inviteSubtitle: {
    marginTop: spacing[2],
  },
  inviteInputRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[5],
  },
  inviteActions: {
    gap: spacing[3],
    marginTop: spacing[4],
  },

  listWrap: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    gap: spacing[2],
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 80,
    gap: spacing[3],
    paddingHorizontal: spacing[4],
  },
  listText: {
    flex: 1,
    gap: 6,
  },
  listSubText: {
    marginTop: 2,
  },

  profilePage: {
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
    gap: spacing[5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[6],
  },
  profileHero: {
    alignItems: 'center',
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[6],
    gap: spacing[3],
    ...shadows.md,
  },
  profileName: {
    marginTop: spacing[2],
  },
  profileEmail: {
    marginTop: 0,
  },
  profileCard: {
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[5],
    ...shadows.sm,
  },
  profileField: {
    marginTop: spacing[4],
  },
});
