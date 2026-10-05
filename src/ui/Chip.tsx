// Interruptor en forma de píldora (ajustes de voz).

import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius } from './theme';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

export default function Chip({ label, active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.chip, active ? styles.on : styles.off, pressed && styles.pressed]}
    >
      <Text style={[styles.text, active ? styles.textOn : styles.textOff]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36, paddingHorizontal: 14, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1,
  },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  off: { backgroundColor: 'transparent', borderColor: colors.border },
  pressed: { opacity: 0.65 },
  text: { fontSize: 13, fontWeight: '600' },
  textOn: { color: colors.onAccent },
  textOff: { color: colors.textSoft },
});
