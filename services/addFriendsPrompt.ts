import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'intown:add-friends-prompt';

const eligibleKey = (userId: string) => `${STORAGE_PREFIX}:eligible:${userId}`;
const dismissedKey = (userId: string) => `${STORAGE_PREFIX}:dismissed:${userId}`;
const availabilityPendingKey = (userId: string) =>
  `${STORAGE_PREFIX}:availability-pending:${userId}`;
const availabilityCompleteKey = (userId: string) =>
  `${STORAGE_PREFIX}:availability-complete:${userId}`;

const shouldSetAvailability = async (userId: string) => {
  const [isPending, isComplete] = await Promise.all([
    AsyncStorage.getItem(availabilityPendingKey(userId)),
    AsyncStorage.getItem(availabilityCompleteKey(userId)),
  ]);

  return isPending === 'true' && isComplete !== 'true';
};

export const addFriendsPromptService = {
  async markEligible(userId: string) {
    try {
      await Promise.all([
        AsyncStorage.setItem(availabilityPendingKey(userId), 'true'),
        AsyncStorage.removeItem(eligibleKey(userId)),
        AsyncStorage.removeItem(dismissedKey(userId)),
      ]);
    } catch (error) {
      console.warn('Failed to start first-run availability flow:', error);
    }
  },

  async shouldSetAvailability(userId: string) {
    try {
      return await shouldSetAvailability(userId);
    } catch (error) {
      console.warn('Failed to read first-run availability state:', error);
      return false;
    }
  },

  async markAvailabilitySet(userId: string) {
    try {
      await Promise.all([
        AsyncStorage.setItem(availabilityCompleteKey(userId), 'true'),
        AsyncStorage.removeItem(availabilityPendingKey(userId)),
        AsyncStorage.setItem(eligibleKey(userId), 'true'),
        AsyncStorage.removeItem(dismissedKey(userId)),
      ]);
    } catch (error) {
      console.warn('Failed to complete first-run availability flow:', error);
    }
  },

  async shouldShow(userId: string) {
    try {
      const [needsAvailability, isEligible, isDismissed] = await Promise.all([
        shouldSetAvailability(userId),
        AsyncStorage.getItem(eligibleKey(userId)),
        AsyncStorage.getItem(dismissedKey(userId)),
      ]);

      return !needsAvailability && isEligible === 'true' && isDismissed !== 'true';
    } catch (error) {
      console.warn('Failed to read add friends prompt state:', error);
      return false;
    }
  },

  async dismiss(userId: string) {
    try {
      await Promise.all([
        AsyncStorage.setItem(dismissedKey(userId), 'true'),
        AsyncStorage.removeItem(eligibleKey(userId)),
      ]);
    } catch (error) {
      console.warn('Failed to dismiss add friends prompt:', error);
    }
  },
};
