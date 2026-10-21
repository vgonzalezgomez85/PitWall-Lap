// Interruptor en forma de píldora (ajustes de voz).

import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius } from './theme';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
  /** No se puede usar con la fuente actual: se ve apagado y no responde. */
  disabled?: boolean;
}

export default function Chip({ label, active, onPress, disabled = false }: Props) {
  const on = active && !disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip, on ? styles.on : styles.off, disabled && styles.disabled, pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.text, on ? styles.textOn : styles.textOff]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36, paddingHorizontal: 14, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1,
  },
  on: { backgroundColor: colors.accentFill, borderColor: colors.accent },
  off: { backgroundColor: 'transparent', borderColor: colors.border },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
  text: { fontSize: 13, fontWeight: '600' },
  textOn: { color: colors.onAccent },
  textOff: { color: colors.textSoft },
});
