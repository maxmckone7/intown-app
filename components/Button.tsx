import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

type Variant = 'primary' | 'secondary' | 'destructive';
type Size = 'sm' | 'md';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  style?: ViewStyle;
};

export default function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const isInactive = disabled || loading;
  const variantStyles = VARIANT_STYLES[variant];
  const sizeStyles = SIZE_STYLES[size];

  return (
    <Pressable
      onPress={isInactive ? undefined : onPress}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        sizeStyles.container,
        variantStyles.container,
        pressed && !isInactive && [styles.pressed, variantStyles.pressed],
        isInactive && styles.inactive,
        fullWidth && styles.fullWidth,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.indicatorColor} />
      ) : (
        <View style={styles.contentRow}>
          {leftIcon}
          <Text
            style={[styles.label, sizeStyles.label, variantStyles.label]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const RADIUS = 12;

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  inactive: {
    opacity: 0.5,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

const SIZE_STYLES = {
  sm: StyleSheet.create({
    container: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 36,
    },
    label: {
      fontSize: 14,
    },
  }),
  md: StyleSheet.create({
    container: {
      paddingHorizontal: 20,
      paddingVertical: 14,
      minHeight: 48,
    },
    label: {
      fontSize: 16,
    },
  }),
} as const;

const VARIANT_STYLES = {
  primary: {
    container: {
      backgroundColor: '#007AFF',
      borderColor: '#007AFF',
    },
    pressed: {
      backgroundColor: '#0062CC',
      borderColor: '#0062CC',
    },
    label: {
      color: '#fff',
    },
    indicatorColor: '#fff',
  },
  secondary: {
    container: {
      backgroundColor: '#fff',
      borderColor: '#007AFF',
      borderWidth: 1.5,
    },
    pressed: {
      backgroundColor: '#EAF3FF',
    },
    label: {
      color: '#007AFF',
    },
    indicatorColor: '#007AFF',
  },
  destructive: {
    container: {
      backgroundColor: '#F44336',
      borderColor: '#F44336',
    },
    pressed: {
      backgroundColor: '#C62828',
      borderColor: '#C62828',
    },
    label: {
      color: '#fff',
    },
    indicatorColor: '#fff',
  },
} as const;
