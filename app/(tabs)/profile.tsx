import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import { calendarService } from '../../services/calendar';
import { supabase } from '../../lib/supabase';
import { User, CalendarStatus } from '../../lib/types';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme';

type PresenceStatus = 'in_town' | 'away';

const getAvatarInitial = (profile: User) =>
  profile.name?.charAt(0).toUpperCase() || profile.email.charAt(0).toUpperCase();

const getImageExtension = (asset: ImagePicker.ImagePickerAsset) => {
  const source = asset.fileName || asset.uri;
  const extension = source.split('.').pop()?.split('?')[0]?.toLowerCase();
  return extension?.replace(/[^a-z0-9]/g, '') || 'jpg';
};

const uploadAvatar = async (
  asset: ImagePicker.ImagePickerAsset,
  userId: string
) => {
  if (!supabase.storage?.from) return asset.uri;
  const extension = getImageExtension(asset);
  const filePath = `${userId}/${Date.now()}.${extension}`;
  const contentType =
    asset.mimeType || `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  const { error } = await supabase.storage
    .from('avatars')
    .upload(filePath, blob, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
  if (!data?.publicUrl) {
    throw new Error('Failed to get uploaded profile picture URL');
  }
  return data.publicUrl;
};

const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const presenceFromCalendar = (status: CalendarStatus | undefined): PresenceStatus =>
  status === 'out_of_town' ? 'away' : 'in_town';

const calendarStatusFor = (presence: PresenceStatus): CalendarStatus =>
  presence === 'away' ? 'out_of_town' : 'in_town';

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [todayStatus, setTodayStatus] = useState<PresenceStatus>('in_town');

  useEffect(() => {
    loadUserAndToday();
  }, []);

  const navigateToLogin = () => {
    if (Platform.OS === 'web') {
      router.push('/(auth)/login');
    } else {
      router.replace('/(auth)/login');
    }
  };

  const loadUserAndToday = async () => {
    try {
      const authUser = await authService.getCurrentUser();
      if (!authUser) {
        navigateToLogin();
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      if (error) throw error;
      setUser(data);

      // Today's status is read from the calendar entry table. If My
      // Calendar (DES-16) is later wired up to read/write the same
      // table, the two screens will stay in sync automatically. For
      // now the toggle here is the canonical source.
      try {
        const entries = await calendarService.getEntries(authUser.id);
        const today = todayIso();
        const match = entries.find((e) => e.date === today);
        setTodayStatus(presenceFromCalendar(match?.status));
      } catch {
        // Non-fatal — leave the optimistic default of "in town"
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
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
      if (result.canceled || !result.assets[0]) return;

      setAvatarUploading(true);
      const avatarUrl = await uploadAvatar(result.assets[0], user.id);
      const { error } = await supabase
        .from('users')
        .update({ avatar_url: avatarUrl })
        .eq('id', user.id);
      if (error) throw error;
      setUser({ ...user, avatar_url: avatarUrl });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile picture');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleTogglePresence = async (next: PresenceStatus) => {
    if (!user || next === todayStatus) return;
    const prev = todayStatus;
    setTodayStatus(next); // optimistic
    try {
      await calendarService.setEntry(
        user.id,
        todayIso(),
        calendarStatusFor(next)
      );
    } catch (error: any) {
      setTodayStatus(prev);
      Alert.alert('Error', error.message || 'Failed to update status');
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

  const handleSettingsPress = () => {
    // Settings screen is intentionally out of scope for DES-18; this
    // link is a placeholder until that screen exists.
    if (typeof window !== 'undefined' && window.alert) {
      window.alert('Settings — coming soon.');
    }
  };

  // TODO: replace with real Supabase queries — friend count, days
  // in town for the current month, upcoming trips. Stats are hardcoded
  // here per the DES-18 mock data spec.
  const stats = useMemo(
    () => [
      { value: '12', label: 'Friends' },
      { value: '5', label: 'Days in town this month' },
      { value: '2', label: 'Trips coming up' },
    ],
    []
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand.primary} />
      </View>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <ScrollView
      style={styles.outer}
      contentContainerStyle={styles.outerContent}
    >
      <View style={styles.inner}>
        <View style={styles.hero}>
          <Pressable
            onPress={handlePickAvatar}
            disabled={avatarUploading}
            accessibilityLabel="Change profile picture"
            accessibilityRole="button"
            style={({ pressed, hovered }: any) => [
              styles.avatarWrap,
              (pressed || hovered) && !avatarUploading && styles.avatarHover,
            ]}
          >
            {user.avatar_url ? (
              <Image
                source={{ uri: user.avatar_url }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={styles.avatarInitial}>{getAvatarInitial(user)}</Text>
            )}
            {avatarUploading && (
              <View style={styles.avatarLoading}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            <View style={styles.cameraBadge} pointerEvents="none">
              <Feather name="camera" size={16} color="#FFFFFF" />
            </View>
          </Pressable>

          <Text style={styles.name}>{user.name || 'You'}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>TODAY'S STATUS</Text>
          <View style={styles.toggleRow}>
            <Pressable
              onPress={() => handleTogglePresence('in_town')}
              accessibilityRole="button"
              accessibilityState={{ selected: todayStatus === 'in_town' }}
              style={({ pressed, hovered }: any) => [
                styles.togglePill,
                todayStatus === 'in_town'
                  ? styles.togglePillInTownActive
                  : styles.togglePillInactive,
                todayStatus !== 'in_town' &&
                  (pressed || hovered) &&
                  styles.togglePillInactiveHover,
              ]}
            >
              <Text
                style={[
                  styles.toggleText,
                  todayStatus === 'in_town'
                    ? styles.toggleTextActive
                    : styles.toggleTextInactive,
                ]}
              >
                🏠 In town
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleTogglePresence('away')}
              accessibilityRole="button"
              accessibilityState={{ selected: todayStatus === 'away' }}
              style={({ pressed, hovered }: any) => [
                styles.togglePill,
                todayStatus === 'away'
                  ? styles.togglePillAwayActive
                  : styles.togglePillInactive,
                todayStatus !== 'away' &&
                  (pressed || hovered) &&
                  styles.togglePillInactiveHover,
              ]}
            >
              <Text
                style={[
                  styles.toggleText,
                  todayStatus === 'away'
                    ? styles.toggleTextActive
                    : styles.toggleTextInactive,
                ]}
              >
                ✈️ Away
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statsRow}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={handleSettingsPress}
            accessibilityRole="link"
            style={({ pressed, hovered }: any) => [
              styles.settingsRow,
              (pressed || hovered) && styles.settingsRowHover,
            ]}
          >
            <Text style={styles.settingsText}>Settings</Text>
            <Feather
              name="chevron-right"
              size={20}
              color={colors.text.tertiary}
            />
          </Pressable>

          <Pressable
            onPress={handleSignOut}
            disabled={signingOut}
            accessibilityRole="button"
            style={({ pressed, hovered }: any) => [
              styles.signOutRow,
              (pressed || hovered) && styles.signOutRowHover,
              signingOut && styles.signOutRowDisabled,
            ]}
          >
            {signingOut ? (
              <ActivityIndicator color={colors.heatmap.low} />
            ) : (
              <Text style={styles.signOutText}>Sign out</Text>
            )}
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  outerContent: {
    paddingTop: spacing[8],
    paddingBottom: spacing[8],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 600,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  hero: {
    alignItems: 'center',
  },
  avatarWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.secondary,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  avatarHover: {
    opacity: 0.92,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: 48,
    fontWeight: '600',
    color: colors.text.primary,
  },
  avatarLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(31, 27, 22, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background.primary,
  },
  name: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.medium.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    marginTop: spacing[5],
    textAlign: 'center',
  },
  email: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.secondary,
    marginTop: 4,
    textAlign: 'center',
  },

  statusCard: {
    marginTop: spacing[7],
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    padding: spacing[5],
    ...shadows.md,
  },
  statusLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    marginBottom: spacing[3],
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  togglePill: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  togglePillInactive: {
    backgroundColor: colors.background.secondary,
    borderColor: colors.border.subtle,
  },
  togglePillInactiveHover: {
    backgroundColor: '#EBE4D5',
  },
  togglePillInTownActive: {
    backgroundColor: colors.heatmap.high,
    borderColor: colors.heatmap.high,
  },
  togglePillAwayActive: {
    backgroundColor: colors.heatmap.low,
    borderColor: colors.heatmap.low,
  },
  toggleText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.large.fontSize,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },
  toggleTextInactive: {
    color: colors.text.secondary,
  },

  statsRow: {
    flexDirection: 'row',
    marginTop: spacing[5],
    gap: spacing[3],
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.background.card,
    borderRadius: radius.md,
    padding: spacing[4],
    alignItems: 'center',
    ...shadows.sm,
  },
  statValue: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: typography.display.small.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.caption.fontSize,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  actions: {
    marginTop: spacing[6],
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    paddingHorizontal: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  settingsRowHover: {
    backgroundColor: colors.background.secondary,
  },
  settingsText: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    color: colors.text.primary,
  },
  signOutRow: {
    height: 56,
    marginTop: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  signOutRowHover: {
    backgroundColor: 'rgba(196, 90, 77, 0.08)',
  },
  signOutRowDisabled: {
    opacity: 0.6,
  },
  signOutText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: '#A8483D',
  },
});
