import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Image,
  Platform,
  Switch,
} from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import {
  CoordinationNotificationPreferenceUpdate,
  coordinationNotificationsService,
  getDefaultCoordinationNotificationPreferences,
} from '../../services/coordinationNotifications';
import { friendGroupsService } from '../../services/friendGroups';
import { supabase } from '../../lib/supabase';
import {
  CoordinationNotificationPreferences,
  FriendGroup,
  NotificationChannel,
  User,
} from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';
import Button from '../../components/Button';
import PrivacyModal from '../../components/PrivacyModal';
import { useToast } from '../../components/ToastProvider';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme';

type SocialKey = 'instagram' | 'x' | 'linkedin' | 'website';
type SocialAccounts = Partial<Record<SocialKey, string>>;

const SOCIAL_FIELDS: Array<{
  key: SocialKey;
  label: string;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
}> = [
  { key: 'instagram', label: 'Instagram', placeholder: '@username or profile URL' },
  { key: 'x', label: 'X / Twitter', placeholder: '@username or profile URL' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'Profile URL', keyboardType: 'url' },
  { key: 'website', label: 'Website', placeholder: 'https://example.com', keyboardType: 'url' },
];

const NOTIFICATION_CHANNELS: Array<{
  key: NotificationChannel;
  label: string;
  description: string;
}> = [
  {
    key: 'push',
    label: 'Push',
    description: 'Get an app notification when a batch is ready.',
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Send the same coordination summary to your account email.',
  },
];

const formatInterests = (value?: string[] | null) => {
  if (!Array.isArray(value) || value.length === 0) {
    return '';
  }

  return value.join(', ');
};

const parseInterests = (value: string) =>
  value
    .split(',')
    .map((interest) => interest.trim())
    .filter(Boolean);

const normalizeSocialAccounts = (value?: Record<string, string> | null): SocialAccounts => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return SOCIAL_FIELDS.reduce<SocialAccounts>((accounts, field) => {
    const account = value[field.key];
    if (typeof account === 'string' && account.trim()) {
      accounts[field.key] = account;
    }

    return accounts;
  }, {});
};

const getSocialAccountCount = (value?: Record<string, string> | null) =>
  Object.values(normalizeSocialAccounts(value)).filter(Boolean).length;

const getAvatarInitial = (profile: User) =>
  profile.name?.charAt(0).toUpperCase() || profile.email.charAt(0).toUpperCase();

const getDisplayName = (profile: User) => profile.name?.trim() || 'Add your name';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

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

const getImageExtension = (asset: ImagePicker.ImagePickerAsset) => {
  const source = asset.fileName || asset.uri;
  const extension = source.split('.').pop()?.split('?')[0]?.toLowerCase();

  return extension?.replace(/[^a-z0-9]/g, '') || 'jpg';
};

