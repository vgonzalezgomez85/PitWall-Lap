// Calendario de carreras: las próximas (con aviso) y las pasadas. Alta y
// edición en `EventoScreen`.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { separarEventos, type Evento } from '../data/calendario';
import {
  compartirPlantilla, elegirYPreparar, guardarCarreras,
} from '../data/calendarioImportarArchivo';
import type { MotivoError } from '../data/calendarioImport';
import { listEventos } from '../data/calendarioStore';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import Section from '../ui/Section';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Calendario'>;

export default function CalendarioScreen({ navigation }: Props) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const { t, locale } = useIdioma();

  useFocusEffect(
    useCallback(() => {
      let cancelado = false;
      listEventos().then(l => { if (!cancelado) setEventos(l); });
      return () => { cancelado = true; };
    }, []),
  );

  const [importando, setImportando] = useState(false);
  const imp = t.calendarioImp;

  const recargar = useCallback(async () => setEventos(await listEventos()), []);

  async function bajarPlantilla() {
    try {
      const r = await compartirPlantilla(
        {
          columnas: imp.columnas,
          hojaCarreras: imp.hojaCarreras,
          hojaAyuda: imp.hojaAyuda,
          ayuda: imp.ayuda,
          ejemplos: imp.ejemplos,
        },
        imp.plantilla,
      );
      if (r === 'sinCompartir') {
        Alert.alert(t.historial.compartirNoDisp, t.historial.compartirNoDispTexto);
      }
    } catch (e) {
      Alert.alert(t.comun.error, (e as Error)?.message ?? String(e));
    }
  }

  const motivo = (m: MotivoError) => ({
    faltaNombre: imp.errorFaltaNombre,
    fechaInvalida: imp.errorFecha,
    horaInvalida: imp.errorHora,
  }[m]);

  async function importar() {
    setImportando(true);
    try {
      const prep = await elegirYPreparar();
      if (!prep) return;                       // canceló el selector
      if (!prep.ok) {
        Alert.alert(t.comun.error, prep.motivo === 'sinFilas' ? imp.sinFilas : imp.sinCabecera);
        return;
      }
      const { nuevas, repetidas, errores } = prep;

      // Vista previa: qué se va a importar y qué no, antes de tocar nada.
      const fecha = (d: Date) => d.toLocaleString(locale, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const lineas: string[] = [];
      if (nuevas.length > 0) {
        lineas.push(imp.aImportar(nuevas.length));
        for (const c of nuevas.slice(0, 8)) lineas.push(`• ${fecha(c.inicio)} · ${c.nombre}`);
        if (nuevas.length > 8) lineas.push('…');
      }
      if (repetidas > 0) lineas.push('', imp.yaEstaban(repetidas));
      if (errores.length > 0) {
        lineas.push('', imp.conErrores(errores.length));
        for (const e of errores.slice(0, 5)) lineas.push(`• ${imp.fila(e.fila)}: ${motivo(e.motivo)}`);
        if (errores.length > 5) lineas.push('…');
      }
      if (nuevas.some(c => c.avisosIgnorados.length > 0)) lineas.push('', imp.avisosIgnorados);

      if (nuevas.length === 0) {
        Alert.alert(t.calendario.titulo, [imp.nada, ...lineas.length ? ['', ...lineas] : []].join('\n'));
        return;
      }
      Alert.alert(imp.importar, lineas.join('\n'), [
        { text: t.comun.cancelar, style: 'cancel' },
        {
          text: imp.confirmar(nuevas.length),
          onPress: async () => {
            setImportando(true);
            try {
              const r = await guardarCarreras(nuevas, (a, lugar) => {
                const cuerpo = t.calendario.avisoCuerpo[a];
                return lugar ? `${cuerpo} · ${lugar}` : cuerpo;
              });
              await recargar();
              Alert.alert(t.calendario.titulo, [
                imp.importadas(r.guardadas),
                ...(r.sinPermiso ? ['', t.calendario.sinPermiso] : []),
              ].join('\n'));
            } finally {
              setImportando(false);
            }
          },
        },
      ]);
    } catch {
      Alert.alert(t.comun.error, imp.errorLeer);
    } finally {
      setImportando(false);
    }
  }

  const { proximos, pasados } = separarEventos(eventos ?? [], new Date());

  const fila = (e: Evento, pasado: boolean) => {
    const d = new Date(e.inicio);
    const fecha = d.toLocaleString(locale, {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return (
      <Pressable
        key={e.id}
        onPress={() => navigation.push('Evento', { id: e.id })}
        style={({ pressed }) => [styles.fila, pasado && styles.filaPasada, pressed && styles.pulsada]}
      >
        <View style={styles.filaTextos}>
          <Text style={styles.filaNombre}>{e.nombre}</Text>
          <Text style={styles.filaMeta}>{fecha}</Text>
          {!!e.lugar && <Text style={styles.filaMeta}>📍 {e.lugar}</Text>}
        </View>
        {!pasado && e.notificaciones.length > 0 && <Text style={styles.campana}>🔔</Text>}
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.titulo}>{t.calendario.titulo}</Text>

      <Pressable
        style={({ pressed }) => [styles.anadir, pressed && styles.pulsada]}
        onPress={() => navigation.push('Evento')}
      >
        <Text style={styles.anadirTexto}>＋ {t.calendario.anadir}</Text>
      </Pressable>

      <View style={styles.excel}>
        <Pressable
          style={({ pressed }) => [styles.excelBtn, pressed && styles.pulsada, importando && styles.deshabilitado]}
          onPress={importar}
          disabled={importando}
        >
          {importando
            ? <ActivityIndicator color={colors.accent} />
            : <Text style={styles.excelTexto}>📥 {imp.importar}</Text>}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.excelBtn, pressed && styles.pulsada]}
          onPress={bajarPlantilla}
        >
          <Text style={styles.excelTexto}>📄 {imp.plantilla}</Text>
        </Pressable>
      </View>

      {eventos === null ? (
        <Text style={styles.vacio}>{t.comun.cargando}</Text>
      ) : eventos.length === 0 ? (
        <Text style={styles.vacio}>{t.calendario.vacio}</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.lista}>
          {proximos.length > 0 && (
            <Section title={t.calendario.proximas}>{proximos.map(e => fila(e, false))}</Section>
          )}
          {pasados.length > 0 && (
            <Section title={t.calendario.pasadas}>{pasados.map(e => fila(e, true))}</Section>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, backgroundColor: colors.bg },
  titulo: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  anadir: {
    marginTop: spacing.lg, paddingVertical: 14, borderRadius: radius.sm,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  anadirTexto: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  pulsada: { opacity: 0.7 },
  deshabilitado: { opacity: 0.5 },
  // Importar y plantilla: secundarios, bajo el botón principal de añadir a mano.
  excel: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  excelBtn: {
    flex: 1, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  excelTexto: { color: colors.textSoft, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  vacio: {
    color: colors.textMuted, fontSize: 14, textAlign: 'center',
    marginTop: 48, lineHeight: 22,
  },
  lista: { paddingVertical: spacing.lg, gap: spacing.sm },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  filaPasada: { opacity: 0.55 },
  filaTextos: { flex: 1 },
  filaNombre: { color: colors.text, fontSize: 17, fontWeight: '600' },
  filaMeta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  campana: { fontSize: 16 },
});
