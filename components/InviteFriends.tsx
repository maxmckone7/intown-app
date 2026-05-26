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
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

type InviteFriendsProps = {
  variant?: 'card' | 'compact';
};

export default function InviteFriends({ variant = 'card' }: InviteFriendsProps) {
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Generate mock invite link (stub for now)
  const generateInviteLink = () => {
    // TODO: Replace with real invite link generation from API
    const mockLink = `https://intown.app/invite/${Math.random().toString(36).slice(2, 11)}`;
    setInviteLink(mockLink);
    setCopied(false);
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

  if (variant === 'compact') {
    return (
      <View style={styles.compactContainer}>
        {!inviteLink ? (
          <TouchableOpacity
            style={styles.compactButton}
            onPress={generateInviteLink}
          >
            <Text style={styles.compactButtonText}>Invite friends</Text>
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
        >
          <Text style={styles.buttonText}>Generate</Text>
        </TouchableOpacity>
      </View>

      {inviteLink && (
        <View style={styles.actions}>
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
        </View>
      )}
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

