// Carreras publicadas en pitwall.es: se ven las próximas y se añaden al
// calendario de una en una o seleccionando varias. La lógica está en
// `carrerasWeb.ts`; aquí solo la descarga, la selección y el guardado.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  bandera, carreraAEvento, carrerasProximas, filtrarCarreras, idsYaAnadidas, lugarDe,
  PAGINA_CARRERAS, parsearDia, type CarreraWeb,
} from '../data/carrerasWeb';
import { descargarCarrerasWeb } from '../data/carrerasWebRemoto';
import { guardarCarreras } from '../data/calendarioImportarArchivo';
import { listEventos } from '../data/calendarioStore';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'CarrerasWeb'>;

export default function CarrerasWebScreen(_props: Props) {
  const { t, locale } = useIdioma();
  const w = t.calendarioWeb;

  const [carreras, setCarreras] = useState<CarreraWeb[] | null>(null);
  const [error, setError] = useState(false);
  const [anadidas, setAnadidas] = useState<Set<string>>(new Set());
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    setCarreras(null);
    const todas = await descargarCarrerasWeb();
    if (!todas) { setError(true); return; }
    const proximas = carrerasProximas(todas, new Date());
    setAnadidas(idsYaAnadidas(proximas, await listEventos()));
    setCarreras(proximas);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(
    () => filtrarCarreras(carreras ?? [], busqueda, c => (c.tipo ? w.tipos[c.tipo] : '')),
    [carreras, busqueda, w],
  );
  const seleccionables = visibles.filter(c => !anadidas.has(c.id));
  const todasMarcadas = seleccionables.length > 0 && seleccionables.every(c => seleccion.has(c.id));

  function alternar(id: string) {
    setSeleccion(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function alternarTodas() {
    setSeleccion(prev => {
      const s = new Set(prev);
      for (const c of seleccionables) {
        if (todasMarcadas) s.delete(c.id); else s.add(c.id);
      }
      return s;
    });
  }

  const formatoDia = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });

  async function anadir(lista: CarreraWeb[]) {
    if (lista.length === 0) return;
    setGuardando(true);
    try {
      const r = await guardarCarreras(
        lista.map(c => carreraAEvento(c, w.notas, formatoDia)),
        (a, lugar) => {
          const cuerpo = t.calendario.avisoCuerpo[a];
          return lugar ? `${cuerpo} · ${lugar}` : cuerpo;
        },
      );
      setAnadidas(prev => new Set([...prev, ...lista.map(c => c.id)]));
      setSeleccion(prev => {
        const s = new Set(prev);
        for (const c of lista) s.delete(c.id);
        return s;
      });
      Alert.alert(t.calendario.titulo, [
        w.anadidas(r.guardadas),
        ...(r.sinPermiso ? ['', t.calendario.sinPermiso] : []),
      ].join('\n'));
    } catch (e) {
      Alert.alert(t.comun.error, (e as Error)?.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  function anadirSeleccionadas() {
    const lista = (carreras ?? []).filter(c => seleccion.has(c.id) && !anadidas.has(c.id));
    if (lista.length === 0) return;
    Alert.alert(w.anadirSeleccionadas(lista.length), w.confirmarLote(lista.length), [
      { text: t.comun.cancelar, style: 'cancel' },
      { text: w.anadir, onPress: () => anadir(lista) },
    ]);
  }

  // Agrupadas por mes, como en la web.
  const meses = useMemo(() => {
    const grupos: { clave: string; titulo: string; items: CarreraWeb[] }[] = [];
    for (const c of visibles) {
      const k = c.fecha.slice(0, 7);
      let g = grupos[grupos.length - 1];
      if (!g || g.clave !== k) {
        const titulo = parsearDia(`${k}-01`)!.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
        g = { clave: k, titulo, items: [] };
        grupos.push(g);
      }
      g.items.push(c);
    }
    return grupos;
  }, [visibles, locale]);

  const fila = (c: CarreraWeb) => {
    const ya = anadidas.has(c.id);
    const marcada = seleccion.has(c.id);
    const d1 = parsearDia(c.fecha)!;
    const d2 = c.fechaFin ? parsearDia(c.fechaFin) : null;
    const lugar = lugarDe(c);
    const etiquetas = [
      c.campeonato && c.campeonato !== c.nombre ? c.campeonato : '',
      c.tipo ? w.tipos[c.tipo] : '',
      c.categoria ?? '',
      c.escala ?? '',
    ].filter(Boolean);
    return (
      <Pressable
        key={c.id}
        onPress={() => !ya && alternar(c.id)}
        disabled={ya || guardando}
        style={({ pressed }) => [styles.fila, marcada && styles.filaMarcada, ya && styles.filaYa, pressed && styles.pulsada]}
      >
        <View style={[styles.casilla, marcada && styles.casillaMarcada, ya && styles.casillaYa]}>
          {(marcada || ya) && <Text style={styles.casillaTick}>✓</Text>}
        </View>
        <View style={styles.dia}>
          <Text style={styles.diaNum}>
            {d1.getDate()}{d2 ? <Text style={styles.diaFin}>–{d2.getDate()}</Text> : null}
          </Text>
          <Text style={styles.diaSemana}>{d1.toLocaleDateString(locale, { weekday: 'short' })}</Text>
        </View>
        <View style={styles.textos}>
          <Text style={styles.nombre}>{c.nombre}</Text>
          {etiquetas.length > 0 && <Text style={styles.meta}>{etiquetas.join(' · ')}</Text>}
          {!!lugar && <Text style={styles.meta}>{bandera(c.pais)} {lugar}</Text>}
          <View style={styles.pie}>
            <Text style={[styles.origen, c.verificada && styles.origenOk]}>
              {c.verificada ? `✔ ${w.verificada}` : w.ia}
            </Text>
            {!!c.enlace && (
              <Text style={styles.enlace} onPress={() => Linking.openURL(c.enlace!)}>{w.web} ↗</Text>
            )}
          </View>
        </View>
        {ya ? (
          <Text style={styles.yaTexto}>{w.anadida}</Text>
        ) : (
          <Pressable
            onPress={() => anadir([c])}
            disabled={guardando}
            hitSlop={8}
            style={({ pressed }) => [styles.anadirUna, pressed && styles.pulsada]}
            accessibilityLabel={`${w.anadir}: ${c.nombre}`}
          >
            <Text style={styles.anadirUnaTexto}>＋</Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  const nSel = (carreras ?? []).filter(c => seleccion.has(c.id) && !anadidas.has(c.id)).length;

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.titulo}>{w.titulo}</Text>
      <Text style={styles.sub}>
        {w.subtitulo}{' '}
        <Text style={styles.enlace} onPress={() => Linking.openURL(PAGINA_CARRERAS)}>pitwall.es ↗</Text>
      </Text>

      {error ? (
        <View style={styles.centro}>
          <Text style={styles.vacio}>{w.errorCarga}</Text>
          <Pressable style={({ pressed }) => [styles.secundario, pressed && styles.pulsada]} onPress={cargar}>
            <Text style={styles.secundarioTexto}>{w.reintentar}</Text>
          </Pressable>
        </View>
      ) : carreras === null ? (
        <View style={styles.centro}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.vacio}>{t.comun.cargando}</Text>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.buscar}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder={w.buscar}
            placeholderTextColor={colors.textFaint}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {seleccionables.length > 0 && (
            <Pressable onPress={alternarTodas} style={({ pressed }) => [styles.todas, pressed && styles.pulsada]}>
              <Text style={styles.todasTexto}>
                {todasMarcadas ? w.quitarSeleccion : w.seleccionarTodas(seleccionables.length)}
              </Text>
            </Pressable>
          )}

          {visibles.length === 0 ? (
            <Text style={styles.vacio}>{carreras.length === 0 ? w.nada : w.sinResultados}</Text>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.lista}
              keyboardShouldPersistTaps="handled"
            >
              {meses.map(g => (
                <View key={g.clave}>
                  <Text style={styles.mes}>{g.titulo}</Text>
                  {g.items.map(fila)}
                </View>
              ))}
            </ScrollView>
          )}

          {nSel > 0 && (
            <Pressable
              style={({ pressed }) => [styles.lote, pressed && styles.pulsada, guardando && styles.deshabilitado]}
              onPress={anadirSeleccionadas}
              disabled={guardando}
            >
              {guardando
                ? <ActivityIndicator color={colors.onAccent} />
                : <Text style={styles.loteTexto}>＋ {w.anadirSeleccionadas(nSel)}</Text>}
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, backgroundColor: colors.bg },
  titulo: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  sub: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  centro: { alignItems: 'center', marginTop: 48, gap: spacing.md },
  vacio: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl, lineHeight: 22 },
  secundario: {
    minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  secundarioTexto: { color: colors.textSoft, fontSize: 14, fontWeight: '600' },
  buscar: {
    marginTop: spacing.lg, backgroundColor: colors.surface, color: colors.text, fontSize: 16,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm,
    borderColor: colors.border, borderWidth: 1,
  },
  todas: { alignSelf: 'flex-end', paddingVertical: spacing.sm, minHeight: 36, justifyContent: 'center' },
  todasTexto: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  lista: { paddingBottom: spacing.xl },
  mes: {
    color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.surface,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  filaMarcada: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  filaYa: { opacity: 0.55 },
  pulsada: { opacity: 0.7 },
  deshabilitado: { opacity: 0.5 },
  casilla: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  casillaMarcada: { borderColor: colors.accent, backgroundColor: colors.accentFill },
  casillaYa: { borderColor: colors.textFaint, backgroundColor: colors.surfaceRaised },
  casillaTick: { color: colors.onAccent, fontSize: 13, fontWeight: '800' },
  dia: { width: 46, alignItems: 'center' },
  diaNum: { color: colors.text, fontSize: 20, fontWeight: '700' },
  diaFin: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  diaSemana: { color: colors.textMuted, fontSize: 11, textTransform: 'uppercase' },
  textos: { flex: 1 },
  nombre: { color: colors.text, fontSize: 16, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  pie: { flexDirection: 'row', gap: spacing.md, marginTop: 5, alignItems: 'center' },
  origen: { color: colors.textFaint, fontSize: 11 },
  origenOk: { color: colors.good },
  enlace: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  anadirUna: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  anadirUnaTexto: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  yaTexto: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  lote: {
    marginTop: spacing.sm, paddingVertical: 14, borderRadius: radius.sm,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  loteTexto: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
});
