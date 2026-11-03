// Botón de silenciar/activar el micro en las salas de entrenos (todos tienen
// el micro abierto). Lo usan la sala y el overlay flotante (versión compacta).

import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import type { Textos } from '../i18n';
import { colors, radius, spacing } from '../ui/theme';
import type { EstadoVozRadio } from './useVozRadio';

export function BotonSilenciar({ voz, t, compacto, style }: {
  voz: EstadoVozRadio;
  t: Textos;
  compacto?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={() => voz.fijarSilenciado(!voz.silenciado)}
      style={({ pressed }) => [
        styles.boton,
        compacto && styles.compacto,
        voz.silenciado ? styles.silenciado : styles.activo,
        pressed && styles.pulsado,
        style,
      ]}
    >
      <Text style={[styles.texto, compacto && styles.textoCompacto, voz.silenciado && styles.textoSilenciado]}>
        {voz.silenciado ? t.radio.activarMicro : t.radio.silenciarMicro}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  boton: {
    paddingVertical: 18, borderRadius: radius.md, alignItems: 'center', borderWidth: 1,
  },
  compacto: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  activo: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  silenciado: { backgroundColor: colors.surfaceRaised, borderColor: colors.danger },
  pulsado: { opacity: 0.8 },
  texto: { color: colors.onAccent, fontSize: 18, fontWeight: '700' },
  textoCompacto: { fontSize: 16 },
  textoSilenciado: { color: colors.danger },
});
