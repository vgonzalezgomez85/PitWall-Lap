// Pantalla "mi turno": cronometraje personal en vivo + voz.
//
// La voz se activa con `useVoice()` y se controla en vivo con los botones
// inferiores. Los toggles son persistentes (AsyncStorage).

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useDataSource } from '../data/sourceContext';
import { useVoice } from '../voice/useVoice';
import type { VoiceSettings } from '../voice/settings';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTurn'>;

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const totalCs = Math.round(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

function fmtRemaining(ms: number | null): string {
  if (ms == null) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MyTurnScreen(_props: Props) {
  void _props;
  const { state, raceInfo } = useDataSource();
  const { settings, toggle } = useVoice();

  const isSlotTime = raceInfo?.source === 'slottime';

  // ── Vista de descanso ──────────────────────────────────────────────────
  // Cuando el piloto seleccionado NO corre en la manga actual (status
  // 'resting'), renderizamos una pantalla distinta: info de su próxima
  // manga + cuándo le toca. Sin voz (la app silencia eventos cuando no
  // es turno; cuando llegue su manga, se pasa solo a 'my-turn').
  if (state.status === 'resting') {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
        <BackButton />
        <Text style={styles.kind}>{raceInfo?.source ?? '—'}</Text>
        <Text style={styles.restTitle}>Descansas esta manga</Text>
        {state.currentMangaNum != null && (
          <Text style={styles.restSub}>
            Ahora se corre la manga {state.currentMangaNum}
            {state.remainingMs != null && ` · ${fmtRemaining(state.remainingMs)} restante`}
          </Text>
        )}

        {state.nextMangaInfo ? (
          <View style={styles.block}>
            <Text style={styles.label}>Tu próxima manga</Text>
            <Text style={styles.bigTime}>{state.nextMangaInfo.mangaNum}</Text>
            <Text style={[styles.label, { marginTop: 12 }]}>Carril</Text>
            <Text style={styles.medTime}>{state.nextMangaInfo.lane}</Text>
          </View>
        ) : (
          <View style={styles.block}>
            <Text style={styles.label}>Sin próxima manga programada</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Vista "mi turno" ───────────────────────────────────────────────────
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
      <BackButton />
      <Text style={styles.kind}>{raceInfo?.source ?? '—'}</Text>
      <View style={styles.headerRow}>
        <Text style={styles.lane}>Carril {state.myLane ?? '—'}</Text>
        {state.remainingMs != null && (
          <Text style={styles.remaining}>{fmtRemaining(state.remainingMs)}</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Última vuelta</Text>
        <Text style={styles.bigTime}>{fmt(state.lastLapMs)}</Text>
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>Vuelta rápida</Text>
          <Text style={styles.medTime}>{fmt(state.bestLapMs)}</Text>
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Vueltas</Text>
          <Text style={styles.medTime}>{state.lapCount}</Text>
        </View>
      </View>

      {state.position != null && (
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Posición</Text>
            <Text style={styles.medTime}>
              {state.position} / {state.totalParticipants ?? '?'}
            </Text>
          </View>
          {state.gapAheadMs != null && (
            <View style={styles.col}>
              <Text style={styles.label}>Gap delante</Text>
              <Text style={styles.medTime}>{fmt(state.gapAheadMs)}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Voice toggles ──────────────────────────────────────────────── */}
      <Text style={styles.section}>Voz</Text>
      <View style={styles.togglesRow}>
        <ToggleChip
          label={settings.enabled ? 'Voz ON' : 'Voz OFF'}
          active={settings.enabled}
          onPress={() => toggle('enabled')}
        />
        <ToggleChip label="Vueltas"   active={settings.sayLaps} onPress={() => toggle('sayLaps')} />
        {isSlotTime && (
          <>
            <ToggleChip label="Posición"  active={settings.sayPositionChange} onPress={() => toggle('sayPositionChange')} />
            <ToggleChip label="Último min" active={settings.sayLastMinute}     onPress={() => toggle('sayLastMinute')} />
            <ToggleChip label="30 s"      active={settings.sayLast30s}        onPress={() => toggle('sayLast30s')} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function ToggleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipOn : styles.chipOff]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextOn : styles.chipTextOff]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Helper exportado por si en el futuro queremos chips de modo avanzado:
export function isAdvancedKey(k: keyof VoiceSettings): boolean {
  return k === 'sayAveragesEveryMin' || k === 'sayGapsEveryMin';
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  kind: { color: '#9aa3ad', fontSize: 12, marginTop: 12, textTransform: 'uppercase' },
  headerRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 4,
  },
  lane: { color: '#f6c90e', fontSize: 28, fontWeight: '700' },
  remaining: { color: '#cfd5dc', fontSize: 20, fontWeight: '600' },
  block: { marginTop: 24, padding: 16, backgroundColor: '#141923', borderRadius: 8 },
  label: { color: '#9aa3ad', fontSize: 12, textTransform: 'uppercase' },
  bigTime: { color: '#fff', fontSize: 64, fontWeight: '800', marginTop: 4 },
  medTime: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 4 },
  row: { flexDirection: 'row', marginTop: 12, gap: 12 },
  col: { flex: 1, padding: 16, backgroundColor: '#141923', borderRadius: 8 },
  section: {
    color: '#9aa3ad', fontSize: 12, marginTop: 28, marginBottom: 8,
    textTransform: 'uppercase',
  },
  togglesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
  },
  chipOn:  { backgroundColor: '#f6c90e', borderColor: '#f6c90e' },
  chipOff: { backgroundColor: 'transparent', borderColor: '#3a4350' },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipTextOn:  { color: '#0a0d13' },
  chipTextOff: { color: '#cfd5dc' },

  // Vista de descanso
  restTitle: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4 },
  restSub:   { color: '#9aa3ad', fontSize: 14, marginTop: 8 },
});
