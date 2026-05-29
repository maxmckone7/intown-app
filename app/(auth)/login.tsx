import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import BrandLogo from '../../components/BrandLogo';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '../../theme';

// Web-compatible alert function
const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      console.log('Attempting login with:', email);
      const result = await authService.signIn(email, password);
      console.log('Login result:', result);
      
      // Use router.push instead of replace for better web compatibility
      if (Platform.OS === 'web') {
        router.push('/(tabs)');
      } else {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      showAlert('Login Failed', error.message || 'An error occurred');
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await authService.signInWithGoogle();
      if (Platform.OS === 'web') {
        router.push('/(tabs)');
      } else {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      console.error('Google login error:', error);
      showAlert('Login Failed', error.message || 'Unable to continue with Google.');
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setLoading(true);
    try {
      await authService.signInWithApple();
      if (Platform.OS === 'web') {
        router.push('/(tabs)');
      } else {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      console.error('Apple login error:', error);
      showAlert('Login Failed', error.message || 'Unable to continue with Apple.');
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.backgroundScene}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
        <View style={styles.gridWash} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          isDesktop && styles.scrollContentDesktop,
        ]}
      >
        <View style={[styles.shell, isDesktop && styles.shellDesktop]}>
          <View style={[styles.heroPanel, isDesktop && styles.heroPanelDesktop]}>
            <BrandLogo
              style={styles.heroLogo}
              textStyle={styles.heroLogoText}
              underlineStyle={styles.heroLogoUnderline}
            />
            <Text style={styles.eyebrow}>Social calendar for real life</Text>
            <Text style={[styles.heroTitle, !isDesktop && styles.heroTitleCompact]}>
              Know who's in town before plans happen.
            </Text>
            <Text style={styles.heroCopy}>
              InTown helps close friends share when they're around, spot overlapping
              free days, and turn "we should hang out" into a plan.
            </Text>

            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <View>
                  <Text style={styles.previewLabel}>This weekend</Text>
                  <Text style={styles.previewTitle}>4 friends nearby</Text>
                </View>
                <View style={styles.previewBadge}>
                  <Text style={styles.previewBadgeText}>In town</Text>
                </View>
              </View>

              <View style={styles.dayRow}>
                {[
                  { day: 'Fri', count: '2' },
                  { day: 'Sat', count: '4', active: true },
                  { day: 'Sun', count: '3' },
                ].map((item) => (
                  <View
                    key={item.day}
                    style={[styles.dayCell, item.active && styles.dayCellActive]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        item.active && styles.dayTextActive,
                      ]}
                    >
                      {item.day}
                    </Text>
                    <Text
                      style={[
                        styles.dayCount,
                        item.active && styles.dayTextActive,
                      ]}
                    >
                      {item.count}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.friendStack}>
                {['Maya', 'Leo', 'Ari'].map((name, index) => (
                  <View key={name} style={styles.friendRow}>
                    <View style={[styles.avatarDot, index === 1 && styles.avatarDotGold]} />
                    <Text style={styles.friendName}>{name}</Text>
                    <Text style={styles.friendMeta}>
                      {index === 0 ? 'Free Saturday' : index === 1 ? 'Back in town' : 'Coffee?'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.featureRow}>
              <View style={styles.featurePill}>
                <Text style={styles.featurePillText}>Private by default</Text>
              </View>
              <View style={styles.featurePill}>
                <Text style={styles.featurePillText}>Built for close friends</Text>
              </View>
            </View>
          </View>

          <View style={[styles.formCard, isDesktop && styles.formCardDesktop]}>
            <Text style={styles.formEyebrow}>Welcome to InTown</Text>
            <Text style={styles.title}>Sign in to see who's around.</Text>
            <Text style={styles.subtitle}>
              Catch up with the people already nearby or add your next free stretch.
            </Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
              placeholderTextColor={colors.text.tertiary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
              placeholderTextColor={colors.text.tertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
          />

          <TouchableOpacity
            style={styles.forgotPasswordButton}
            onPress={() =>
              router.push({
                pathname: '/(auth)/forgot-password',
                params: email ? { email } : {},
              })
            }
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.forgotPasswordText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color="#fff" style={styles.buttonContent} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.socialButton, styles.googleButton]}
            onPress={handleGoogleLogin}
            disabled={loading}
          >
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.socialButton, styles.appleButton]}
              onPress={handleAppleLogin}
              disabled={loading}
            >
              <Text style={styles.appleButtonText}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push('/(auth)/signup')}
          >
            <Text style={styles.linkText}>
              New here? <Text style={styles.linkTextBold}>Create an account</Text>
            </Text>
          </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    overflow: 'hidden',
  },
  backgroundScene: {
    ...StyleSheet.absoluteFillObject,
  },
  glowTop: {
    position: 'absolute',
    top: -220,
    right: -120,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: '#F8D8B8',
    opacity: 0.58,
  },
  glowBottom: {
    position: 'absolute',
    left: -180,
    bottom: -220,
    width: 540,
    height: 540,
    borderRadius: 270,
    backgroundColor: '#F3B7C8',
    opacity: 0.32,
  },
  gridWash: {
    position: 'absolute',
    top: 96,
    right: 72,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#FFFFFF',
    opacity: 0.42,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[6],
  },
  scrollContentDesktop: {
    justifyContent: 'center',
    paddingHorizontal: spacing[7],
    paddingVertical: spacing[7],
  },
  shell: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    gap: spacing[5],
  },
  shellDesktop: {
    minHeight: 660,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing[7],
  },
  heroPanel: {
    borderRadius: 36,
    padding: spacing[5],
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    ...shadows.lg,
  },
  heroPanelDesktop: {
    flex: 1,
    padding: spacing[7],
    justifyContent: 'space-between',
  },
  heroLogo: {
    marginBottom: spacing[6],
  },
  heroLogoText: {
    color: colors.text.primary,
  },
  heroLogoUnderline: {
    backgroundColor: colors.brand.primary,
  },
  eyebrow: {
    ...typography.label,
    color: colors.brand.primary,
    textTransform: 'uppercase',
    marginBottom: spacing[3],
  },
  heroTitle: {
    ...typography.display.large,
    maxWidth: 620,
    color: colors.text.primary,
    letterSpacing: -1.2,
    marginBottom: spacing[4],
  },
  heroTitleCompact: {
    fontSize: 38,
    lineHeight: 44,
  },
  heroCopy: {
    ...typography.body.large,
    maxWidth: 560,
    color: colors.text.secondary,
    marginBottom: spacing[6],
  },
  previewCard: {
    maxWidth: 520,
    borderRadius: 28,
    padding: spacing[5],
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadows.xl,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  previewLabel: {
    ...typography.caption,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  previewTitle: {
    ...typography.display.small,
    color: colors.text.primary,
  },
  previewBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: '#FCE8EE',
  },
  previewBadgeText: {
    ...typography.label,
    color: colors.brand.primary,
  },
  dayRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  dayCell: {
    flex: 1,
    minHeight: 92,
    borderRadius: 22,
    padding: spacing[3],
    justifyContent: 'space-between',
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  dayCellActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  dayText: {
    ...typography.label,
    color: colors.text.secondary,
  },
  dayTextActive: {
    color: '#FFFFFF',
  },
  dayCount: {
    fontFamily: fontFamilies.fraunces.semibold,
    fontSize: 34,
    fontWeight: '600',
    lineHeight: 38,
    color: colors.text.primary,
  },
  friendStack: {
    gap: spacing[3],
  },
  friendRow: {
    minHeight: 44,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background.primary,
  },
  avatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#86A789',
  },
  avatarDotGold: {
    backgroundColor: '#E8C547',
  },
  friendName: {
    ...typography.body.small,
    flex: 1,
    fontFamily: fontFamilies.inter.medium,
    fontWeight: '500',
    color: colors.text.primary,
  },
  friendMeta: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[5],
  },
  featurePill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: '#FFFFFFB8',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  featurePillText: {
    ...typography.label,
    color: colors.text.secondary,
  },
  formCard: {
    width: '100%',
    alignSelf: 'center',
    maxWidth: 460,
    borderRadius: 32,
    padding: spacing[5],
    backgroundColor: '#FFFFFFF2',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    ...shadows.xl,
  },
  formCardDesktop: {
    alignSelf: 'center',
    padding: spacing[6],
  },
  formEyebrow: {
    ...typography.label,
    color: colors.brand.primary,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  title: {
    ...typography.display.medium,
    textAlign: 'center',
    marginBottom: spacing[3],
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.body.default,
    textAlign: 'center',
    marginBottom: spacing[5],
    color: colors.text.secondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: 15,
    fontSize: 16,
    marginBottom: spacing[4],
    color: colors.text.primary,
    backgroundColor: colors.background.card,
  },
  button: {
    borderRadius: radius.lg,
    padding: spacing[4],
    alignItems: 'center',
    marginTop: spacing[2],
    overflow: 'hidden',
    backgroundColor: colors.brand.primary,
    shadowColor: colors.brand.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: -4,
    marginBottom: spacing[2],
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: colors.brand.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonContent: {
    zIndex: 1,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
    zIndex: 1,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing[5],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  dividerText: {
    marginHorizontal: spacing[4],
    color: colors.text.tertiary,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  socialButton: {
    borderRadius: radius.lg,
    padding: spacing[4],
    alignItems: 'center',
    marginBottom: spacing[3],
    borderWidth: 1.5,
  },
  googleButton: {
    borderColor: colors.border.default,
    backgroundColor: colors.background.card,
  },
  appleButton: {
    borderColor: colors.text.primary,
    backgroundColor: colors.text.primary,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  appleButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  linkButton: {
    marginTop: spacing[5],
    alignItems: 'center',
  },
  linkText: {
    color: colors.text.secondary,
    fontSize: 14,
  },
  linkTextBold: {
    color: colors.brand.primary,
    fontWeight: '800',
  },
});

