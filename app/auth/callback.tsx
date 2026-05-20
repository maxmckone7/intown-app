import { useEffect } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';

const authSessionResult = WebBrowser.maybeCompleteAuthSession();

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();

  useEffect(() => {
    const completeSignIn = async () => {
      if (authSessionResult.type === 'success') {
        return;
      }

      const oauthError = getParam(params.error_description) || getParam(params.error);
      if (oauthError) {
        showAlert('Sign In Failed', oauthError);
        router.replace('/(auth)/login');
        return;
      }

      const code = getParam(params.code);
      if (!code) {
        router.replace('/(auth)/login');
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        showAlert('Sign In Failed', error.message);
        router.replace('/(auth)/login');
        return;
      }

      router.replace('/(tabs)');
    };

    completeSignIn();
  }, [params.code, params.error, params.error_description, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
