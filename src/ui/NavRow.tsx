// Fila de acceso a otra pantalla: título, subtítulo opcional, insignia y
// chevron. Sustituye a los botones con "→" en el texto.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from './theme';

interface Props {
  title: string;
  subtitle?: string;
  /** Contador destacado a la derecha (p. ej. avisos pendientes). */
  badge?: number;
  onPress: () => void;
}

export default function NavRow({ title, subtitle, badge, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {badge != null && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  texts: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: {
    minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: radius.pill,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.onAccent, fontSize: 13, fontWeight: '800' },
  chevron: { color: colors.textFaint, fontSize: 26, fontWeight: '300', marginTop: -2 },
});
