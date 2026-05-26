import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme';
import Button from './Button';
import { useReducedMotion } from '../lib/use-reduced-motion';
import { useToast } from './ToastProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSend?: (email: string) => void;
};

type InviteContact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

const createInviteLink = () =>
  `https://intown.app/invite/${Math.random().toString(36).slice(2, 11)}`;

const firstContactValue = <T extends Record<string, unknown>>(
  values: T[] | undefined,
  key: keyof T
) => {
  const value = values?.find((item) => typeof item[key] === 'string' && item[key])?.[key];
  return typeof value === 'string' ? value : undefined;
};

const normalizeContacts = (contacts: Contacts.Contact[]): InviteContact[] =>
  contacts
    .map((contact, index): InviteContact | null => {
      const email = firstContactValue(contact.emails, 'email');
      const phone = firstContactValue(contact.phoneNumbers, 'number');
      const id = 'id' in contact && typeof contact.id === 'string'
        ? contact.id
        : `${contact.name ?? 'contact'}-${index}`;

      if (!email && !phone) return null;

      return {
        id,
        name: contact.name || email || phone || 'Unnamed contact',
        email,
        phone,
      };
    })
    .filter((contact): contact is InviteContact => contact !== null)
    .slice(0, 25);

export default function AddFriendModal({ visible, onClose, onSend }: Props) {
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<InviteContact[]>([]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;
  const reducedMotion = useReducedMotion();
  const toast = useToast();

  const inviteMessage = useMemo(
    () =>
      `Join me on InTown so we can see when we're both around: ${inviteLink}`,
    [inviteLink]
  );

  useEffect(() => {
    if (visible) {
      setInviteLink((current) => current || createInviteLink());
      if (reducedMotion) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
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
      setCopied(false);
      setContactsOpen(false);
      setContacts([]);
    }
  }, [visible, opacity, translateY, reducedMotion]);

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

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
      window.alert(`${title}\n\n${message}`);
      return;
    }

    Alert.alert(title, message);
  };

  const copyInviteLink = async () => {
    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      toast.success('Invite link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showAlert('Copy failed', 'We could not copy the invite link. Please try again.');
    }
  };

  const openSmsInvite = (phone?: string) => {
    const recipient = phone ? phone.replace(/[^\d+]/g, '') : '';
    const base = Platform.OS === 'ios' ? `sms:${recipient}&body=` : `sms:${recipient}?body=`;
    Linking.openURL(`${base}${encodeURIComponent(inviteMessage)}`).catch(() => {
      showAlert('Could not open Messages', 'Copy the invite link and send it by text instead.');
    });
  };

  const openEmailInvite = (targetEmail?: string) => {
    const subject = 'Join me on InTown';
    const url = `mailto:${targetEmail ?? ''}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(inviteMessage)}`;

    Linking.openURL(url).catch(() => {
      showAlert('Could not open email', 'Copy the invite link and send it manually instead.');
    });
  };

  const handleSend = () => {
    const trimmed = email.trim();
    if (!trimmed) return;

    if (onSend) {
      onSend(trimmed);
    } else {
      openEmailInvite(trimmed);
    }

    onClose();
  };

  const loadContacts = async () => {
    if (Platform.OS === 'web') {
      showAlert(
        'Open on your phone',
        'Phone contacts are available from the mobile app. You can still copy the invite link here.'
      );
      return;
    }

    setContactsOpen(true);
    setContactsLoading(true);

    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        showAlert(
          'Contacts permission needed',
          'Allow contact access to invite friends from your phone contacts.'
        );
        return;
      }

      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers],
      });
      setContacts(normalizeContacts(result.data));
    } catch {
      showAlert('Contacts unavailable', 'We could not load your contacts. Please try again.');
    } finally {
      setContactsLoading(false);
    }
  };

  const inviteContact = (contact: InviteContact) => {
    if (contact.phone) {
      openSmsInvite(contact.phone);
      return;
    }

    openEmailInvite(contact.email);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close add-friend modal"
        />
        <Animated.View
          style={[styles.backdropFade, { opacity }]}
          pointerEvents="none"
        />
        <Animated.View
          style={[
            styles.card,
            { opacity, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Add friends</Text>
              <Text style={styles.subtitle}>
                Share an invite link or invite someone directly.
              </Text>
            </View>
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

          <View style={styles.linkCard}>
            <View style={styles.linkHeader}>
              <View style={styles.optionIcon}>
                <Feather name="link-2" size={18} color={colors.brand.primary} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Invite link</Text>
                <Text style={styles.optionSubtitle}>
                  Copy this link to send by text or anywhere else.
                </Text>
              </View>
            </View>
            <View style={styles.linkRow}>
              <TextInput
                style={styles.linkInput}
                value={inviteLink}
                editable={false}
                selectTextOnFocus
                accessibilityLabel="Invite link"
              />
              <Button
                label={copied ? 'Copied' : 'Copy'}
                variant="primary"
                size="sm"
                onPress={copyInviteLink}
                style={styles.copyButton}
              />
            </View>
          </View>

          <Pressable
            onPress={loadContacts}
            accessibilityRole="button"
            style={({ pressed, hovered }: any) => [
              styles.optionButton,
              (pressed || hovered) && styles.optionButtonHover,
            ]}
          >
            <View style={styles.optionIcon}>
              <Feather name="users" size={18} color={colors.brand.primary} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Invite from contacts</Text>
              <Text style={styles.optionSubtitle}>
                Pick people from your phone contact list.
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.text.tertiary} />
          </Pressable>

          {contactsOpen && (
            <View style={styles.contactsPanel}>
              {contactsLoading ? (
                <View style={styles.contactsLoading}>
                  <ActivityIndicator color={colors.brand.primary} />
                  <Text style={styles.contactsStatus}>Loading contacts...</Text>
                </View>
              ) : contacts.length === 0 ? (
                <Text style={styles.contactsStatus}>
                  No contacts with a phone number or email were found.
                </Text>
              ) : (
                <ScrollView style={styles.contactsList}>
                  {contacts.map((contact) => (
                    <View key={contact.id} style={styles.contactRow}>
                      <View style={styles.contactAvatar}>
                        <Text style={styles.contactInitial}>
                          {contact.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.contactBody}>
                        <Text style={styles.contactName}>{contact.name}</Text>
                        <Text style={styles.contactDetail}>
                          {contact.phone || contact.email}
                        </Text>
                      </View>
                      <Button
                        label="Invite"
                        variant="secondary"
                        size="sm"
                        onPress={() => inviteContact(contact)}
                      />
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          <View style={styles.emailSection}>
            <Text style={styles.sectionLabel}>Or send by email</Text>
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
          </View>

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
      </View>
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
    maxWidth: 520,
    maxHeight: '90%',
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
    marginBottom: spacing[4],
  },
  headerText: {
    flex: 1,
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
    marginTop: 4,
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
  linkCard: {
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    padding: spacing[3],
    backgroundColor: '#FFFDFC',
    marginBottom: spacing[3],
  },
  linkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  optionButtonHover: {
    backgroundColor: colors.background.secondary,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FCE7EE',
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.default.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 2,
  },
  optionSubtitle: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  linkInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    height: 40,
    fontSize: typography.body.small.fontSize,
    backgroundColor: colors.background.card,
    color: colors.text.primary,
  },
  copyButton: {
    minWidth: 84,
  },
  contactsPanel: {
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    backgroundColor: colors.background.secondary,
    marginTop: -spacing[1],
    marginBottom: spacing[3],
    padding: spacing[2],
  },
  contactsLoading: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  contactsStatus: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.body.small.fontSize,
    color: colors.text.secondary,
    textAlign: 'center',
    padding: spacing[3],
  },
  contactsList: {
    maxHeight: 220,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[2],
    borderRadius: radius.md,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  contactInitial: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  contactBody: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.body.small.fontSize,
    fontWeight: '600',
    color: colors.text.primary,
  },
  contactDetail: {
    fontFamily: fontFamilies.inter.regular,
    fontSize: typography.caption.fontSize,
    color: colors.text.secondary,
  },
  emailSection: {
    marginBottom: spacing[4],
  },
  sectionLabel: {
    fontFamily: fontFamilies.inter.medium,
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: typography.label.letterSpacing,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
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
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  actionButton: {
    flex: 1,
  },
});
