// Contenedor con fondo de superficie. `highlight` lo bordea con el acento
// (p. ej. la tarjeta propia frente a las de los rivales).

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from './theme';

interface Props {
  children: ReactNode;
  highlight?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function Card({ children, highlight, style }: Props) {
  return <View style={[styles.card, highlight && styles.highlight, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  highlight: { borderColor: colors.accent },
});
