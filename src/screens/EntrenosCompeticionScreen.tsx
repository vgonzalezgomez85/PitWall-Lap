// Entrenos de competición: los que ya están descargados en el móvil (se ven sin
// conexión) y, si PitWall responde, los guardados en el servidor que aún no se
// han descargado. Tocar uno del servidor lo descarga y lo abre.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getCachedHost } from '../data/discovery';
import {
  entrenoDesdeServidor, pendientesDeDescargar, sesionesDeServidor, type SesionServidor,
} from '../data/entrenoCompeticion';
import {
  listEntrenosCompeticion, saveEntrenoCompeticion,
} from '../data/entrenoCompeticionStore';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EntrenosCompeticion'>;

const PUERTO = 3000;
const ESPERA_MS = 4000;

interface Fila {
  id: string;
  startedAt: string | null;
  heats: number;
  participantes: number;
  vueltas: number;
  mejorMs: number | null;
  enMovil: boolean;
}

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

async function pedirJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export default function EntrenosCompeticionScreen({ navigation }: Props) {
  const { t, locale } = useIdioma();
  const [locales, setLocales] = useState<Awaited<ReturnType<typeof listEntrenosCompeticion>> | null>(null);
  const [servidor, setServidor] = useState<SesionServidor[] | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [bajando, setBajando] = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    setLocales(await listEntrenosCompeticion());
    const h = await getCachedHost();
    setHost(h);
    if (!h) { setServidor(null); return; }
    try {
      setServidor(sesionesDeServidor(await pedirJson(`http://${h}:${PUERTO}/api/mobile/competition-trainings`)));
    } catch {
      setServidor(null);   // sin servidor: solo lo descargado
    }
  }, []);

  useFocusEffect(useCallback(() => { void cargar(); }, [cargar]));

  async function descargar(id: string): Promise<boolean> {
    if (!host) return false;
    setBajando(prev => new Set(prev).add(id));
    try {
      const raw = await pedirJson(`http://${host}:${PUERTO}/api/mobile/competition-trainings/${encodeURIComponent(id)}`);
      const entreno = entrenoDesdeServidor(raw, new Date());
      if (!entreno) throw new Error('formato');
      await saveEntrenoCompeticion(entreno);
      setLocales(await listEntrenosCompeticion());
      return true;
    } catch {
      Alert.alert(t.comun.error, t.entrenoComp.errorDescarga);
      return false;
    } finally {
      setBajando(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }

  async function abrir(fila: Fila) {
    if (!fila.enMovil && !(await descargar(fila.id))) return;
    navigation.push('EntrenoCompeticion', { id: fila.id });
  }

  async function descargarTodos(pendientes: SesionServidor[]) {
    for (const s of pendientes) await descargar(s.id);
  }

  // Unión de lo descargado y lo que solo está en el servidor, la más reciente primero.
  const filas: Fila[] = (locales ?? []).map(m => ({
    id: m.id, startedAt: m.startedAt, heats: m.heats, participantes: m.participantes,
    vueltas: m.vueltas, mejorMs: m.mejorMs, enMovil: true,
  }));
  const pendientes = pendientesDeDescargar(servidor ?? [], filas.map(f => f.id));
  for (const s of pendientes) {
    filas.push({
      id: s.id, startedAt: s.startedAt, heats: s.heats, participantes: s.participants,
      vueltas: s.laps, mejorMs: s.bestLapMs, enMovil: false,
    });
  }
  filas.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));

  const ocupado = bajando.size > 0;

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.titulo}>{t.entrenoComp.titulo}</Text>

      {pendientes.length > 1 && (
        <Pressable
          style={[styles.todos, ocupado && styles.deshabilitado]}
          disabled={ocupado}
          onPress={() => descargarTodos(pendientes)}
        >
          <Text style={styles.todosTexto}>
            ⬇ {t.entrenoComp.descargarTodos} ({pendientes.length})
          </Text>
        </Pressable>
      )}

      {locales === null ? (
        <Text style={styles.vacio}>{t.comun.cargando}</Text>
      ) : (
        <FlatList
          data={filas}
          keyExtractor={f => f.id}
          contentContainerStyle={styles.lista}
          ListEmptyComponent={<Text style={styles.vacio}>{t.entrenoComp.vacio}</Text>}
          ListFooterComponent={servidor === null
            ? <Text style={styles.aviso}>{t.entrenoComp.sinServidor}</Text>
            : null}
          renderItem={({ item }) => {
            const fecha = item.startedAt
              ? new Date(item.startedAt).toLocaleString(locale, {
                  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })
              : '';
            const bajandoEste = bajando.has(item.id);
            return (
              <Pressable
                style={({ pressed }) => [styles.fila, pressed && styles.pulsada]}
                disabled={bajandoEste}
                onPress={() => abrir(item)}
              >
                <View style={styles.filaTextos}>
                  <Text style={styles.filaNombre}>{fecha || item.id}</Text>
                  <Text style={styles.filaMeta}>
                    {t.entrenoComp.meta(item.heats, item.participantes, item.vueltas)}
                    {item.mejorMs != null ? ` · ${t.comun.mejor(fmt(item.mejorMs))}` : ''}
                  </Text>
                </View>
                {bajandoEste ? (
                  <ActivityIndicator color={colors.accent} />
                ) : item.enMovil ? (
                  <Text style={styles.enMovil}>✓ {t.entrenoComp.enElMovil}</Text>
                ) : (
                  <Text style={styles.descargar}>⬇ {t.entrenoComp.descargar}</Text>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, backgroundColor: colors.bg },
  titulo: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  todos: {
    marginTop: spacing.lg, paddingVertical: 14, borderRadius: radius.sm,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  todosTexto: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  deshabilitado: { opacity: 0.5 },
  lista: { paddingVertical: spacing.lg },
  vacio: {
    color: colors.textMuted, fontSize: 14, textAlign: 'center',
    marginTop: 48, lineHeight: 22,
  },
  aviso: {
    color: colors.textFaint, fontSize: 12, textAlign: 'center',
    marginTop: spacing.xl, lineHeight: 18,
  },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  pulsada: { opacity: 0.7 },
  filaTextos: { flex: 1 },
  filaNombre: { color: colors.text, fontSize: 17, fontWeight: '600' },
  filaMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  enMovil: { color: colors.good, fontSize: 12, fontWeight: '600' },
  descargar: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
