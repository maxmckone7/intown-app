import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import { useReducedMotion } from '../lib/use-reduced-motion';

type ToastVariant = 'success' | 'info';

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  show: (message: string, options?: { variant?: ToastVariant }) => void;
  success: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;
const TOAST_DURATION_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options?: { variant?: ToastVariant }) => {
      const id = nextId++;
      const toast: Toast = {
        id,
        message,
        variant: options?.variant ?? 'success',
      };
      setToasts((prev) => [...prev, toast]);
      // Auto-dismiss; consumers can dismiss earlier by mutating state
      // but the common case is just letting it expire.
      setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    show,
    success: (message) => show(message, { variant: 'success' }),
    info: (message) => show(message, { variant: 'info' }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={styles.stack}>
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft: log + no-op so a render without a Provider doesn't
    // crash a screen. The app's root layout mounts the provider.
    return {
      show: (msg) => {
        // eslint-disable-next-line no-console
        console.warn('Toast used without a ToastProvider:', msg);
      },
      success: (msg) => {
        // eslint-disable-next-line no-console
        console.warn('Toast used without a ToastProvider:', msg);
      },
      info: (msg) => {
        // eslint-disable-next-line no-console
        console.warn('Toast used without a ToastProvider:', msg);
      },
    };
  }
  return ctx;
}

/* -------------------------------------------------------------- */

function ToastView({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(40)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translateX.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: 0,
        damping: 18,
        stiffness: 220,
        mass: 0.6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateX, reducedMotion]);

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          opacity,
          transform: [{ translateX }],
        },
      ]}
    >
      <View style={[styles.iconWell, toast.variant === 'info' && styles.iconWellInfo]}>
        <Feather
          name={toast.variant === 'info' ? 'info' : 'check'}
          size={16}
          color="#FFFFFF"
        />
      </View>
      <Text style={styles.message} numberOfLines={2}>
        {toast.message}
      </Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={6}
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
        style={({ pressed, hovered }: any) => [
          styles.closeButton,
          (pressed || hovered) && styles.closeButtonHover,
        ]}
      >
        <Feather name="x" size={14} color={colors.text.secondary} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    right: spacing[4],
    bottom: spacing[5],
    gap: spacing[2],
    maxWidth: 360,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadows.lg,
  },
  iconWell: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.heatmap.high,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWellInfo: {
    backgroundColor: colors.brand.primary,
  },
  message: {
    flex: 1,
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.primary,
  },
  closeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonHover: {
    backgroundColor: colors.background.secondary,
  },
});
