// Botón estándar de la app. Variantes:
//   • primary — relleno de acento (acción principal de la pantalla)
//   • outline — borde de acento (accesos secundarios: Estrategia, Seguimiento…)
//   • ghost   — borde gris (cancelar, alternativas)
//   • danger  — texto rojo sin fondo (acciones destructivas)

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from './theme';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Contenido a la derecha del texto (insignia, contador…). */
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function Button({
  label, onPress, variant = 'primary', disabled, trailing, style,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base, styles[variant], style,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.text, textStyles[variant]]}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48, paddingHorizontal: 16, borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primary: { backgroundColor: colors.accent },
  outline: { borderWidth: 1, borderColor: colors.accent },
  ghost: { borderWidth: 1, borderColor: colors.border },
  danger: {},
  pressed: { opacity: 0.65, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
  text: { fontSize: 16, fontWeight: '700' },
});

const textStyles = StyleSheet.create({
  primary: { color: colors.onAccent },
  outline: { color: colors.accent },
  ghost: { color: colors.textSoft, fontWeight: '600' },
  danger: { color: colors.danger, fontWeight: '600' },
});
