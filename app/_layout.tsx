import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import {
  useFonts,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
} from '@expo-google-fonts/inter';
import { colors } from '../theme';
import { ToastProvider } from '../components/ToastProvider';

/**
 * Injects a global focus-visible outline ring + pointer cursor on
 * interactive elements when running on web. No-op on native, which
 * has its own focus handling.
 */
function useGlobalWebStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'intown-global-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      *:focus { outline: none; }
      *:focus-visible {
        outline: 2px solid ${colors.brand.primary};
        outline-offset: 2px;
        border-radius: 6px;
      }
      [role="button"], [role="link"] { cursor: pointer; }
      button, a, input, textarea { font-family: inherit; }
    `;
    document.head.appendChild(style);
    return () => {
      if (document.head.contains(style)) document.head.removeChild(style);
    };
  }, []);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
  });
  useGlobalWebStyles();

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ToastProvider>
      <View style={{ flex: 1, backgroundColor: colors.background.primary }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background.primary },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </View>
    </ToastProvider>
  );
}
