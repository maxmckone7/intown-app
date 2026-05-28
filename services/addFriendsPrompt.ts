import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'intown:add-friends-prompt';

const eligibleKey = (userId: string) => `${STORAGE_PREFIX}:eligible:${userId}`;
const dismissedKey = (userId: string) => `${STORAGE_PREFIX}:dismissed:${userId}`;

export const addFriendsPromptService = {
  async markEligible(userId: string) {
    try {
      await AsyncStorage.setItem(eligibleKey(userId), 'true');
    } catch (error) {
      console.warn('Failed to mark add friends prompt eligible:', error);
    }
  },

  async shouldShow(userId: string) {
    try {
      const [isEligible, isDismissed] = await Promise.all([
        AsyncStorage.getItem(eligibleKey(userId)),
        AsyncStorage.getItem(dismissedKey(userId)),
      ]);

      return isEligible === 'true' && isDismissed !== 'true';
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
