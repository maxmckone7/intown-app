import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '../theme';

export type FilterGroup = {
  id: string;
  label: string;
  friendIds?: string[];
};

/**
 * The "all" pseudo-group is always first and selected by default.
 * User-created groups are loaded from the friend_groups table.
 */
export const DEFAULT_GROUPS: FilterGroup[] = [
  { id: 'all', label: 'All friends' },
];

type Props = {
  groups?: FilterGroup[];
  selectedGroupId: string;
  onSelect: (groupId: string) => void;
  onManagePress?: () => void;
};

export default function GroupFilter({
  groups = DEFAULT_GROUPS,
  selectedGroupId,
  onSelect,
  onManagePress,
}: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {groups.map((group) => {
        const active = group.id === selectedGroupId;
        return (
          <Pressable
            key={group.id}
            onPress={() => onSelect(group.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed, hovered }: any) => [
              styles.pill,
              active && styles.pillActive,
              !active && (pressed || hovered) && styles.pillHover,
            ]}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>
              {group.label}
            </Text>
          </Pressable>
        );
      })}

      <View style={styles.manageSpacer} />

      <Pressable
        onPress={onManagePress}
        accessibilityRole="button"
        style={({ pressed, hovered }: any) => [
          styles.managePill,
          (pressed || hovered) && styles.managePillHover,
        ]}
      >
        <Text style={styles.manageText}>+ Manage groups</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[1],
    paddingHorizontal: 2,
  },
  pill: {
    minHeight: 44,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillHover: {
    backgroundColor: colors.background.secondary,
  },
  pillActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  pillText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.primary,
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  manageSpacer: {
    width: spacing[2],
  },
  managePill: {
    minHeight: 44,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  managePillHover: {
    backgroundColor: colors.background.secondary,
  },
  manageText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
  },
});
