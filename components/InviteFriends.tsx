import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Linking,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import ContactsPickerModal, { SelectedContact } from './ContactsPickerModal';
import { invitesService } from '../services/invites';

type InviteFriendsProps = {
  variant?: 'card' | 'compact';
};

export default function InviteFriends({ variant = 'card' }: InviteFriendsProps) {
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const ensureLink = async (): Promise<string | null> => {
    if (inviteLink) return inviteLink;

    setInviteLoading(true);
    setInviteError(null);
    try {
      const link = await invitesService.createInviteLink();
      setInviteLink(link);
      return link;
    } catch (error: any) {
      setInviteError(error?.message || 'Failed to create invite link');
      return null;
    } finally {
      setInviteLoading(false);
    }
  };

  const generateInviteLink = async () => {
    await ensureLink();
    setCopied(false);
  };

  const getShareLink = async () => ensureLink();

  const copyToClipboard = async () => {
    const link = await getShareLink();
    if (!link) return;

    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy link');
    }
  };

  const shareViaSMS = async () => {
    const link = await getShareLink();
    if (!link) return;

    const message = `Join me on InTown! ${link}`;
    const url = Platform.OS === 'ios' 
      ? `sms:&body=${encodeURIComponent(message)}`
      : `sms:?body=${encodeURIComponent(message)}`;
    
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open SMS');
    });
  };

  const shareViaEmail = async () => {
    const link = await getShareLink();
    if (!link) return;

    const subject = 'Join me on InTown!';
    const body = `Check out InTown - a social calendar app! Join me: ${link}`;
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open email');
    });
  };

  const shareToSocial = async () => {
    const link = await getShareLink();
    if (!link) return;

    try {
      await Share.share({
        message: `Join me on InTown! ${link}`,
        url: link,
        title: 'Join me on InTown!',
      });
    } catch {
      Alert.alert('Error', 'Could not open share sheet');
    }
  };

  const handlePickedContacts = async (picked: SelectedContact[]) => {
    setPickerVisible(false);
    const link = await getShareLink();
    if (!link) return;

    const message = `Join me on InTown! ${link}`;

    const phones = picked.map((c) => c.phoneNumber).filter((p): p is string => Boolean(p));
    const emails = picked.map((c) => c.email).filter((e): e is string => Boolean(e));

    if (phones.length > 0) {
      const sep = Platform.OS === 'ios' ? ',' : ';';
      const numbers = phones.join(sep);
      const url =
        Platform.OS === 'ios'
          ? `sms:${numbers}&body=${encodeURIComponent(message)}`
          : `sms:${numbers}?body=${encodeURIComponent(message)}`;
      Linking.openURL(url).catch(() => {
        Alert.alert('Error', 'Could not open SMS');
      });
      return;
    }

    if (emails.length > 0) {
      const subject = 'Join me on InTown!';
      const body = `Check out InTown - a social calendar app! Join me: ${link}`;
      const url = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      Linking.openURL(url).catch(() => {
        Alert.alert('Error', 'Could not open email');
      });
      return;
    }

    Alert.alert('No contact info', 'Selected contacts have no phone number or email.');
  };
  if (variant === 'compact') {
    return (
      <View style={styles.compactContainer}>
        {!inviteLink ? (
          <TouchableOpacity
            style={styles.compactButton}
            onPress={generateInviteLink}
            disabled={inviteLoading}
          >
            <Text style={styles.compactButtonText}>
              {inviteLoading ? 'Creating invite...' : 'Invite friends'}
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.compactLinkSection}>
              <TextInput
                style={styles.compactLinkInput}
                value={inviteLink}
                editable={false}
              />
              <TouchableOpacity
                style={styles.compactCopyButton}
                onPress={copyToClipboard}
              >
                <Text style={styles.compactCopyButtonText}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.compactActions}>
              <TouchableOpacity
                style={styles.compactActionLink}
                onPress={shareViaSMS}
              >
                <Text style={styles.compactActionLinkText}>Share via SMS</Text>
              </TouchableOpacity>
              <Text style={styles.compactActionDivider}>|</Text>
              <TouchableOpacity
                style={styles.compactActionLink}
                onPress={shareViaEmail}
              >
                <Text style={styles.compactActionLinkText}>Share via Email</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        {inviteError && (
          <View style={styles.compactErrorBox}>
            <Text style={styles.errorText}>{inviteError}</Text>
            <TouchableOpacity onPress={generateInviteLink} disabled={inviteLoading}>
              <Text style={styles.errorRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Invite Friends</Text>
      <Text style={styles.subtitle}>Share InTown with your friends</Text>

      <View style={styles.linkSection}>
        <TextInput
          style={styles.linkInput}
          value={inviteLink || 'Generate invite link'}
          editable={false}
          placeholder="Generate invite link"
        />
        <TouchableOpacity
          style={styles.generateButton}
          onPress={generateInviteLink}
          disabled={inviteLoading}
        >
          <Text style={styles.buttonText}>
            {inviteLoading ? 'Generating...' : 'Generate'}
          </Text>
        </TouchableOpacity>
      </View>

      {inviteError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{inviteError}</Text>
          <TouchableOpacity onPress={generateInviteLink} disabled={inviteLoading}>
            <Text style={styles.errorRetryText}>
              {inviteLoading ? 'Retrying...' : 'Try again'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.contactsButton]}
          onPress={() => setPickerVisible(true)}
        >
          <Text style={styles.actionButtonText}>Invite from your contacts</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.socialButton]}
          onPress={shareToSocial}
        >
          <Text style={styles.actionButtonText}>Share to Facebook / Instagram</Text>
        </TouchableOpacity>

        {inviteLink && (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.copyButton]}
              onPress={copyToClipboard}
            >
              <Text style={styles.actionButtonText}>
                {copied ? 'Copied!' : 'Copy Link'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.smsButton]}
              onPress={shareViaSMS}
            >
              <Text style={styles.actionButtonText}>Share via SMS</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.emailButton]}
              onPress={shareViaEmail}
            >
              <Text style={styles.actionButtonText}>Share via Email</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <ContactsPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onConfirm={handlePickedContacts}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 24,
    lineHeight: 22,
  },
  linkSection: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: '#F4C7C3',
    backgroundColor: '#FFF6F5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: '#8A3B32',
    fontSize: 14,
    lineHeight: 20,
  },
  errorRetryText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '700',
  },
  linkInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#fafafa',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  generateButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    gap: 12,
  },
  actionButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  copyButton: {
    backgroundColor: '#66BB6A',
  },
  smsButton: {
    backgroundColor: '#42A5F5',
  },
  emailButton: {
    backgroundColor: '#FFA726',
  },
  contactsButton: {
    backgroundColor: '#AB47BC',
  },
  socialButton: {
    backgroundColor: '#5C6BC0',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  compactContainer: {
    width: '100%',
    maxWidth: 420,
    marginTop: 20,
    alignItems: 'center',
  },
  compactErrorBox: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#F4C7C3',
    backgroundColor: '#FFF6F5',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    alignItems: 'center',
    gap: 6,
  },
  compactButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  compactButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  compactLinkSection: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactLinkInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#f9f9f9',
  },
  compactCopyButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  compactCopyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  compactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  compactActionLink: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  compactActionLinkText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  compactActionDivider: {
    color: '#999',
    fontSize: 14,
  },
});

