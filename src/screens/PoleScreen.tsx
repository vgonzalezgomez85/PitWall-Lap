// Pantalla de sesión de Pole Position (sólo PitWall).
//
// Tres fases en una:
//   • PICKER: elige tu entrada de la lista (orden de salida).
//   • LIVE:   muestra quién está en pista, gap a la pole y, cuando te toca
//             a ti, tus tiempos en grande.
//   • DONE:   sesión terminada, muestra la clasificación final.
//
// La fuente (PitWallSource modo 'pole') hace polling de /pole cada 1s y
// emite estado + evento lap-completed cuando completas una vuelta.

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { PitWallSource } from '../data/PitWallSource';
import { useDataSource } from '../data/sourceContext';
import { useVoice } from '../voice/useVoice';
import BackButton from '../ui/BackButton';
import type { PoleEntry, PoleSnapshot } from '../data/types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Pole'>;

function fmtLap(ms: number | null): string {
  if (ms == null) return '—';
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

function fmtRemaining(ms: number | null): string {
  if (ms == null) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PoleScreen({ route, navigation }: Props) {
  const { host, port, raceId } = route.params;
  const { source, state, setSource } = useDataSource();
  // Hook de voz: solo es importante que se monte para que se enganche
  // a los eventos lap-completed / manga-changed / race-finished.
  useVoice();

  const [connecting, setConnecting] = useState(true);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Solo intentamos conectar una vez al montar. Si lo incluimos en deps
  // del state.pole entramos en bucle (re-render antes de que el state
  // propague crea otra fuente, etc.).
  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const src = new PitWallSource({ host, port }, { mode: 'pole', raceId });
        const info = await src.connect();
        if (cancelled) { src.disconnect(); return; }
        setSource(src, info);
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message ?? String(e));
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [host, port, raceId, setSource]);

  function pickEntry(entryId: number) {
    setSelectedEntryId(entryId);
    source?.selectParticipant(String(entryId));
  }

  if (error) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errTitle}>Error</Text>
          <Text style={styles.errBody}>{error}</Text>
        </View>
      </View>
    );
  }

  const pole = state.pole;

  // Si la pole ya está terminada, no tiene sentido quedarse aquí: el
  // siguiente paso es la primera tanda. Redirigimos al picker de tandas.
  useEffect(() => {
    if (pole?.status === 'done') {
      source?.disconnect();
      navigation.replace('TandaPicker', { host, port, raceId });
    }
  }, [pole?.status, navigation, host, port, raceId, source]);

  if (connecting || !pole) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#f6c90e" />
          <Text style={styles.loading}>Cargando pole…</Text>
        </View>
      </View>
    );
  }

  // ── DONE: pole terminada → clasificación final ─────────────────────────
  if (pole.status === 'done') {
    return (
      <View style={styles.root}>
        <BackButton />
        <Text style={styles.title}>Pole Position</Text>
        <Text style={styles.subtitle}>Sesión terminada</Text>
        <FlatList
          data={pole.standings}
          keyExtractor={s => String(s.entryId)}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => (
            <View style={styles.standingRow}>
              <Text style={styles.standingPos}>{item.pos}</Text>
              <Text style={styles.standingName}>{item.name}</Text>
              <Text style={styles.standingTime}>{fmtLap(item.lapTimeMs)}</Text>
            </View>
          )}
        />
      </View>
    );
  }

  // ── PICKER: el usuario aún no se ha elegido ────────────────────────────
  if (selectedEntryId == null) {
    return (
      <View style={styles.root}>
        <BackButton />
        <Text style={styles.title}>Pole Position</Text>
        <Text style={styles.subtitle}>
          Carril {pole.poleLane ?? '—'} · elige tu salida
        </Text>
        <FlatList
          data={pole.startingOrder}
          keyExtractor={e => String(e.entryId)}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => (
            <PickerRow entry={item} onPick={() => pickEntry(item.entryId)} />
          )}
        />
      </View>
    );
  }

  // ── LIVE: ya hay piloto elegido ───────────────────────────────────────
  const isMyTurn = pole.currentEntry?.entryId === selectedEntryId;
  const myEntry = pole.startingOrder.find(e => e.entryId === selectedEntryId);
  const myStanding = pole.standings.find(s => s.entryId === selectedEntryId);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
      <BackButton />
      <Text style={styles.kind}>POLE · CARRIL {pole.poleLane ?? '—'}</Text>

      {isMyTurn ? (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.lane}>Tu turno</Text>
            <Text style={styles.remaining}>{fmtRemaining(pole.live?.remainingMs ?? null)}</Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>Tiempo actual de vuelta</Text>
            <Text style={styles.bigTime}>{fmtLap(pole.live?.currentLapMs ?? null)}</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Mejor</Text>
              <Text style={styles.medTime}>{fmtLap(pole.live?.bestLapMs ?? null)}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Vueltas</Text>
              <Text style={styles.medTime}>{pole.live?.lapCount ?? 0}</Text>
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={styles.block}>
            <Text style={styles.label}>En pista ahora</Text>
            <Text style={styles.bigName}>
              {pole.currentEntry?.name ?? '—'}
            </Text>
            <Text style={styles.muted}>
              {pole.currentEntry
                ? `Salida P${pole.currentEntry.startPos}`
                : 'Esperando GO'}
            </Text>
            {pole.live && (
              <Text style={styles.muted}>
                {fmtRemaining(pole.live.remainingMs)} restantes · mejor {fmtLap(pole.live.bestLapMs)}
              </Text>
            )}
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>Eres</Text>
            <Text style={styles.bigName}>{myEntry?.name ?? '—'}</Text>
            <Text style={styles.muted}>
              Salida P{myEntry?.pos ?? '—'}
              {myEntry?.done && ` · ${fmtLap(myEntry.lapTimeMs)}`}
            </Text>
            {myStanding && (
              <Text style={styles.muted}>Posición {myStanding.pos} / {pole.totalCount}</Text>
            )}
          </View>
        </>
      )}

      {/* Clasificación parcial */}
      {pole.standings.length > 0 && (
        <>
          <Text style={styles.section}>Clasificación</Text>
          {pole.standings.map(s => (
            <View
              key={s.entryId}
              style={[
                styles.standingRow,
                s.entryId === selectedEntryId && styles.standingRowMe,
              ]}
            >
              <Text style={styles.standingPos}>{s.pos}</Text>
              <Text style={styles.standingName}>{s.name}</Text>
              <Text style={styles.standingTime}>{fmtLap(s.lapTimeMs)}</Text>
            </View>
          ))}
        </>
      )}

      {/* Cambiar de piloto */}
      <TouchableOpacity
        style={styles.changeBtn}
        onPress={() => setSelectedEntryId(null)}
      >
        <Text style={styles.changeBtnText}>Cambiar de piloto</Text>
      </TouchableOpacity>
      {/* Suprime warning de variable */}
      <Text style={{ display: 'none' }}>{String(navigation.canGoBack())}</Text>
    </ScrollView>
  );
}

