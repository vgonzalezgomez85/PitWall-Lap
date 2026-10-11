// Aviso de versión nueva (solo Android): una tarjeta con el botón Actualizar, que
// descarga el APK y abre el instalador. Tres piezas:
//   • TarjetaActualizacion: la tarjeta (título, Actualizar, Más tarde).
//   • AvisoActualizacion: en el menú; comprueba al abrir la app y al volver a ella
//     si han pasado unas horas.
//   • BuscarActualizacion: en Ajustes; comprobación a mano.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';

import { debeComprobar } from '../data/actualizacion';
import { getCurrentVersion } from '../data/appVersion';
import {
  buscarActualizacion, descargarEInstalar, type Actualizacion,
} from '../data/actualizacionAndroid';
import { useIdioma } from '../i18n/IdiomaContext';
import { colors, radius, spacing } from './theme';

export function TarjetaActualizacion({ nueva, onMasTarde }: {
  nueva: Actualizacion;
  onMasTarde?: () => void;
}) {
  const { t } = useIdioma();
  const a = t.actualizacion;
  const [descargando, setDescargando] = useState(false);

  async function actualizar() {
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
        {onMasTarde && (
          <Pressable style={styles.masTarde} onPress={onMasTarde} disabled={descargando}>
            <Text style={styles.masTardeTexto}>{a.masTarde}</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.nota}>{a.permiso}</Text>
    </View>
  );
}

/** Menú: pregunta a la web al abrir la app y, al volver a ella, si pasaron más de 6 horas. */
export default function AvisoActualizacion() {
  const [nueva, setNueva] = useState<Actualizacion | null>(null);
  const [descartada, setDescartada] = useState(false);
  const ultima = useRef<number | null>(null);

  const comprobar = useCallback(async () => {
    ultima.current = Date.now();
    const a = await buscarActualizacion(getCurrentVersion());
    if (a) setNueva(a);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void comprobar();
    const sub = AppState.addEventListener('change', estado => {
      if (estado === 'active' && debeComprobar(ultima.current, Date.now())) void comprobar();
    });
    return () => sub.remove();
  }, [comprobar]);

  if (!nueva || descartada) return null;
  return <TarjetaActualizacion nueva={nueva} onMasTarde={() => setDescartada(true)} />;
}

/** Ajustes (solo Android): versión instalada y búsqueda a mano. */
export function BuscarActualizacion() {
  const { t } = useIdioma();
  const a = t.actualizacion;
  const [estado, setEstado] = useState<'reposo' | 'buscando' | 'alDia' | 'error'>('reposo');
  const [nueva, setNueva] = useState<Actualizacion | null>(null);
  const actual = getCurrentVersion();

  if (Platform.OS !== 'android') return null;

  async function buscar() {
    setEstado('buscando');
    setNueva(null);
    const r = await buscarActualizacion(actual);
    if (r) { setNueva(r); setEstado('reposo'); return; }
    // buscarActualizacion no distingue "al día" de "sin red": se comprueba la web a parte.
    try {
      const res = await fetch(`https://www.pitwall.es/software/pitwall-lap/version.json?t=${Date.now()}`);
      setEstado(res.ok ? 'alDia' : 'error');
    } catch {
      setEstado('error');
    }
  }

  return (
    <View>
      <View style={styles.filaVersion}>
        <View style={styles.filaTextos}>
          <Text style={styles.versionTitulo}>{a.versionInstalada(actual)}</Text>
          {estado === 'alDia' && <Text style={styles.estadoOk}>{a.alDia}</Text>}
          {estado === 'error' && <Text style={styles.estadoError}>{a.noSePudo}</Text>}
        </View>
        <Pressable
          style={({ pressed }) => [styles.buscar, pressed && styles.pulsado, estado === 'buscando' && styles.apagado]}
          onPress={buscar}
          disabled={estado === 'buscando'}
        >
          {estado === 'buscando'
            ? <ActivityIndicator color={colors.accent} />
            : <Text style={styles.buscarTexto}>{a.buscar}</Text>}
        </Pressable>
      </View>
      {nueva && <TarjetaActualizacion nueva={nueva} />}
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

  filaVersion: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  filaTextos: { flex: 1, minWidth: 0 },
  versionTitulo: { color: colors.text, fontSize: 16, fontWeight: '600' },
  estadoOk: { color: colors.good, fontSize: 13, marginTop: 3 },
  estadoError: { color: colors.danger, fontSize: 13, marginTop: 3 },
  buscar: {
    minHeight: 40, minWidth: 96, paddingHorizontal: spacing.md, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  buscarTexto: { color: colors.accent, fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
