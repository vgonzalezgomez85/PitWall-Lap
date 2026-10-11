// Aviso de versión nueva (solo Android): una tarjeta en el menú con el botón
// Actualizar, que descarga el APK y abre el instalador.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getCurrentVersion } from '../data/appVersion';
import {
  buscarActualizacion, descargarEInstalar, type Actualizacion,
} from '../data/actualizacionAndroid';
import { useIdioma } from '../i18n/IdiomaContext';
import { colors, radius, spacing } from './theme';

export default function AvisoActualizacion() {
  const { t } = useIdioma();
  const [nueva, setNueva] = useState<Actualizacion | null>(null);
  const [descartada, setDescartada] = useState(false);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let vivo = true;
    buscarActualizacion(getCurrentVersion()).then(a => { if (vivo) setNueva(a); });
    return () => { vivo = false; };
  }, []);

  if (!nueva || descartada) return null;
  const a = t.actualizacion;

  async function actualizar() {
    if (!nueva) return;
    setDescargando(true);
    try {
      await descargarEInstalar(nueva);
    } catch {
      Alert.alert(t.comun.error, a.errorDescarga);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <View style={styles.tarjeta}>
      <Text style={styles.titulo}>{a.titulo(nueva.version)}</Text>
      <Text style={styles.texto}>{nueva.notas ?? a.texto}</Text>
      <View style={styles.botones}>
        <Pressable
          style={({ pressed }) => [styles.actualizar, pressed && styles.pulsado, descargando && styles.apagado]}
          onPress={actualizar}
          disabled={descargando}
        >
          {descargando
            ? <View style={styles.cargando}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.actualizarTexto}>{a.descargando}</Text>
              </View>
            : <Text style={styles.actualizarTexto}>⬇ {a.actualizar}</Text>}
        </Pressable>
        <Pressable style={styles.masTarde} onPress={() => setDescartada(true)} disabled={descargando}>
          <Text style={styles.masTardeTexto}>{a.masTarde}</Text>
        </Pressable>
      </View>
      <Text style={styles.nota}>{a.permiso}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    padding: spacing.lg, borderRadius: radius.md + 4, marginBottom: spacing.lg,
    backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent,
  },
  titulo: { color: colors.text, fontSize: 16, fontWeight: '800' },
  texto: { color: colors.textSoft, fontSize: 13, marginTop: 4, lineHeight: 18 },
  botones: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  actualizar: {
    flex: 1, minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.accentFill,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
  },
  actualizarTexto: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  cargando: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulsado: { opacity: 0.8 },
  apagado: { opacity: 0.7 },
  masTarde: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  masTardeTexto: { color: colors.textMuted, fontSize: 14 },
  nota: { color: colors.textFaint, fontSize: 11, marginTop: spacing.sm, lineHeight: 15 },
});