function PickerRow({ entry, onPick }: { entry: PoleEntry; onPick: () => void }) {
  return (
    <TouchableOpacity style={styles.pickerRow} onPress={onPick}>
      <Text style={styles.pickerPos}>P{entry.pos}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.pickerName}>{entry.name}</Text>
        {entry.done && (
          <Text style={styles.muted}>{fmtLap(entry.lapTimeMs)}</Text>
        )}
      </View>
      {entry.done && <Text style={styles.doneTag}>✓</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#9aa3ad', fontSize: 14, marginTop: 6 },
  loading: { color: '#cfd5dc', fontSize: 14, marginTop: 12 },
  errTitle: { color: '#ff6b6b', fontSize: 20, fontWeight: '600' },
  errBody: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', marginTop: 12 },

  kind: { color: '#9aa3ad', fontSize: 12, marginTop: 12, textTransform: 'uppercase' },
  headerRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 4,
  },
  lane: { color: '#f6c90e', fontSize: 28, fontWeight: '700' },
  remaining: { color: '#cfd5dc', fontSize: 20, fontWeight: '600' },
  block: { marginTop: 16, padding: 16, backgroundColor: '#141923', borderRadius: 8 },
  label: { color: '#9aa3ad', fontSize: 12, textTransform: 'uppercase' },
  bigTime: { color: '#fff', fontSize: 56, fontWeight: '800', marginTop: 4 },
  bigName: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 4 },
  medTime: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 4 },
  muted: { color: '#9aa3ad', fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', marginTop: 12, gap: 12 },
  col: { flex: 1, padding: 16, backgroundColor: '#141923', borderRadius: 8 },

  section: {
    color: '#9aa3ad', fontSize: 12, marginTop: 24, marginBottom: 8,
    textTransform: 'uppercase',
  },
  standingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#141923', paddingVertical: 12, paddingHorizontal: 14,
    marginVertical: 3, borderRadius: 8,
  },
  standingRowMe: { borderWidth: 1, borderColor: '#f6c90e' },
  standingPos: { color: '#f6c90e', fontSize: 18, fontWeight: '800', width: 28 },
  standingName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  standingTime: { color: '#cfd5dc', fontSize: 16, fontWeight: '600' },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 5, borderRadius: 8,
  },
  pickerPos: {
    color: '#f6c90e', fontSize: 22, fontWeight: '800',
    backgroundColor: '#1f1804', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6,
  },
  pickerName: { color: '#fff', fontSize: 17, fontWeight: '600' },
  doneTag: { color: '#5fd167', fontSize: 18, fontWeight: '800' },

  changeBtn: {
    marginTop: 20, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#3a4350', alignItems: 'center',
  },
  changeBtnText: { color: '#cfd5dc', fontSize: 14, fontWeight: '600' },
});
