import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import Button from './Button';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSend?: (email: string) => void;
};

/**
 * Placeholder modal for inviting a friend via email. The actual invite
 * flow is intentionally out of scope for DES-17 — we just collect the
 * email and pop a "Invite sent" confirmation via onSend (or a console
 * fallback). Wiring is deferred to a future ticket.
 */
export default function AddFriendModal({ visible, onClose, onSend }: Props) {
  const [email, setEmail] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          damping: 18,
          stiffness: 220,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      opacity.setValue(0);
      translateY.setValue(30);
      setEmail('');
    }
  }, [visible, opacity, translateY]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const handleSend = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    if (onSend) {
      onSend(trimmed);
    } else if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      window.alert
    ) {
      window.alert(`Invite sent to ${trimmed} — coming soon.`);
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Close add-friend modal"
      >
        <Animated.View style={[styles.backdropFade, { opacity }]} />
        <Animated.View
          style={[
            styles.card,
            { opacity, transform: [{ translateY }] },
          ]}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text style={styles.title}>Add a friend</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed, hovered }: any) => [
                styles.closeButton,
                (pressed || hovered) && styles.closeButtonHover,
              ]}
            >
              <Text style={styles.closeGlyph}>×</Text>
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Send an invite by email. We'll let them know you'd like to see
            their availability.
          </Text>

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="friend@email.com"
            placeholderTextColor={colors.text.tertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />

          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={onClose}
              style={styles.actionButton}
            />
            <Button
              label="Send invite"
              variant="primary"
              onPress={handleSend}
              disabled={!email.trim()}
              style={styles.actionButton}
            />
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  backdropFade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(31, 27, 22, 0.4)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    padding: spacing[6],
    ...shadows.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  title: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    fontWeight: '500',
    color: colors.text.primary,
  },
  subtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: 20,
    marginBottom: spacing[4],
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonHover: {
    backgroundColor: colors.background.secondary,
  },
  closeGlyph: {
    fontSize: 24,
    lineHeight: 24,
    color: colors.text.secondary,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    height: 48,
    fontSize: typography.body.default.fontSize,
    backgroundColor: colors.background.card,
    color: colors.text.primary,
    marginBottom: spacing[4],
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  actionButton: {
    flex: 1,
  },
});
