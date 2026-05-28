import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors } from '../theme';

type BrandLogoProps = {
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  underlineStyle?: StyleProp<ViewStyle>;
};

export default function BrandLogo({
  style,
  textStyle,
  underlineStyle,
}: BrandLogoProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.text, textStyle]}>InTown</Text>
      <View style={[styles.underline, underlineStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  text: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.brand.primary,
    letterSpacing: 0.5,
    lineHeight: 32,
  },
  underline: {
    height: 3,
    width: '100%',
    borderRadius: 2,
    marginTop: 2,
    backgroundColor: '#ffd60a',
  },
});
