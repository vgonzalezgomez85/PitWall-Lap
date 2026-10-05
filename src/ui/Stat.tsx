// Dato numérico con su etiqueta: "VUELTA RÁPIDA / 5.23". Cifras tabulares
// para que no bailen al actualizarse. `sub` es una línea pequeña debajo
// (p. ej. el nombre del rival en los gaps).

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing, type } from './theme';

interface Props {
  label: string;
  value: string;
  sub?: string | null;
  small?: boolean;
  color?: string;
  align?: 'left' | 'center';
  style?: StyleProp<ViewStyle>;
}

export default function Stat({ label, value, sub, small, color, align = 'left', style }: Props) {
  const textAlign = align;
  return (
    <View style={[styles.root, style]}>
      <Text style={[type.label, { textAlign }]} numberOfLines={1}>{label}</Text>
      <Text
        style={[small ? type.statSmall : type.stat, styles.value, { textAlign }, color != null && { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {!!sub && <Text style={[styles.sub, { textAlign }]} numberOfLines={1}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 },
  value: { marginTop: spacing.xs },
  sub: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
});
