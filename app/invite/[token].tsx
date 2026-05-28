import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Button from '../../components/Button';
import { authService } from '../../services/auth';
import { invitesService } from '../../services/invites';
import { colors, spacing, typography } from '../../theme';

type InviteState = 'loading' | 'signed_out' | 'accepted' | 'error';

export default function InviteScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [state, setState] = useState<InviteState>('loading');
  const [message, setMessage] = useState('Accepting invite...');

  useEffect(() => {
    let mounted = true;

    const acceptInvite = async () => {
      if (!token) {
        setState('error');
        setMessage('This invite link is missing a token.');
        return;
      }

      try {
        const user = await authService.getCurrentUser();
        if (!user) {
          if (!mounted) return;
          setState('signed_out');
          setMessage('Sign in or create an account, then reopen this link to accept the invite.');
          return;
        }

        await invitesService.acceptInvite(token);
        if (!mounted) return;
        setState('accepted');
        setMessage('Invite accepted. You are now connected as friends.');
      } catch (error: any) {
        if (!mounted) return;
        setState('error');
        setMessage(error?.message || 'We could not accept this invite.');
      }
    };

    void acceptInvite();

    return () => {
      mounted = false;
    };
  }, [token]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {state === 'loading' ? (
          <ActivityIndicator color={colors.brand.primary} />
        ) : null}
        <Text style={styles.title}>InTown invite</Text>
        <Text style={styles.message}>{message}</Text>

        {state === 'signed_out' ? (
          <Button
            label="Sign in"
            variant="primary"
            onPress={() => router.push('/(auth)/login')}
            style={styles.button}
          />
        ) : null}

        {state === 'accepted' ? (
          <Button
            label="Go to friends"
            variant="primary"
            onPress={() => router.replace('/(tabs)/friends')}
            style={styles.button}
          />
        ) : null}

        {state === 'error' ? (
          <Button
            label="Back to app"
            variant="secondary"
            onPress={() => router.replace('/(tabs)')}
            style={styles.button}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[5],
    backgroundColor: colors.background.primary,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    padding: spacing[6],
    borderRadius: 20,
    backgroundColor: colors.background.card,
  },
  title: {
    marginTop: spacing[4],
    fontSize: typography.display.small.fontSize,
    fontWeight: typography.display.small.fontWeight,
    color: colors.text.primary,
  },
  message: {
    marginTop: spacing[3],
    textAlign: 'center',
    fontSize: typography.body.default.fontSize,
    lineHeight: typography.body.default.lineHeight,
    color: colors.text.secondary,
  },
  button: {
    marginTop: spacing[5],
  },
});
