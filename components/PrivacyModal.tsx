import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { friendsService } from '../services/friends';
import { friendGroupsService } from '../services/friendGroups';
import { privacyService } from '../services/privacy';
import {
  FriendGroup,
  FriendWithStatus,
  VisibilityLevel,
  VisibilityRule,
  VisibilityScope,
} from '../lib/types';
import { useToast } from './ToastProvider';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';

type Props = {
  visible: boolean;
  userId: string;
  onClose: () => void;
};

const LEVEL_OPTIONS: Array<{ value: VisibilityLevel; label: string }> = [
  { value: 'full', label: 'Full' },
  { value: 'limited', label: 'Limited' },
  { value: 'hidden', label: 'Hidden' },
];

const LEVEL_HELP: Record<VisibilityLevel, string> = {
  full: 'Sees all of your in-town and away days.',
  limited: 'Sees only the days you mark in town. Your away days stay private.',
  hidden: "Can't see any of your availability.",
};

const ruleKey = (scopeType: VisibilityScope, scopeId: string) =>
  `${scopeType}:${scopeId}`;

const showError = (message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message);
  } else {
    Alert.alert('Error', message);
  }
};

export default function PrivacyModal({ visible, userId, onClose }: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [appearAway, setAppearAway] = useState(false);
  const [defaultVisibility, setDefaultVisibility] = useState<VisibilityLevel>('full');
  const [levels, setLevels] = useState<Map<string, VisibilityLevel>>(new Map());
  const [friends, setFriends] = useState<FriendWithStatus[]>([]);
  const [groups, setGroups] = useState<FriendGroup[]>([]);

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const [settings, friendsList, groupsList] = await Promise.all([
          privacyService.getSettings(userId),
          friendsService.getFriends(userId),
          friendGroupsService.getGroups(userId),
        ]);
        if (!active) return;
        setAppearAway(settings.appearAway);
        setDefaultVisibility(settings.defaultVisibility);
        setLevels(buildLevelMap(settings.rules));
        setFriends(friendsList);
        setGroups(groupsList);
      } catch (error: any) {
        if (active) showError(error.message || 'Failed to load privacy settings');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [visible, userId]);

  const handleAppearAway = async (next: boolean) => {
    const previous = appearAway;
    setAppearAway(next);
    try {
      await privacyService.setAppearAway(userId, next);
      toast.info(next ? "You're now hidden from everyone" : 'Your calendar is visible again');
    } catch (error: any) {
      setAppearAway(previous);
      showError(error.message || 'Failed to update setting');
    }
  };

  const handleDefaultChange = async (level: VisibilityLevel) => {
    if (level === defaultVisibility) return;
    const previous = defaultVisibility;
    setDefaultVisibility(level);
    try {
      await privacyService.setDefaultVisibility(userId, level);
      toast.success('Default visibility updated');
    } catch (error: any) {
      setDefaultVisibility(previous);
      showError(error.message || 'Failed to update default visibility');
    }
  };

  const handleScopeChange = async (
    scopeType: VisibilityScope,
    scopeId: string,
    level: VisibilityLevel | null
  ) => {
    const key = ruleKey(scopeType, scopeId);
    const previous = levels;
    const next = new Map(previous);
    if (level === null) {
      next.delete(key);
    } else {
      next.set(key, level);
    }
    setLevels(next);

    try {
      if (level === null) {
        await privacyService.clearRule(userId, scopeType, scopeId);
      } else {
        await privacyService.setRule(userId, scopeType, scopeId, level);
      }
    } catch (error: any) {
      setLevels(previous);
      showError(error.message || 'Failed to update visibility');
    }
  };

  const sortedFriends = useMemo(
    () =>
      [...friends].sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email)
      ),
    [friends]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close privacy settings"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Privacy &amp; Visibility</Text>
              <Text style={styles.subtitle}>
                Choose who can see your in-town availability.
              </Text>
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

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.brand.primary} />
            </View>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Appear away / invisible */}
              <View style={styles.awayRow}>
                <View style={styles.awayCopy}>
                  <Text style={styles.awayTitle}>Appear away</Text>
                  <Text style={styles.awayHelp}>
                    Hide your calendar from everyone, no matter the settings below.
                  </Text>
                </View>
                <Switch
                  value={appearAway}
                  onValueChange={handleAppearAway}
                  trackColor={{ true: colors.brand.primary, false: colors.border.default }}
                  accessibilityLabel="Appear away"
                />
              </View>

              {appearAway && (
                <View style={styles.awayBanner}>
                  <Feather name="eye-off" size={15} color={colors.text.secondary} />
                  <Text style={styles.awayBannerText}>
                    You're invisible to all friends. The rules below resume when you turn this off.
                  </Text>
                </View>
              )}

              {/* Default visibility */}
              <Section
                title="Default for all friends"
                help={LEVEL_HELP[defaultVisibility]}
              >
                <LevelPills
                  value={defaultVisibility}
                  onChange={(level) => level && handleDefaultChange(level)}
                  dimmed={appearAway}
                />
              </Section>

              {/* Groups */}
              <Section
                title="Groups"
                help={
                  groups.length
                    ? 'Override visibility for a whole group. Group rules beat the default.'
                    : 'Create friend groups to set visibility for several friends at once.'
                }
              >
                {groups.length === 0 ? (
                  <Text style={styles.emptyText}>No groups yet.</Text>
                ) : (
                  groups.map((group) => (
                    <ScopeRow
                      key={group.id}
                      label={group.name}
                      caption={`${group.friend_ids.length} ${
                        group.friend_ids.length === 1 ? 'friend' : 'friends'
                      }`}
                      level={levels.get(ruleKey('group', group.id)) ?? null}
                      onChange={(level) => handleScopeChange('group', group.id, level)}
                      dimmed={appearAway}
                    />
                  ))
                )}
              </Section>

              {/* Friends */}
              <Section
                title="Individual friends"
                help="A friend's own rule always wins over their groups and the default."
              >
                {sortedFriends.length === 0 ? (
                  <Text style={styles.emptyText}>No friends yet.</Text>
                ) : (
                  sortedFriends.map((friend) => (
                    <ScopeRow
                      key={friend.id}
                      label={friend.name || friend.email}
                      caption={friend.name ? friend.email : undefined}
                      level={levels.get(ruleKey('friend', friend.id)) ?? null}
                      onChange={(level) => handleScopeChange('friend', friend.id, level)}
                      dimmed={appearAway}
                    />
                  ))
                )}
              </Section>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function buildLevelMap(rules: VisibilityRule[]): Map<string, VisibilityLevel> {
  const map = new Map<string, VisibilityLevel>();
  for (const rule of rules) {
    map.set(ruleKey(rule.scope_type, rule.scope_id), rule.level);
  }
  return map;
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHelp}>{help}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ScopeRow({
  label,
  caption,
  level,
  onChange,
  dimmed,
}: {
  label: string;
  caption?: string;
  level: VisibilityLevel | null;
  onChange: (level: VisibilityLevel | null) => void;
  dimmed?: boolean;
}) {
  return (
    <View style={styles.scopeRow}>
      <View style={styles.scopeLabelWrap}>
        <Text style={styles.scopeLabel} numberOfLines={1}>
          {label}
        </Text>
        {caption ? (
          <Text style={styles.scopeCaption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      <LevelPills value={level} onChange={onChange} includeDefault dimmed={dimmed} />
    </View>
  );
}

function LevelPills({
  value,
  onChange,
  includeDefault,
  dimmed,
}: {
  value: VisibilityLevel | null;
  onChange: (level: VisibilityLevel | null) => void;
  includeDefault?: boolean;
  dimmed?: boolean;
}) {
  const options: Array<{ value: VisibilityLevel | null; label: string }> = includeDefault
    ? [{ value: null, label: 'Default' }, ...LEVEL_OPTIONS]
    : LEVEL_OPTIONS;

  return (
    <View style={[styles.pills, dimmed && styles.pillsDimmed]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.label}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed, hovered }: any) => [
              styles.pill,
              active && styles.pillActive,
              !active && (pressed || hovered) && styles.pillHover,
            ]}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 27, 22, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '88%',
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    overflow: 'hidden',
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
    padding: spacing[5],
    paddingBottom: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.small.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  subtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
    marginTop: spacing[1],
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
  loadingBox: {
    padding: spacing[8],
    alignItems: 'center',
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: spacing[5],
    gap: spacing[5],
  },
  awayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[4],
  },
  awayCopy: {
    flex: 1,
  },
  awayTitle: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  awayHelp: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    marginTop: spacing[1],
    lineHeight: 18,
  },
  awayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: -spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.background.secondary,
  },
  awayBannerText: {
    flex: 1,
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  section: {
    gap: spacing[2],
  },
  sectionTitle: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '700',
    color: colors.text.primary,
  },
  sectionHelp: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  sectionBody: {
    gap: spacing[2],
    marginTop: spacing[1],
  },
  emptyText: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.tertiary,
    paddingVertical: spacing[2],
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    flexWrap: 'wrap',
  },
  scopeLabelWrap: {
    flexShrink: 1,
    minWidth: 120,
  },
  scopeLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  scopeCaption: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.caption.fontSize,
    color: colors.text.tertiary,
  },
  pills: {
    flexDirection: 'row',
    gap: spacing[1],
    backgroundColor: colors.background.secondary,
    borderRadius: radius.full,
    padding: 3,
  },
  pillsDimmed: {
    opacity: 0.5,
  },
  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
  },
  pillActive: {
    backgroundColor: colors.brand.primary,
  },
  pillHover: {
    backgroundColor: colors.background.card,
  },
  pillText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
});