const uploadAvatar = async (asset: ImagePicker.ImagePickerAsset, userId: string) => {
  if (!supabase.storage?.from) {
    return asset.uri;
  }

  const extension = getImageExtension(asset);
  const filePath = `${userId}/${Date.now()}.${extension}`;
  const contentType =
    asset.mimeType || `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  const response = await fetch(asset.uri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from('avatars')
    .upload(filePath, blob, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
  if (!data?.publicUrl) {
    throw new Error('Failed to get uploaded profile picture URL');
  }

  return data.publicUrl;
};

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [interests, setInterests] = useState('');
  const [socialAccounts, setSocialAccounts] = useState<SocialAccounts>({});
  const [notificationPreferences, setNotificationPreferences] =
    useState<CoordinationNotificationPreferences | null>(null);
  const [notificationGroups, setNotificationGroups] = useState<FriendGroup[]>([]);
  const [savingNotificationPreferences, setSavingNotificationPreferences] =
    useState(false);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    loadUser();
  }, []);

  const navigateToLogin = () => {
    if (Platform.OS === 'web') {
      router.push('/(auth)/login');
    } else {
      router.replace('/(auth)/login');
    }
  };

  const populateProfileForm = (profile: User) => {
    setName(profile.name || '');
    setLocation(profile.location || '');
    setInterests(formatInterests(profile.interests));
    setSocialAccounts(normalizeSocialAccounts(profile.social_accounts));
  };

  const loadUser = async () => {
    try {
      const authUser = await authService.getCurrentUser();
      if (!authUser) {
        navigateToLogin();
        return;
      }

      const [
        { data, error },
        coordinationPreferences,
        groups,
      ] = await Promise.all([
        supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single(),
        coordinationNotificationsService.getPreferences(authUser.id),
        friendGroupsService.getGroups(authUser.id),
      ]);

      if (error) throw error;

      setUser(data);
      populateProfileForm(data);
      setNotificationPreferences(coordinationPreferences);
      setNotificationGroups(groups);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user) return;

    const nextInterests = parseInterests(interests);
    const nextSocialAccounts = SOCIAL_FIELDS.reduce<Record<string, string>>(
      (accounts, field) => {
        const value = socialAccounts[field.key]?.trim();
        if (value) {
          accounts[field.key] = value;
        }

        return accounts;
      },
      {}
    );
    const updates = {
      name: name.trim() || null,
      location: location.trim() || null,
      interests: nextInterests,
      social_accounts: nextSocialAccounts,
    };

    try {
      setSaving(true);
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;

      setUser({ ...user, ...updates });
      setEditing(false);
      Alert.alert('Success', 'Profile updated');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (user) {
      populateProfileForm(user);
    }
    setEditing(false);
  };

  const handleSocialAccountChange = (key: SocialKey, value: string) => {
    setSocialAccounts((current) => ({ ...current, [key]: value }));
  };

  const getNotificationPreferences = () => {
    if (!user) return null;
    return (
      notificationPreferences ||
      getDefaultCoordinationNotificationPreferences(user.id)
    );
  };

  const handleNotificationPreferenceChange = async (
    updates: CoordinationNotificationPreferenceUpdate
  ) => {
    if (!user || savingNotificationPreferences) return;

    const current =
      notificationPreferences ||
      getDefaultCoordinationNotificationPreferences(user.id);
    const next = {
      ...current,
      ...updates,
      delivery_channels: updates.delivery_channels || current.delivery_channels,
      group_id: 'group_id' in updates ? updates.group_id ?? null : current.group_id,
      updated_at: new Date().toISOString(),
    };

    setNotificationPreferences(next);
    setSavingNotificationPreferences(true);

    try {
      const saved = await coordinationNotificationsService.updatePreferences(
        user.id,
        updates
      );
      setNotificationPreferences(saved);
    } catch (error: any) {
      setNotificationPreferences(current);
      showAlert(
        'Error',
        error.message || 'Failed to update notification preferences'
      );
    } finally {
      setSavingNotificationPreferences(false);
    }
  };

  const handleNotificationChannelToggle = (channel: NotificationChannel) => {
    const preferences = getNotificationPreferences();
    if (!preferences) return;

    const currentChannels = preferences.delivery_channels;
    const nextChannels = currentChannels.includes(channel)
      ? currentChannels.filter((current) => current !== channel)
      : [...currentChannels, channel];

    void handleNotificationPreferenceChange({
      delivery_channels: nextChannels.length > 0 ? nextChannels : ['push'],
    });
  };

  const handlePickAvatar = async () => {
    if (!user) return;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert(
          'Permission Required',
          'Allow photo library access to add a profile picture.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      setAvatarUploading(true);
      const avatarUrl = await uploadAvatar(result.assets[0], user.id);
      const { error } = await supabase
        .from('users')
        .update({ avatar_url: avatarUrl })
        .eq('id', user.id);

      if (error) throw error;

      setUser((current) => (current ? { ...current, avatar_url: avatarUrl } : current));
      toast.success('Profile photo saved');
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to update profile picture');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;

    try {
      setAvatarUploading(true);
      const { error } = await supabase
        .from('users')
        .update({ avatar_url: null })
        .eq('id', user.id);

      if (error) throw error;

      setUser((current) => (current ? { ...current, avatar_url: null } : current));
      toast.info('Profile photo removed');
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to remove profile picture');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user || resettingPassword) return;

    setResettingPassword(true);
    try {
      await authService.requestPasswordReset(user.email);
      toast.info(`Password reset email sent to ${user.email}`);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to send password reset email');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    try {
      await authService.signOut();
      setUser(null);
      navigateToLogin();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to sign out');
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!user) {
    return null;
  }

  const displayName = getDisplayName(user);
  const hasName = Boolean(user.name?.trim());
  const socialAccountCount = getSocialAccountCount(user.social_accounts);
  const preferences = getNotificationPreferences();
  const coordinationNotificationsEnabled =
    preferences?.coordination_enabled ?? false;

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.page}>
        <View style={styles.heroCard}>
          <View style={styles.avatarCluster}>
            <TouchableOpacity
              style={styles.avatarButton}
              onPress={handlePickAvatar}
              disabled={avatarUploading}
              accessibilityRole="button"
              accessibilityLabel={user.avatar_url ? 'Change profile photo' : 'Add profile photo'}
              activeOpacity={0.82}
            >
              {user.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{getAvatarInitial(user)}</Text>
              )}
              <View style={styles.avatarEditOverlay} pointerEvents="none">
                <Feather name="camera" size={15} color="#FFFFFF" />
                <Text style={styles.avatarEditText}>
                  {user.avatar_url ? 'Change' : 'Add photo'}
                </Text>
              </View>
              {avatarUploading && (
                <View style={styles.avatarLoadingOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
            </TouchableOpacity>
            {user.avatar_url && (
              <TouchableOpacity
                style={styles.avatarRemoveButton}
                onPress={handleRemoveAvatar}
                disabled={avatarUploading}
                accessibilityRole="button"
                accessibilityLabel="Remove profile photo"
              >
                <Feather name="x" size={18} color={colors.text.primary} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.profileName, !hasName && styles.profileNamePlaceholder]}>
            {displayName}
          </Text>
          <Text style={styles.profileEmail}>{user.email}</Text>
          <Text style={styles.autosaveHint}>Photo updates save automatically.</Text>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Profile Details</Text>
              <Text style={styles.sectionSubtitle}>
                Add details friends can use to recognize and connect with you.
              </Text>
            </View>
            {!editing && (
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit profile details"
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {editing ? (
            <View style={styles.editContainer}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Enter your name"
                editable={!saving}
              />

              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="City, State"
                editable={!saving}
              />

              <Text style={styles.fieldLabel}>Interests</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={interests}
                onChangeText={setInterests}
                placeholder="Hiking, concerts, coffee"
                editable={!saving}
                multiline
              />
              <Text style={styles.helperText}>Separate interests with commas.</Text>

              <Text style={styles.socialHeading}>Connected Social Media</Text>
              {SOCIAL_FIELDS.map((field) => (
                <View key={field.key}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <TextInput
                    style={styles.input}
                    value={socialAccounts[field.key] || ''}
                    onChangeText={(value) => handleSocialAccountChange(field.key, value)}
                    placeholder={field.placeholder}
                    keyboardType={field.keyboardType || 'default'}
                    autoCapitalize="none"
                    editable={!saving}
                  />
                </View>
              ))}

              <View style={styles.editButtons}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={handleCancelEdit}
                  disabled={saving}
                  style={styles.editButtonFlex}
                />
                <Button
                  label="Save Profile"
                  variant="primary"
                  onPress={handleUpdateProfile}
                  loading={saving}
                  disabled={saving}
                  style={styles.editButtonFlex}
                />
              </View>
            </View>
          ) : (
            <View style={styles.profileSummary}>
              <View style={styles.detailCard}>
                <Text style={styles.label}>Name</Text>
                <Text style={styles.value}>{user.name || 'Not set'}</Text>
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.label}>Location</Text>
                <Text style={styles.value}>{user.location || 'Not set'}</Text>
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.label}>Interests</Text>
                {user.interests && user.interests.length > 0 ? (
                  <View style={styles.chipContainer}>
                    {user.interests.map((interest) => (
                      <View key={interest} style={styles.chip}>
                        <Text style={styles.chipText}>{interest}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.value}>Not set</Text>
                )}
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.label}>
                  Connected Social Media{socialAccountCount > 0 ? ` (${socialAccountCount})` : ''}
                </Text>
                {socialAccountCount > 0 ? (
                  <View style={styles.socialList}>
                    {SOCIAL_FIELDS.map((field) => {
                      const value = normalizeSocialAccounts(user.social_accounts)[field.key];
                      if (!value) return null;

                      return (
                        <View key={field.key} style={styles.socialRow}>
                          <Text style={styles.socialLabel}>{field.label}</Text>
                          <Text style={styles.socialValue}>{value}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.value}>Not set</Text>
                )}
              </View>
            </View>
          )}
        </View>

        {preferences && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderCopy}>
                <Text style={styles.sectionTitle}>Coordination Notifications</Text>
                <Text style={styles.sectionSubtitle}>
                  Opt in to batched alerts when friends are around and jump
                  straight to the relevant day.
                </Text>
              </View>
              {savingNotificationPreferences && (
                <ActivityIndicator color={colors.brand.primary} />
              )}
            </View>

            <View style={styles.notificationList}>
              <View style={styles.notificationRow}>
                <View style={styles.notificationCopy}>
                  <Text style={styles.notificationTitle}>Enable notifications</Text>
                  <Text style={styles.notificationDescription}>
                    Batch coordination updates before sending push or email alerts.
                  </Text>
                </View>
                <Switch
                  value={coordinationNotificationsEnabled}
                  onValueChange={(value) =>
                    void handleNotificationPreferenceChange({
                      coordination_enabled: value,
                    })
                  }
                  disabled={savingNotificationPreferences}
                />
              </View>

              <View style={styles.notificationDivider} />

              <Text style={styles.notificationGroupLabel}>Notify me when</Text>
              <View style={styles.notificationRow}>
                <View style={styles.notificationCopy}>
                  <Text style={styles.notificationTitle}>
                    Friends are in town this weekend
                  </Text>
                  <Text style={styles.notificationDescription}>
                    Bundle Friday through Sunday availability into one summary.
                  </Text>
                </View>
                <Switch
                  value={preferences.weekend_in_town_enabled}
                  onValueChange={(value) =>
                    void handleNotificationPreferenceChange({
                      weekend_in_town_enabled: value,
                    })
                  }
                  disabled={
                    !coordinationNotificationsEnabled ||
                    savingNotificationPreferences
                  }
                />
              </View>

              <View style={styles.notificationRow}>
                <View style={styles.notificationCopy}>
                  <Text style={styles.notificationTitle}>
                    A friend is back in town
                  </Text>
                  <Text style={styles.notificationDescription}>
                    Queue a batched alert when a friend changes from away to in town.
                  </Text>
                </View>
                <Switch
                  value={preferences.back_in_town_enabled}
                  onValueChange={(value) =>
                    void handleNotificationPreferenceChange({
                      back_in_town_enabled: value,
                    })
                  }
                  disabled={
                    !coordinationNotificationsEnabled ||
                    savingNotificationPreferences
                  }
                />
              </View>

              <Text style={styles.notificationGroupLabel}>Send via</Text>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <Pressable
                  key={channel.key}
                  onPress={() => handleNotificationChannelToggle(channel.key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: preferences.delivery_channels.includes(channel.key),
                    disabled:
                      !coordinationNotificationsEnabled ||
                      savingNotificationPreferences,
                  }}
                  disabled={
                    !coordinationNotificationsEnabled ||
                    savingNotificationPreferences
                  }
                  style={({ pressed, hovered }: any) => [
                    styles.notificationOption,
                    preferences.delivery_channels.includes(channel.key) &&
                      styles.notificationOptionSelected,
                    (pressed || hovered) &&
                      coordinationNotificationsEnabled &&
                      styles.notificationOptionActive,
                  ]}
                >
                  <View style={styles.notificationCopy}>
                    <Text style={styles.notificationTitle}>{channel.label}</Text>
                    <Text style={styles.notificationDescription}>
                      {channel.description}
                    </Text>
                  </View>
                  {preferences.delivery_channels.includes(channel.key) && (
                    <Feather
                      name="check-circle"
                      size={20}
                      color={colors.brand.primary}
                    />
                  )}
                </Pressable>
              ))}

              <Text style={styles.notificationGroupLabel}>Friend scope</Text>
              <View style={styles.notificationScopeList}>
                <Pressable
                  onPress={() =>
                    void handleNotificationPreferenceChange({ group_id: null })
                  }
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: preferences.group_id === null,
                    disabled:
                      !coordinationNotificationsEnabled ||
                      savingNotificationPreferences,
                  }}
                  disabled={
                    !coordinationNotificationsEnabled ||
                    savingNotificationPreferences
                  }
                  style={({ pressed, hovered }: any) => [
                    styles.scopePill,
                    preferences.group_id === null && styles.scopePillSelected,
                    (pressed || hovered) &&
                      coordinationNotificationsEnabled &&
                      styles.scopePillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.scopePillText,
                      preferences.group_id === null &&
                        styles.scopePillTextSelected,
                    ]}
                  >
                    All friends
                  </Text>
                </Pressable>

                {notificationGroups.map((group) => {
                  const selected = preferences.group_id === group.id;
                  return (
                    <Pressable
                      key={group.id}
                      onPress={() =>
                        void handleNotificationPreferenceChange({
                          group_id: group.id,
                        })
                      }
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected,
                        disabled:
                          !coordinationNotificationsEnabled ||
                          savingNotificationPreferences,
                      }}
                      disabled={
                        !coordinationNotificationsEnabled ||
                        savingNotificationPreferences
                      }
                      style={({ pressed, hovered }: any) => [
                        styles.scopePill,
                        selected && styles.scopePillSelected,
                        (pressed || hovered) &&
                          coordinationNotificationsEnabled &&
                          styles.scopePillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.scopePillText,
                          selected && styles.scopePillTextSelected,
                        ]}
                      >
                        {group.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Account</Text>
              <Text style={styles.sectionSubtitle}>
                Manage sign-in details and security actions.
              </Text>
            </View>
          </View>

          <View style={styles.accountList}>
            <View style={styles.accountRow}>
              <View style={styles.accountIcon}>
                <Feather name="calendar" size={18} color={colors.brand.primary} />
              </View>
              <View style={styles.accountCopy}>
                <Text style={styles.label}>Account Created</Text>
                <Text style={styles.value}>
                  {new Date(user.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </View>

            <View style={styles.accountRow}>
              <View style={styles.accountIcon}>
                <Feather name="lock" size={18} color={colors.brand.primary} />
              </View>
              <View style={styles.accountCopy}>
                <Text style={styles.label}>Password</Text>
                <Text style={styles.accountDescription}>
                  Send a reset link to your account email.
                </Text>
              </View>
              <Button
                label="Reset Password"
                variant="secondary"
                size="sm"
                onPress={handlePasswordReset}
                loading={resettingPassword}
                disabled={resettingPassword}
                style={styles.accountAction}
              />
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Privacy &amp; Visibility</Text>
              <Text style={styles.sectionSubtitle}>
                Control who can see your availability, by friend or group.
              </Text>
            </View>
          </View>

          <View style={styles.accountRow}>
            <View style={styles.accountIcon}>
              <Feather name="eye" size={18} color={colors.brand.primary} />
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.label}>Calendar visibility</Text>
              <Text style={styles.accountDescription}>
                Share full availability with some, less with others, or appear away.
              </Text>
            </View>
            <Button
              label="Manage"
              variant="secondary"
              size="sm"
              onPress={() => setPrivacyOpen(true)}
              style={styles.accountAction}
            />
          </View>
        </View>

        <View style={styles.inviteCard}>
          <InviteFriends />
        </View>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          accessibilityRole="button"
          accessibilityState={{ disabled: signingOut, busy: signingOut }}
          style={({ pressed, hovered }: any) => [
            styles.signOutPressable,
            (pressed || hovered) && !signingOut && styles.signOutPressableActive,
            signingOut && styles.disabledAction,
          ]}
        >
          {signingOut ? (
            <ActivityIndicator color="#C62828" />
          ) : (
            <Text style={styles.signOutText}>Sign Out</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
    <PrivacyModal
      visible={privacyOpen}
      userId={user.id}
      onClose={() => setPrivacyOpen(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  contentContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[6],
  },
  page: {
    width: '100%',
    maxWidth: 960,
    gap: spacing[5],
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[6],
    ...shadows.md,
  },
  avatarCluster: {
    position: 'relative',
    marginBottom: spacing[4],
  },
  avatarButton: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.background.card,
    ...shadows.lg,
  },
  avatarEditOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
    backgroundColor: 'rgba(31, 27, 22, 0.72)',
  },
  avatarEditText: {
    color: '#FFFFFF',
    fontFamily: fontFamilies.inter.medium,
    fontSize: 12,
    fontWeight: '600',
  },
  avatarRemoveButton: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  profileName: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.medium.fontSize,
    fontWeight: '600',
    lineHeight: typography.display.medium.lineHeight,
    color: colors.text.primary,
    textAlign: 'center',
  },
  profileNamePlaceholder: {
    color: colors.text.tertiary,
  },
  profileEmail: {
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
    marginTop: spacing[1],
  },
  autosaveHint: {
    fontSize: typography.caption.fontSize,
    color: colors.text.tertiary,
    marginTop: spacing[3],
  },
  sectionCard: {
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[5],
    ...shadows.sm,
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  detailCard: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[4],
    gap: spacing[1],
  },
  accountList: {
    gap: spacing[3],
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[4],
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FCE8EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountCopy: {
    flex: 1,
  },
  accountDescription: {
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: typography.body.small.lineHeight,
  },
  accountAction: {
    minWidth: 150,
  },
  notificationList: {
    gap: spacing[3],
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[4],
  },
  notificationCopy: {
    flex: 1,
    gap: 3,
  },
  notificationTitle: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  notificationDescription: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    lineHeight: typography.body.small.lineHeight,
    color: colors.text.secondary,
  },
  notificationDivider: {
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  notificationGroupLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    marginTop: spacing[2],
  },
  notificationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.primary,
    padding: spacing[4],
  },
  notificationOptionSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: '#FFF6FA',
  },
  notificationOptionActive: {
    backgroundColor: colors.background.secondary,
  },
  notificationScopeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  scopePill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  scopePillSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primary,
  },
  scopePillActive: {
    backgroundColor: colors.background.secondary,
  },
  scopePillText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.primary,
  },
  scopePillTextSelected: {
    color: '#FFFFFF',
  },
  inviteCard: {
    marginHorizontal: -spacing[4],
  },
  signOutPressable: {
    alignSelf: 'center',
    minWidth: 160,
    minHeight: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#F4C7C3',
    backgroundColor: '#FFF6F5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
  },
  signOutPressableActive: {
    backgroundColor: '#FFE9E7',
  },
  disabledAction: {
    opacity: 0.6,
  },
  signOutText: {
    color: '#C62828',
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 32,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '600',
  },
  email: {
    fontSize: 16,
    color: colors.text.secondary,
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  removePhotoButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  removePhotoButtonText: {
    color: '#C62828',
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 16,
    color: colors.text.secondary,
    lineHeight: 22,
  },
  label: {
    fontSize: 16,
    color: colors.text.tertiary,
    marginBottom: 8,
    fontWeight: '500',
  },
  value: {
    fontSize: 16,
    color: colors.text.primary,
    fontWeight: '700',
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '700',
  },
  editContainer: {
    marginTop: 8,
  },
  fieldLabel: {
    fontSize: 16,
    color: colors.text.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    marginBottom: 12,
  },
  multilineInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  helperText: {
    color: colors.text.secondary,
    fontSize: 14,
    marginTop: -4,
    marginBottom: 16,
  },
  socialHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginTop: 4,
    marginBottom: 12,
  },
  profileSummary: {
    gap: 18,
  },
  detailRow: {
    gap: 4,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#EAF3FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    color: '#0062CC',
    fontSize: 14,
    fontWeight: '700',
  },
  socialList: {
    gap: 10,
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  socialLabel: {
    color: colors.text.tertiary,
    fontSize: 16,
    fontWeight: '500',
  },
  socialValue: {
    color: colors.text.primary,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
  },
  editButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  editButtonFlex: {
    flex: 1,
  },
  signOutButton: {
    marginHorizontal: 16,
    marginVertical: 24,
    padding: 16,
    backgroundColor: '#F44336',
    borderRadius: 8,
    alignItems: 'center',
  },
  signOutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    margin: 20,
  },
});

