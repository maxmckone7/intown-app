import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Button from '../../components/Button';
import { authService } from '../../services/auth';

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [preparing, setPreparing] = useState(true);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const prepareResetSession = async () => {
      const resetError = getParam(params.error_description) || getParam(params.error);
      if (resetError) {
        showAlert('Reset Link Failed', resetError);
        router.replace('/(auth)/forgot-password');
        return;
      }

      try {
        const code = getParam(params.code);

        if (code) {
          await authService.exchangePasswordResetCode(code);
        } else {
          const session = await authService.getSession();
          if (!session) {
            showAlert(
              'Reset Link Required',
              'Use the password reset link from your email to choose a new password.'
            );
            router.replace('/(auth)/forgot-password');
            return;
          }
        }

        if (mounted) {
          setReady(true);
        }
      } catch (error: any) {
        showAlert('Reset Link Failed', error.message || 'Your reset link is invalid or expired.');
        router.replace('/(auth)/forgot-password');
      } finally {
        if (mounted) {
          setPreparing(false);
        }
      }
    };

    prepareResetSession();

    return () => {
      mounted = false;
    };
  }, [params.code, params.error, params.error_description, router]);

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      showAlert('Error', 'Please fill in all fields.');
      return;
    }

    if (password.length < 6) {
      showAlert('Error', 'Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      showAlert('Error', 'Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authService.updatePassword(password);
      try {
        await authService.signOut();
      } catch (signOutError) {
        console.warn('Unable to sign out after password reset:', signOutError);
      }
      showAlert('Password Updated', 'You can now sign in with your new password.');
      router.replace('/(auth)/login');
    } catch (error: any) {
      showAlert('Update Failed', error.message || 'Unable to update your password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>
          Create a fresh password for your InTown account.
        </Text>

        {preparing ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#7d22d8" />
            <Text style={styles.loadingText}>Checking your reset link...</Text>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor="#9278a8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              editable={ready && !submitting}
            />

            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor="#9278a8"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              editable={ready && !submitting}
            />

            <Button
              label="Update Password"
              variant="primary"
              onPress={handleUpdatePassword}
              loading={submitting}
              disabled={!ready || submitting}
              fullWidth
            />
          </>
        )}

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => router.replace('/(auth)/login')}
          disabled={submitting}
        >
          <Text style={styles.linkText}>
            Back to <Text style={styles.linkTextBold}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
    backgroundColor: '#fff4fb',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderRadius: 32,
    padding: 24,
    backgroundColor: '#ffffffee',
    borderWidth: 1,
    borderColor: '#fff',
    shadowColor: '#7a5cff',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
    color: '#2f1555',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 28,
    color: '#6e4c84',
  },
  loadingBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  loadingText: {
    color: '#6e4c84',
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    borderWidth: 2,
    borderColor: '#f3d8ff',
    borderRadius: 18,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    color: '#2f1555',
    backgroundColor: '#fff9ff',
  },
  linkButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: '#6e4c84',
    fontSize: 16,
  },
  linkTextBold: {
    color: '#ff2d55',
    fontWeight: '900',
  },
});
