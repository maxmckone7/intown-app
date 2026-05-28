import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { authService } from '../services/auth';
import { supabase } from '../lib/supabase';
import { User } from '../lib/types';
import { colors, fontFamilies, spacing } from '../theme';
import BrandLogo from './BrandLogo';

const HEADER_HEIGHT = 72;

const NAV_ITEMS = [
  { label: "Who's InTown?", href: '/(tabs)' },
  { label: 'My Calendar', href: '/(tabs)/my-calendar' },
  { label: 'Friends', href: '/(tabs)/friends' },
] as const;

type NavHref = (typeof NAV_ITEMS)[number]['href'];

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authUser = await authService.getCurrentUser();
        if (!authUser) return;
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single();
        if (!cancelled && data) setUser(data);
      } catch {
        // header avatar is non-critical; ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goHome = () => router.push('/(tabs)');
  const goProfile = () => router.push('/(tabs)/profile');

  const isActive = (href: NavHref) => {
    if (href === '/(tabs)') {
      return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/';
    }
    const tail = href.replace('/(tabs)', '');
    return pathname === tail || pathname === href;
  };

  const initial =
    user?.name?.charAt(0).toUpperCase() ||
    user?.email?.charAt(0).toUpperCase() ||
    '?';

  return (
    <View style={[styles.outer, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={goHome}
          accessibilityRole="link"
          accessibilityLabel="InTown — go to Who's InTown?"
          hitSlop={8}
          style={({ pressed, hovered }: any) => [
            styles.logoPressable,
            (pressed || hovered) && styles.logoHover,
          ]}
        >
          <BrandLogo />
        </Pressable>

        <View style={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href)}
                accessibilityRole="link"
                accessibilityState={{ selected: active }}
                style={styles.navItem}
              >
                {({ hovered }: any) => (
                  <View>
                    <Text
                      style={[
                        styles.navLabel,
                        active && styles.navLabelActive,
                        hovered && !active && styles.navLabelHover,
                      ]}
                    >
                      {item.label}
                    </Text>
                    {active && <View style={styles.navUnderline} />}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={goProfile}
          accessibilityRole="link"
          accessibilityLabel="Open profile"
          hitSlop={8}
          style={({ pressed, hovered }: any) => [
            styles.avatar,
            (pressed || hovered) && styles.avatarHover,
          ]}
        >
          {user?.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    zIndex: 10,
  },
  bar: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    gap: spacing[5],
  },
  logoPressable: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  logoHover: {
    opacity: 0.8,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[6],
  },
  navItem: {
    paddingVertical: 8,
  },
  navLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: colors.text.secondary,
  },
  navLabelHover: {
    color: colors.text.primary,
  },
  navLabelActive: {
    color: colors.brand.primary,
    fontWeight: '600',
  },
  navUnderline: {
    height: 2,
    marginTop: 6,
    backgroundColor: colors.brand.primary,
    borderRadius: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.secondary,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHover: {
    opacity: 0.85,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
  },
});
