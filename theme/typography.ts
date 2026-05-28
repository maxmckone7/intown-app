import type { TextStyle } from 'react-native';

export const fontFamilies = {
  fraunces: {
    medium: 'Fraunces_500Medium',
    semibold: 'Fraunces_600SemiBold',
  },
  inter: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
  },
} as const;

export const typography = {
  display: {
    large: {
      fontFamily: fontFamilies.fraunces.semibold,
      fontSize: 48,
      fontWeight: '600',
      lineHeight: 56,
    },
    medium: {
      fontFamily: fontFamilies.fraunces.semibold,
      fontSize: 32,
      fontWeight: '600',
      lineHeight: 38,
    },
    small: {
      fontFamily: fontFamilies.fraunces.medium,
      fontSize: 24,
      fontWeight: '500',
      lineHeight: 30,
    },
  },
  body: {
    large: {
      fontFamily: fontFamilies.inter.regular,
      fontSize: 18,
      fontWeight: '400',
      lineHeight: 26,
    },
    default: {
      fontFamily: fontFamilies.inter.regular,
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 24,
    },
    small: {
      fontFamily: fontFamilies.inter.regular,
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 20,
    },
  },
  label: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.5,
    lineHeight: 18,
  },
  caption: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  calendar: {
    month: {
      fontFamily: fontFamilies.fraunces.semibold,
      fontSize: 36,
      fontWeight: '600',
      letterSpacing: -0.8,
      lineHeight: 42,
    },
    weekday: {
      fontFamily: fontFamilies.inter.medium,
      fontSize: 11,
      fontWeight: '500',
      letterSpacing: 1.4,
      lineHeight: 16,
      textTransform: 'uppercase',
    },
    dayNumber: {
      fontFamily: fontFamilies.fraunces.medium,
      fontSize: 28,
      fontWeight: '500',
      letterSpacing: -0.6,
      lineHeight: 32,
      fontVariant: ['tabular-nums'],
    },
    meta: {
      fontFamily: fontFamilies.inter.medium,
      fontSize: 11,
      fontWeight: '500',
      letterSpacing: 0.8,
      lineHeight: 14,
      textTransform: 'uppercase',
    },
  },
} satisfies Record<string, TextStyle | Record<string, TextStyle>>;

export type Typography = typeof typography;
