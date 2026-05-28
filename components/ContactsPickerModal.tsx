import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Contacts from 'expo-contacts';

export type SelectedContact = {
  id: string;
  name: string;
  phoneNumber?: string;
  email?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (contacts: SelectedContact[]) => void;
};

type LoadState = 'idle' | 'loading' | 'denied' | 'ready' | 'error';

export default function ContactsPickerModal({ visible, onClose, onConfirm }: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [contacts, setContacts] = useState<SelectedContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const load = async () => {
      setState('loading');
      const { status } = await Contacts.requestPermissionsAsync();
      if (cancelled) return;

      if (status !== 'granted') {
        setState('denied');
        return;
      }

      try {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
          sort: Contacts.SortTypes.FirstName,
        });
        if (cancelled) return;

        const flattened: SelectedContact[] = [];
        for (const c of data) {
          const phone = c.phoneNumbers?.[0]?.number?.replace(/\s+/g, '');
          const email = c.emails?.[0]?.email;
          if (!phone && !email) continue;
          flattened.push({
            id: c.id ?? `${c.firstName ?? ''}-${c.lastName ?? ''}-${phone ?? email}`,
            name:
              c.name?.trim() ||
              [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
              'Unnamed',
            phoneNumber: phone,
            email,
          });
        }

        setContacts(flattened);
        setState('ready');
      } catch {
        setState('error');
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setSearch('');
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phoneNumber?.includes(q) || c.email?.toLowerCase().includes(q),
    );
  }, [contacts, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    const picks = contacts.filter((c) => selected.has(c.id));
    if (picks.length === 0) {
      Alert.alert('No contacts selected', 'Pick at least one contact to invite.');
      return;
    }
    onConfirm(picks);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Invite Contacts</Text>
          <TouchableOpacity onPress={handleConfirm} style={styles.headerButton} disabled={selected.size === 0}>
            <Text style={[styles.headerButtonText, styles.headerSend, selected.size === 0 && styles.headerSendDisabled]}>
              Send ({selected.size})
            </Text>
          </TouchableOpacity>
        </View>

        {state === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.muted}>Loading contacts…</Text>
          </View>
        )}

        {state === 'denied' && (
          <View style={styles.center}>
            <Text style={styles.title}>Contacts access denied</Text>
            <Text style={styles.muted}>
              Enable contacts access for InTown in {Platform.OS === 'ios' ? 'iOS Settings' : 'App Settings'} to invite people directly.
            </Text>
          </View>
        )}

        {state === 'error' && (
          <View style={styles.center}>
            <Text style={styles.title}>Could not load contacts</Text>
            <Text style={styles.muted}>Try again later.</Text>
          </View>
        )}

        {state === 'ready' && (
          <>
            <View style={styles.searchWrap}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search name, phone, or email"
                placeholderTextColor="#999"
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selected.has(item.id);
                return (
                  <TouchableOpacity style={styles.row} onPress={() => toggle(item.id)}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                      {isSelected && <Text style={styles.check}>✓</Text>}
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.detail}>{item.phoneNumber ?? item.email}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={styles.muted}>No contacts match “{search}”.</Text>
                </View>
              }
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerButton: { minWidth: 80 },
  headerButtonText: { fontSize: 16, color: '#007AFF' },
  headerSend: { fontWeight: '700', textAlign: 'right' },
  headerSendDisabled: { color: '#bbb' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#222' },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  searchInput: {
    backgroundColor: '#f4f4f6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#222',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#bbb',
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  check: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowText: { flex: 1 },
  name: { fontSize: 16, color: '#222', fontWeight: '500' },
  detail: { fontSize: 13, color: '#777', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 18, fontWeight: '600', color: '#222', marginBottom: 8, textAlign: 'center' },
  muted: { fontSize: 14, color: '#777', textAlign: 'center', marginTop: 8 },
});
