import { ReactNode } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Button from './Button';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';

type StateAction = {
  label: string;
  onPress: () => void;
  loading?: boolean;
};

type StateFeedbackProps = {
  title: string;
  body: string;
  eyebrow?: string;
  icon?: ReactNode;
  primaryAction?: StateAction;
  secondaryAction?: StateAction;
  compact?: boolean;
  style?: ViewStyle;
};

export default function StateFeedback({
  title,
  body,
  eyebrow,
  icon,
  primaryAction,
  secondaryAction,
  compact = false,
  style,
}: StateFeedbackProps) {
  return (
    <View style={[styles.card, compact && styles.compactCard, style]}>
      {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      {icon && <View style={styles.iconWrap}>{icon}</View>}
      <Text style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {(primaryAction || secondaryAction) && (
        <View style={[styles.actions, compact && styles.compactActions]}>
          {primaryAction && (
            <Button
              label={primaryAction.label}
              onPress={primaryAction.onPress}
              loading={primaryAction.loading}
              disabled={primaryAction.loading}
              style={styles.actionButton}
            />
          )}
          {secondaryAction && (
            <Button
              label={secondaryAction.label}
              variant="secondary"
              onPress={secondaryAction.onPress}
              loading={secondaryAction.loading}
              disabled={secondaryAction.loading}
              style={styles.actionButton}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[6],
    ...shadows.sm,
  },
  compactCard: {
    padding: spacing[4],
  },
  eyebrow: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    letterSpacing: typography.label.letterSpacing,
    color: colors.brand.primary,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  title: {
    fontFamily: fontFamilies.fraunces.medium,
    fontSize: typography.display.small.fontSize,
    lineHeight: typography.display.small.lineHeight,
    fontWeight: '500',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  compactTitle: {
    fontSize: typography.body.large.fontSize,
    lineHeight: typography.body.large.lineHeight,
  },
  body: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.default.fontSize,
    lineHeight: typography.body.default.lineHeight,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing[3],
    marginTop: spacing[5],
  },
  compactActions: {
    marginTop: spacing[4],
  },
  actionButton: {
    minWidth: 160,
  },
});
