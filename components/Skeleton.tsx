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
 * Profile skeleton — large round avatar + name + email lines.
 */
export function ProfileHeroSkeleton() {
  return (
    <View style={styles.profileHero}>
      <Skeleton width={120} height={120} radius={60} />
      <Skeleton width={200} height={28} radius={6} style={styles.profileName} />
      <Skeleton width={160} height={16} radius={4} style={styles.profileEmail} />
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

  profileHero: {
    alignItems: 'center',
    paddingTop: spacing[7],
    gap: spacing[3],
  },
  profileName: {
    marginTop: spacing[2],
  },
  profileEmail: {
    marginTop: 0,
  },
});
