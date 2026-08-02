import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Button from './Button';
import { useToast } from './ToastProvider';
import {
  CalendarConnection,
  CalendarConnectionError,
  CalendarConnectionStatus,
  googleCalendarService,
} from '../services/googleCalendar';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';

type Props = {
  userId: string;
};

// Status accents. The theme only ships in/out semantic colors, so define the
// connection-state palette locally, keeping to the app's warm tone.
const SUCCESS_TEXT = '#3F7A4D';
const WARNING_TEXT = '#9A4B22';
const WARNING_BG = '#FBEFE2';
const WARNING_BORDER = '#F0D3B4';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

const showConfirmation = (
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void | Promise<void>
) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) {
      void onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: confirmText,
      style: 'destructive',
      onPress: () => {
        void onConfirm();
      },
    },
  ]);
};

/** Visual treatment + copy for each connection status. */
const STATUS_META: Record<
  CalendarConnectionStatus,
  { label: string; tone: 'positive' | 'warning'; needsReconnect: boolean }
> = {
  connected: { label: 'Connected', tone: 'positive', needsReconnect: false },
  expired: { label: 'Authorization expired', tone: 'warning', needsReconnect: true },
  revoked: { label: 'Access revoked', tone: 'warning', needsReconnect: true },
  error: { label: 'Needs attention', tone: 'warning', needsReconnect: true },
};

const DEFAULT_REASON: Record<CalendarConnectionStatus, string> = {
  connected: '',
  expired: 'Your Google authorization expired. Reconnect to resume calendar sync.',
  revoked: 'Google access was revoked. Reconnect to resume calendar sync.',
  error: 'Something went wrong with your Google connection. Try reconnecting.',
};

export default function CalendarConnectionCard({ userId }: Props) {
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const existing = await googleCalendarService.getConnection(userId);
      // If we think we're connected, confirm the grant is still valid so a
      // silently-revoked/expired authorization surfaces without a sync run.
      if (existing && existing.status === 'connected') {
        const verified = await googleCalendarService.verifyConnection(userId);
        setConnection(verified ?? existing);
      } else {
        setConnection(existing);
      }
    } catch {
      // A status read failing shouldn't break the profile; show the connect CTA.
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await googleCalendarService.connect(userId);
      setConnection(result);
      toast.success('Google Calendar connected');
    } catch (error) {
      if (error instanceof CalendarConnectionError && error.code === 'cancelled') {
        toast.info('Google connection cancelled');
      } else {
        const message =
          error instanceof CalendarConnectionError
            ? error.message
            : 'Something went wrong connecting Google Calendar. Please try again.';
        showAlert('Couldn’t connect Google Calendar', message);
      }
      // Reflect any status the service persisted (e.g. scope declined).
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    showConfirmation(
      'Disconnect Google Calendar',
      'Status will no longer update automatically from your calendar. You can reconnect anytime.',
      'Disconnect',
      async () => {
        setBusy(true);
        try {
          await googleCalendarService.disconnect(userId);
          setConnection(null);
          toast.info('Google Calendar disconnected');
        } catch (error) {
          const message =
            error instanceof CalendarConnectionError
              ? error.message
              : 'Failed to disconnect Google Calendar.';
          showAlert('Error', message);
        } finally {
          setBusy(false);
        }
      }
    );
  };

  const meta = connection ? STATUS_META[connection.status] : null;
  const needsReconnect = meta?.needsReconnect ?? false;
  const reason =
    connection && connection.status !== 'connected'
      ? connection.last_error || DEFAULT_REASON[connection.status]
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Calendar Sync</Text>
          <Text style={styles.subtitle}>
            Connect Google Calendar to update your in/out status automatically.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.row}>
            <View style={styles.iconBadge}>
              <Feather name="calendar" size={18} color={colors.brand.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Google Calendar</Text>
              {connection ? (
                <>
                  <View style={styles.statusLine}>
                    <View
                      style={[
                        styles.statusDot,
                        meta?.tone === 'positive'
                          ? styles.statusDotPositive
                          : styles.statusDotWarning,
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusText,
                        meta?.tone === 'positive'
                          ? styles.statusTextPositive
                          : styles.statusTextWarning,
                      ]}
                    >
                      {meta?.label}
                    </Text>
                  </View>
                  {connection.google_account_email ? (
                    <Text style={styles.accountEmail}>
                      {connection.google_account_email}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.rowDescription}>
                  Not connected. We’ll only read your calendar to detect when
                  you’re out of town.
                </Text>
              )}
            </View>
          </View>

          {reason ? (
            <View style={styles.noticeBox}>
              <Feather name="alert-triangle" size={16} color={WARNING_TEXT} />
              <Text style={styles.noticeText}>{reason}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {!connection ? (
              <Button
                label="Connect Google Calendar"
                variant="primary"
                onPress={handleConnect}
                loading={busy}
                disabled={busy}
                leftIcon={<Feather name="link" size={16} color="#fff" />}
                fullWidth
              />
            ) : (
              <>
                {needsReconnect ? (
                  <Button
                    label="Reconnect"
                    variant="primary"
                    onPress={handleConnect}
                    loading={busy}
                    disabled={busy}
                    style={styles.actionButton}
                  />
                ) : null}
                <Button
                  label="Disconnect"
                  variant="secondary"
                  onPress={handleDisconnect}
                  disabled={busy}
                  style={styles.actionButton}
                />
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[5],
    ...shadows.sm,
  },
  header: {
    marginBottom: spacing[4],
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: colors.text.secondary,
    lineHeight: 22,
  },
  loadingRow: {
    paddingVertical: spacing[5],
    alignItems: 'center',
  },
  body: {
    gap: spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing[4],
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FCE8EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  rowDescription: {
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: typography.body.small.lineHeight,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotPositive: {
    backgroundColor: SUCCESS_TEXT,
  },
  statusDotWarning: {
    backgroundColor: WARNING_TEXT,
  },
  statusText: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '600',
  },
  statusTextPositive: {
    color: SUCCESS_TEXT,
  },
  statusTextWarning: {
    color: WARNING_TEXT,
  },
  accountEmail: {
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: WARNING_BG,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: WARNING_BORDER,
    padding: spacing[3],
  },
  noticeText: {
    flex: 1,
    fontSize: typography.body.small.fontSize,
    lineHeight: typography.body.small.lineHeight,
    color: WARNING_TEXT,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[1],
  },
  actionButton: {
    flex: 1,
  },
});
