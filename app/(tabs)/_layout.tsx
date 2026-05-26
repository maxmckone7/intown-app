import { Slot } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import Header from '../../components/Header';
import { colors } from '../../theme';

export default function TabsLayout() {
  return (
    <View style={styles.root}>
      <Header />
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    flex: 1,
  },
});
