import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FriendWithStatus } from '../lib/types';
import {
  Group,
  GROUP_COLOR_SWATCHES,
  deleteGroup,
  generateGroupId,
  upsertGroup,
  useGroups,
} from '../lib/groups-store';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import Button from './Button';

type Props = {
  visible: boolean;
  friends: FriendWithStatus[];
  onClose: () => void;
};

type ModalView =
  | { kind: 'list' }
  | { kind: 'creating' }
  | { kind: 'editing'; groupId: string }
  | { kind: 'deleting'; groupId: string };

export default function ManageGroupsModal({ visible, friends, onClose }: Props) {
  const groups = useGroups();
  const [view, setView] = useState<ModalView>({ kind: 'list' });
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    if (visible) {
      setView({ kind: 'list' });
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
  }, [visible, opacity, translateY]);

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

  const editingGroup =
    view.kind === 'editing'
      ? groups.find((g) => g.id === view.groupId) ?? null
      : null;
  const deletingGroup =
    view.kind === 'deleting'
      ? groups.find((g) => g.id === view.groupId) ?? null
      : null;

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
        accessibilityLabel="Close manage groups"
      >
        <Animated.View style={[styles.backdropFade, { opacity }]} />
        <Animated.View
          style={[styles.card, { opacity, transform: [{ translateY }] }]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Your Groups</Text>
              <Text style={styles.subtitle}>
                Organize friends into groups to filter the heatmap
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

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {view.kind === 'list' && (
              <ListView
                groups={groups}
                onCreate={() => setView({ kind: 'creating' })}
                onEdit={(id) => setView({ kind: 'editing', groupId: id })}
                onDelete={(id) => setView({ kind: 'deleting', groupId: id })}
              />
            )}

            {view.kind === 'creating' && (
              <GroupForm
                mode="create"
                friends={friends}
                onCancel={() => setView({ kind: 'list' })}
                onSubmit={(draft) => {
                  upsertGroup({
                    id: generateGroupId(draft.name),
                    name: draft.name,
                    color: draft.color,
                    memberIds: draft.memberIds,
                  });
                  setView({ kind: 'list' });
                }}
              />
            )}

            {view.kind === 'editing' && editingGroup && (
              <GroupForm
                mode="edit"
                initial={editingGroup}
                friends={friends}
                onCancel={() => setView({ kind: 'list' })}
                onSubmit={(draft) => {
                  upsertGroup({
                    id: editingGroup.id,
                    name: draft.name,
                    color: draft.color,
                    memberIds: draft.memberIds,
                  });
                  setView({ kind: 'list' });
                }}
              />
            )}

            {view.kind === 'deleting' && deletingGroup && (
              <DeleteConfirm
                group={deletingGroup}
                onCancel={() => setView({ kind: 'list' })}
                onConfirm={() => {
                  deleteGroup(deletingGroup.id);
                  setView({ kind: 'list' });
                }}
              />
            )}
          </ScrollView>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/* -------------------------- list view ------------------------------ */

function ListView({
  groups,
  onCreate,
  onEdit,
  onDelete,
}: {
  groups: Group[];
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      {groups.length === 0 ? (
        <View style={styles.emptyList}>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptyBody}>
            Create your first group to start filtering the heatmap.
          </Text>
        </View>
      ) : (
        <View>
          {groups.map((group) => (
            <Pressable
              key={group.id}
              style={({ hovered }: any) => [
                styles.groupRow,
                hovered && styles.groupRowHover,
              ]}
            >
              <View style={[styles.colorDot, { backgroundColor: group.color }]} />
              <View style={styles.groupBody}>
                <Text style={styles.groupName}>{group.name}</Text>
                <Text style={styles.groupCount}>
                  {group.memberIds.length} member
                  {group.memberIds.length === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={styles.groupActions}>
                <IconButton
                  icon="edit-2"
                  label={`Edit ${group.name}`}
                  onPress={() => onEdit(group.id)}
                />
                <IconButton
                  icon="trash-2"
                  label={`Delete ${group.name}`}
                  onPress={() => onDelete(group.id)}
                />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.createSection}>
        <Pressable
          onPress={onCreate}
          accessibilityRole="button"
          style={({ pressed, hovered }: any) => [
            styles.createButton,
            (pressed || hovered) && styles.createButtonHover,
          ]}
        >
          <Text style={styles.createButtonText}>+ Create new group</Text>
        </Pressable>
      </View>
    </>
  );
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed, hovered }: any) => [
        styles.iconButton,
        (pressed || hovered) && styles.iconButtonHover,
      ]}
    >
      <Feather name={icon} size={18} color={colors.text.secondary} />
    </Pressable>
  );
}

/* -------------------------- group form ----------------------------- */

type FormDraft = {
  name: string;
  color: string;
  memberIds: string[];
};

function GroupForm({
  mode,
  initial,
  friends,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Group;
  friends: FriendWithStatus[];
  onCancel: () => void;
  onSubmit: (draft: FormDraft) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? GROUP_COLOR_SWATCHES[0]);
  const [memberIds, setMemberIds] = useState<Set<string>>(
    () => new Set(initial?.memberIds ?? [])
  );

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = name.trim().length > 0;

  return (
    <View style={styles.form}>
      <Pressable onPress={onCancel} style={styles.backLink} hitSlop={6}>
        <Feather name="chevron-left" size={18} color={colors.text.secondary} />
        <Text style={styles.backLinkText}>Back to groups</Text>
      </Pressable>

      <Text style={styles.formHeading}>
        {mode === 'create' ? 'Create a new group' : `Edit ${initial?.name}`}
      </Text>

      <Text style={styles.fieldLabel}>NAME</Text>
      <TextInput
        style={styles.textInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Hiking buddies"
        placeholderTextColor={colors.text.tertiary}
        autoCapitalize="words"
        autoFocus={mode === 'create'}
      />

      <Text style={styles.fieldLabel}>COLOR</Text>
      <View style={styles.swatchRow}>
        {GROUP_COLOR_SWATCHES.map((swatch) => {
          const selected = swatch === color;
          return (
            <Pressable
              key={swatch}
              onPress={() => setColor(swatch)}
              accessibilityLabel={`Use color ${swatch}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed, hovered }: any) => [
                styles.swatch,
                { backgroundColor: swatch },
                selected && styles.swatchSelected,
                (pressed || hovered) && styles.swatchHover,
              ]}
            />
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>MEMBERS</Text>
      {friends.length === 0 ? (
        <Text style={styles.helpText}>
          Add friends from the Friends page first. Once you have some, you can
          drop them into groups here.
        </Text>
      ) : (
        <View style={styles.chipRow}>
          {friends.map((friend) => {
            const selected = memberIds.has(friend.id);
            return (
              <Pressable
                key={friend.id}
                onPress={() => toggleMember(friend.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed, hovered }: any) => [
                  styles.chip,
                  selected ? styles.chipSelected : styles.chipUnselected,
                  !selected && (pressed || hovered) && styles.chipHover,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected ? styles.chipTextSelected : styles.chipTextUnselected,
                  ]}
                  numberOfLines={1}
                >
                  {friend.name || friend.email}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.formActions}>
        <Button
          label="Cancel"
          variant="secondary"
          onPress={onCancel}
          style={styles.actionFlex}
        />
        <Button
          label={mode === 'create' ? 'Create group' : 'Save changes'}
          variant="primary"
          onPress={() =>
            onSubmit({
              name: name.trim(),
              color,
              memberIds: Array.from(memberIds),
            })
          }
          disabled={!canSubmit}
          style={styles.actionFlex}
        />
      </View>
    </View>
  );
}

/* -------------------------- delete confirm ------------------------- */

function DeleteConfirm({
  group,
  onCancel,
  onConfirm,
}: {
  group: Group;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.deleteBlock}>
      <Text style={styles.deleteTitle}>Delete "{group.name}"?</Text>
      <Text style={styles.deleteBody}>
        This won't remove the friends from your list.
      </Text>
      <View style={styles.formActions}>
        <Button
          label="Cancel"
          variant="secondary"
          onPress={onCancel}
          style={styles.actionFlex}
        />
        <Button
          label="Delete"
          variant="destructive"
          onPress={onConfirm}
          style={styles.actionFlex}
        />
      </View>
    </View>
  );
}

/* -------------------------- styles --------------------------------- */

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
    maxWidth: 560,
    maxHeight: '80%',
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
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    gap: 4,
  },

  /* list */
  emptyList: {
    paddingVertical: spacing[5],
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: 4,
  },
  emptyBody: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    gap: spacing[3],
  },
  groupRowHover: {
    backgroundColor: colors.background.secondary,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  groupBody: {
    flex: 1,
  },
  groupName: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: 2,
  },
  groupCount: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.caption.fontSize,
    color: colors.text.secondary,
  },
  groupActions: {
    flexDirection: 'row',
    gap: spacing[1],
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHover: {
    backgroundColor: colors.background.secondary,
  },

  createSection: {
    marginTop: spacing[4],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  createButton: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  createButtonHover: {
    backgroundColor: 'rgba(233, 78, 119, 0.06)',
    borderColor: colors.brand.primary,
  },
  createButtonText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },

  /* form */
  form: {
    gap: spacing[3],
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: spacing[1],
  },
  backLinkText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  formHeading: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  fieldLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    marginTop: spacing[2],
  },
  textInput: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing[3],
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.primary,
    backgroundColor: colors.background.card,
  },
  helpText: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.text.primary,
  },
  swatchHover: {
    opacity: 0.85,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipUnselected: {
    borderColor: colors.border.default,
    backgroundColor: colors.background.card,
  },
  chipSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primary,
  },
  chipHover: {
    backgroundColor: colors.background.secondary,
  },
  chipText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
  },
  chipTextUnselected: {
    color: colors.text.primary,
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  actionFlex: {
    flex: 1,
  },

  /* delete */
  deleteBlock: {
    gap: spacing[2],
    paddingVertical: spacing[3],
  },
  deleteTitle: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
  },
  deleteBody: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
    lineHeight: 22,
  },
});
