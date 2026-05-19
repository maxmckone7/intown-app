import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Image,
} from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import InviteFriends from '../../components/InviteFriends';

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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [interests, setInterests] = useState('');
  const [socialAccounts, setSocialAccounts] = useState<SocialAccounts>({});
  const router = useRouter();

  useEffect(() => {
    loadUser();
  }, []);

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
        router.replace('/(auth)/login');
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (error) throw error;

      setUser(data);
      populateProfileForm(data);
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

  const handlePickAvatar = async () => {
    if (!user) return;

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
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

      setUser({ ...user, avatar_url: avatarUrl });
      Alert.alert('Success', 'Profile picture updated');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile picture');
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

      setUser({ ...user, avatar_url: null });
      Alert.alert('Success', 'Profile picture removed');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to remove profile picture');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await authService.signOut();
              router.replace('/(auth)/login');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to sign out');
            }
          },
        },
      ]
    );
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.avatar}
          onPress={handlePickAvatar}
          disabled={avatarUploading}
        >
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{getAvatarInitial(user)}</Text>
          )}
          {avatarUploading && (
            <View style={styles.avatarLoadingOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.email}>{user.email}</Text>
        <View style={styles.photoActions}>
          <TouchableOpacity
            style={styles.photoButton}
            onPress={handlePickAvatar}
            disabled={avatarUploading}
          >
            <Text style={styles.photoButtonText}>
              {user.avatar_url ? 'Change Photo' : 'Add Photo'}
            </Text>
          </TouchableOpacity>
          {user.avatar_url && (
            <TouchableOpacity
              style={styles.removePhotoButton}
              onPress={handleRemoveAvatar}
              disabled={avatarUploading}
            >
              <Text style={styles.removePhotoButtonText}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Profile Details</Text>
            <Text style={styles.sectionSubtitle}>
              Add details friends can use to recognize and connect with you.
            </Text>
          </View>
          {!editing && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setEditing(true)}
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
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleCancelEdit}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.saveButton, saving && styles.disabledButton]}
                onPress={handleUpdateProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.profileSummary}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{user.name || 'Not set'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Location</Text>
              <Text style={styles.value}>{user.location || 'Not set'}</Text>
            </View>
            <View style={styles.detailRow}>
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
            <View style={styles.detailRow}>
              <Text style={styles.label}>Connected Social Media</Text>
              {getSocialAccountCount(user.social_accounts) > 0 ? (
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

      <View style={styles.section}>
        <Text style={styles.label}>Account Created</Text>
        <Text style={styles.value}>
          {new Date(user.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
      </View>

      <View style={styles.section}>
        <InviteFriends />
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutButtonText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    paddingBottom: 20,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    padding: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
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
    color: '#666',
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  photoButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  photoButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  removePhotoButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  removePhotoButtonText: {
    color: '#F44336',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    fontWeight: '600',
  },
  value: {
    fontSize: 16,
    color: '#333',
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  editContainer: {
    marginTop: 8,
  },
  fieldLabel: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
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
    color: '#777',
    fontSize: 13,
    marginTop: -4,
    marginBottom: 16,
  },
  socialHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
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
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
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
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
  socialValue: {
    color: '#333',
    flex: 1,
    fontSize: 15,
    textAlign: 'right',
  },
  editButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  disabledButton: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    margin: 20,
    padding: 16,
    backgroundColor: '#F44336',
    borderRadius: 8,
    alignItems: 'center',
  },
  signOutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

