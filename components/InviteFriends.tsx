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

export default function InviteFriends() {
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  const ensureLink = (): string => {
    if (inviteLink) return inviteLink;
    const mockLink = `https://intown.app/invite/${Math.random().toString(36).slice(2, 11)}`;
    setInviteLink(mockLink);
    setCopied(false);
    return mockLink;
  };

  // Generate mock invite link (stub for now)
  const generateInviteLink = () => {
    // TODO: Replace with real invite link generation from API
    ensureLink();
  };

  const copyToClipboard = async () => {
    if (!inviteLink) {
      generateInviteLink();
      return;
    }

    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy link');
    }
  };

  const shareViaSMS = () => {
    if (!inviteLink) {
      generateInviteLink();
      return;
    }

    const message = `Join me on InTown! ${inviteLink}`;
    const url = Platform.OS === 'ios' 
      ? `sms:&body=${encodeURIComponent(message)}`
      : `sms:?body=${encodeURIComponent(message)}`;
    
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open SMS');
    });
  };

  const shareViaEmail = () => {
    if (!inviteLink) {
      generateInviteLink();
      return;
    }

    const subject = 'Join me on InTown!';
    const body = `Check out InTown - a social calendar app! Join me: ${inviteLink}`;
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open email');
    });
  };

  const shareToSocial = async () => {
    const link = ensureLink();
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

  const handlePickedContacts = (picked: SelectedContact[]) => {
    setPickerVisible(false);
    const link = ensureLink();
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
        >
          <Text style={styles.buttonText}>Generate</Text>
        </TouchableOpacity>
      </View>

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
});

