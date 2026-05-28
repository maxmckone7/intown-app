import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authService } from '../../services/auth';
import BrandLogo from '../../components/BrandLogo';
import { colors } from '../../theme';

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
  const floatAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const router = useRouter();

  useEffect(() => {
    const animation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(floatAnim, {
            toValue: 1,
            duration: 3400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(floatAnim, {
            toValue: 0,
            duration: 3400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 2600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 2600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [floatAnim, glowAnim]);

  const floatingStyle = {
    transform: [
      {
        translateY: floatAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [-12, 12],
        }),
      },
      {
        rotate: floatAnim.interpolate({
          inputRange: [0, 1],
          outputRange: ['-6deg', '6deg'],
        }),
      },
    ],
  };

  const glowStyle = {
    opacity: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.35, 0.75],
    }),
    transform: [
      {
        scale: glowAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.96, 1.08],
        }),
      },
    ],
  };

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
        <View style={styles.sunburstOne} />
        <View style={styles.sunburstTwo} />
        <Animated.View style={[styles.floatingOrb, styles.orbPink, floatingStyle]} />
        <Animated.View style={[styles.floatingOrb, styles.orbBlue, glowStyle]} />
        <Animated.View style={[styles.floatingOrb, styles.orbGold, floatingStyle, glowStyle]} />
        <View style={styles.rainbowRibbon}>
          {['#ff3d7f', '#ff8a00', '#ffd400', '#32d74b', '#00c2ff', '#7a5cff'].map((color) => (
            <View key={color} style={[styles.ribbonStripe, { backgroundColor: color }]} />
          ))}
        </View>
      </View>

      <View style={styles.content}>
        <Animated.View style={[styles.heroBadge, glowStyle]}>
          <Text style={styles.heroBadgeText}>Know who's around.</Text>
        </Animated.View>

        <View style={styles.formCard}>
          <BrandLogo style={styles.logo} />
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in and find the brightest plans nearby.</Text>

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

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#9278a8"
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
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
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
              Don't have an account? <Text style={styles.linkTextBold}>Sign Up</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff4fb',
    overflow: 'hidden',
  },
  backgroundScene: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff4fb',
  },
  sunburstOne: {
    position: 'absolute',
    top: -150,
    left: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#ffec8b',
    opacity: 0.85,
  },
  sunburstTwo: {
    position: 'absolute',
    right: -120,
    bottom: -130,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: '#95f1ff',
    opacity: 0.75,
  },
  floatingOrb: {
    position: 'absolute',
    borderRadius: 999,
  },
  orbPink: {
    top: 96,
    right: 34,
    width: 96,
    height: 96,
    backgroundColor: '#ff6fb5',
    opacity: 0.55,
  },
  orbBlue: {
    bottom: 124,
    left: 24,
    width: 118,
    height: 118,
    backgroundColor: '#6d7dff',
  },
  orbGold: {
    top: 220,
    left: -26,
    width: 74,
    height: 74,
    backgroundColor: '#ffb000',
  },
  rainbowRibbon: {
    position: 'absolute',
    top: 54,
    left: -36,
    right: -36,
    height: 22,
    borderRadius: 22,
    flexDirection: 'row',
    overflow: 'hidden',
    transform: [{ rotate: '-8deg' }],
    opacity: 0.92,
  },
  ribbonStripe: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  heroBadge: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#ffffffcc',
    borderWidth: 1,
    borderColor: '#ffffff',
    marginBottom: 24,
    shadowColor: '#ff3d7f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
  heroBadgeText: {
    color: '#7d22d8',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  formCard: {
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
  logo: {
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 34,
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
  button: {
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
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
    marginBottom: 8,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: '#7d22d8',
    fontSize: 14,
    fontWeight: '800',
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
    fontWeight: '900',
    letterSpacing: 0.4,
    zIndex: 1,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ead3f5',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#8e63a5',
    fontSize: 14,
    fontWeight: '800',
  },
  socialButton: {
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
  },
  googleButton: {
    borderColor: '#ffd0e8',
    backgroundColor: '#fff',
  },
  appleButton: {
    borderColor: '#2f1555',
    backgroundColor: '#2f1555',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#58306d',
  },
  appleButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  linkButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: '#6e4c84',
    fontSize: 14,
  },
  linkTextBold: {
    color: '#ff2d55',
    fontWeight: '900',
  },
});

