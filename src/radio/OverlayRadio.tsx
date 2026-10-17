// Overlay flotante de Radio, montado a nivel de app (fuera del Stack). Hace dos
// cosas mientras haya una sala viva:
//   • monta `AudioRemoto` SIEMPRE, para que la voz entrante (RTCView) siga
//     sonando al navegar fuera de la sala (iOS necesita el RTCView montado);
//   • dibuja un chip «sala viva» que vuelve a la sala con un toque, y un walkie
//     pulsar-para-hablar para el asistente (el piloto sigue con micro abierto).

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIdioma } from '../i18n/IdiomaContext';
import { navigationRef } from '../navigationRef';
import { colors, radius, spacing } from '../ui/theme';
import { AudioRemoto } from './AudioRemoto';
import { useRadio } from './RadioContext';

export function OverlayRadio() {
  const { t } = useIdioma();
  const { conectado, codigo, rol, voz } = useRadio();
  const insets = useSafeAreaInsets();
  const [ruta, setRuta] = useState<string | undefined>(navigationRef.getCurrentRoute()?.name);

  // La ruta actual de forma reactiva: 'state' cubre cada cambio y 'ready' el
  // primer render (antes de que el contenedor esté listo, es undefined).
  useEffect(() => {
    const actualizar = () => setRuta(navigationRef.getCurrentRoute()?.name);
    actualizar();
    const offState = navigationRef.addListener('state', actualizar);
    const offReady = navigationRef.addListener('ready', actualizar);
    return () => {
      offState();
      offReady();
    };
  }, []);

  const enSala = ruta === 'RadioSala' || ruta === 'Radio';

  return (
    <>
      {/* Voz entrante SIEMPRE montada (con `pistas` vacío no pinta nada). */}
      <AudioRemoto pistas={voz.pistas} />

      {conectado && !enSala && (
        <View
          pointerEvents="box-none"
          style={[styles.contenedor, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <Pressable
            onPress={() => navigationRef.navigate('RadioSala')}
            style={({ pressed }) => [styles.chip, pressed && styles.presionado]}
            hitSlop={8}
          >
            <View style={styles.punto} />
            <Text style={styles.chipTexto}>{t.radio.salaViva}</Text>
            <Text style={styles.chipCodigo}>{codigo}</Text>
          </Pressable>

          {rol === 'asistente' && (
            <Pressable
              onPressIn={() => voz.fijarMicro(true)}
              onPressOut={() => voz.fijarMicro(false)}
              style={({ pressed }) => [
                styles.walkie,
                (pressed || voz.hablando) && styles.walkieActivo,
              ]}
            >
              <Text style={styles.walkieTexto}>{t.radio.hablar}</Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  presionado: { opacity: 0.8 },
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  chipTexto: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chipCodigo: {
    color: colors.accent, fontSize: 14, fontWeight: '700',
    fontVariant: ['tabular-nums'], letterSpacing: 1,
  },
  walkie: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
  },
  walkieActivo: { borderWidth: 1, borderColor: colors.accent },
  walkieTexto: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
});
