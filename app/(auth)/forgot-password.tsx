import { useState } from 'react';
import {
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
import { colors } from '../../theme';

const getParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const [email, setEmail] = useState(getParam(params.email) || '');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();

  const handleResetRequest = async () => {
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      showAlert('Email Required', 'Enter the email address for your account.');
      return;
    }

    if (!normalizedEmail.includes('@')) {
      showAlert('Invalid Email', 'Enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await authService.requestPasswordReset(normalizedEmail);
      setSubmitted(true);
    } catch (error: any) {
      showAlert('Reset Failed', error.message || 'Unable to send a reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter your account email and we will send a secure link to create a new password.
        </Text>

        {submitted ? (
          <View style={styles.successBox}>
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successText}>
              If an InTown account exists for {email.trim()}, you will receive a password reset
              link shortly.
            </Text>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9278a8"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Button
              label="Send Reset Link"
              variant="primary"
              onPress={handleResetRequest}
              loading={loading}
              disabled={loading}
              fullWidth
            />
          </>
        )}

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => router.replace('/(auth)/login')}
          disabled={loading}
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
  successBox: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#f3fff6',
    borderWidth: 2,
    borderColor: '#b8f5c3',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#236d38',
    marginBottom: 6,
  },
  successText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.secondary,
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
