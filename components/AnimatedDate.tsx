import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';

interface AnimatedDateProps {
  date: string;
  day: number;
  isMarked: boolean;
  backgroundColor: string;
  onPress: () => void;
  isHovered?: boolean;
}

export default function AnimatedDate({
  date,
  day,
  isMarked,
  backgroundColor,
  onPress,
  isHovered = false,
}: AnimatedDateProps) {
  const [scaleAnim] = useState(new Animated.Value(1));
  const [opacityAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    if (isHovered) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1.15,
          useNativeDriver: true,
          tension: 300,
          friction: 10,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.9,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 300,
          friction: 10,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isHovered, scaleAnim, opacityAnim]);

  const animatedStyle = {
    transform: [{ scale: scaleAnim }],
    opacity: opacityAnim,
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.touchable}
    >
      <Animated.View
        style={[
          styles.container,
          { backgroundColor },
          animatedStyle,
          isHovered && styles.hovered,
        ]}
      >
        <Text style={styles.text}>{day}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  hovered: {
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  text: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});

