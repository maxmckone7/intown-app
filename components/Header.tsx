import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';

const HEADER_HEIGHT = 56;

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const isHome = pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/';

  const handleHomePress = () => {
    if (!isHome) {
      router.push('/(tabs)');
    }
  };

  return (
    <View style={[styles.outer, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={handleHomePress}
          disabled={isHome}
          accessibilityRole="link"
          accessibilityLabel="InTown — go to Calendar"
          hitSlop={8}
          style={({ pressed }) => [
            styles.logoPressable,
            pressed && !isHome && styles.logoPressed,
          ]}
        >
          <Text style={styles.logoText}>InTown</Text>
          <View style={styles.logoUnderline} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 10,
  },
  bar: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  logoPressable: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  logoPressed: {
    opacity: 0.6,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ff2d55',
    letterSpacing: 0.5,
  },
  logoUnderline: {
    height: 3,
    borderRadius: 2,
    marginTop: 2,
    backgroundColor: '#ffd60a',
  },
});
