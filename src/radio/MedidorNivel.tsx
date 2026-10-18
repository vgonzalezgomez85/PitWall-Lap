// Barra de nivel de audio (0..1) para calibrar la puerta de voz: muestra
// cuánto ruido llega por el micro en reposo (Fase 0, punto 3). Con `umbral`,
// dibuja la marca que hay que superar para transmitir.
//
// El nivel de WebRTC es lineal y la voz normal se queda en 0,05–0,3: la barra
// usa la raíz cuadrada para que se vea moverse (marca y nivel, en la misma
// escala).

import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../ui/theme';

const escala = (v: number) => Math.sqrt(Math.max(0, Math.min(1, v)));

export function MedidorNivel({ nivel, umbral }: { nivel: number; umbral?: number }) {
  const pct = escala(nivel);
  const marca = umbral && umbral > 0 ? escala(umbral) : null;
  const supera = marca != null && pct >= marca;
  return (
    <View style={styles.pista}>
      <View
        style={[
          styles.relleno,
          { width: `${Math.round(pct * 100)}%` },
          marca != null && !supera && styles.rellenoBajo,
        ]}
      />
      {marca != null && <View style={[styles.marca, { left: `${Math.round(marca * 100)}%` }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  pista: {
    height: 10,
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
  rellenoBajo: { backgroundColor: colors.textFaint },
  marca: {
    position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.text,
  },
});
