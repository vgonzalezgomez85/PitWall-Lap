// Barra de nivel de audio (0..1) para calibrar la puerta de voz: muestra
// cuánto ruido llega por el micro en reposo (Fase 0, punto 3).

import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../ui/theme';

export function MedidorNivel({ nivel }: { nivel: number }) {
  const pct = Math.max(0, Math.min(1, nivel));
  return (
    <View style={styles.pista}>
      <View style={[styles.relleno, { width: `${Math.round(pct * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pista: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.borderSoft,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  relleno: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.good,
  },
});
