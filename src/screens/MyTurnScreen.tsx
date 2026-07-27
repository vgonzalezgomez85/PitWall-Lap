// Pantalla "mi turno": cronometraje personal en vivo + voz.
//
// La voz se activa con `useVoice()` y se controla en vivo con los botones
// inferiores. Los toggles son persistentes (AsyncStorage).

import { useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import { useDataSource } from '../data/sourceContext';
import { useStintRecorder } from '../data/useStintRecorder';
import { saveStint, type StintSetup } from '../data/trainingStore';
import { useVoice } from '../voice/useVoice';
import { useTireStrategy } from '../strategy/useTireStrategy';
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

// Gap en vueltas para mostrar en pantalla. 0 = mismo número de vueltas.
function fmtGapLaps(laps: number | null): string {
  if (laps == null) return '—';
  if (laps === 0) return 'A la par';
  return `${laps} ${laps === 1 ? 'vuelta' : 'vueltas'}`;
}

// Etiqueta visible de la fuente (el id interno sigue siendo 'slottime'/'infolap').
function sourceLabel(source: string | undefined): string {
  if (source === 'slottime') return 'PitWall Lap';
  if (source === 'infolap') return 'TicTac';
  return '—';
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
  const { state, raceInfo, source } = useDataSource();
  const { pendingCount } = useTireStrategy();
  const { settings, toggle, update } = useVoice();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const isSlotTime = raceInfo?.source === 'slottime';
  const isTraining = raceInfo?.mode === 'training';

  // Grabación de stints (solo modo entrenamiento).
  const recorder = useStintRecorder();
  const [pending, setPending] = useState<number[] | null>(null);
  const [setup, setSetup] = useState<StintSetup>({});

  const recLaps = recorder.laps;
  const recBest = recLaps.length ? Math.min(...recLaps) : null;
  const recAvg = recLaps.length
    ? Math.round(recLaps.reduce((a, b) => a + b, 0) / recLaps.length)
    : null;

  function onStop() {
    const laps = recorder.stop();
    if (laps.length === 0) {
      Alert.alert('Stint vacío', 'No se registró ninguna vuelta. Nada que guardar.');
      return;
    }
    setSetup({});
    setPending(laps);
  }

  async function confirmSave() {
    if (!pending) return;
    const n = pending.length;
    await saveStint(pending, state.myLane ?? null, setup);
    setPending(null);
    Alert.alert('Stint guardado', `${n} ${n === 1 ? 'vuelta' : 'vueltas'} guardadas.`, [
      { text: 'Ver entrenamientos', onPress: () => navigation.push('Training') },
      { text: 'OK', style: 'cancel' },
    ]);
  }

  // ── Vista de descanso ──────────────────────────────────────────────────
  // Cuando el piloto seleccionado NO corre en la manga actual (status
  // 'resting'), renderizamos una pantalla distinta: info de su próxima
  // manga + cuándo le toca. Sin voz (la app silencia eventos cuando no
  // es turno; cuando llegue su manga, se pasa solo a 'my-turn').
  // ── Vista de espera: PRE-CARRERA (aún no empieza) o DESCANSO (no corres la
  // manga en curso). En ambos casos mostramos el horario y, sobre todo, dejamos
  // configurar la app (voz + estrategia) mientras esperas tu turno.
  if (state.status === 'resting' || state.status === 'pre-race') {
    const isPre = state.status === 'pre-race';
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
        <BackButton />
        <Text style={styles.kind}>{sourceLabel(raceInfo?.source)}</Text>
        {state.selfName && <Text style={styles.selfName}>{state.selfName}</Text>}

        {state.isFinal ? (
          <>
            <Text style={[styles.restTitle, styles.finalTitle]}>FINAL</Text>
            <Text style={styles.restSub}>
              Ya has corrido todas tus mangas. Carrera completada para ti.
            </Text>
          </>
        ) : isPre ? (
          <>
            <Text style={styles.restTitle}>La carrera aún no ha empezado</Text>
            {state.nextMangaInfo ? (
              <View style={styles.block}>
                <Text style={styles.label}>Tu primera manga</Text>
                <Text style={styles.bigTime}>{state.nextMangaInfo.mangaNum}</Text>
                <Text style={[styles.label, { marginTop: 12 }]}>Carril</Text>
                <Text style={styles.medTime}>{state.nextMangaInfo.lane}</Text>
              </View>
            ) : (
              <View style={styles.block}>
                <Text style={styles.label}>Descansas toda la carrera (sin mangas asignadas)</Text>
              </View>
            )}
          </>
        ) : (
          <>
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
          </>
        )}

        {/* Config disponible mientras esperas (solo carreras PitWall). */}
        {isSlotTime && !isTraining && (
          <>
            <StrategyButton navigation={navigation} pendingCount={pendingCount} />
            <VoiceControls settings={settings} toggle={toggle} update={update} isSlotTime={isSlotTime} />
          </>
        )}
      </ScrollView>
    );
  }

  // ── Vista "mi turno" ───────────────────────────────────────────────────
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
      <BackButton />
      <Text style={styles.kind}>{raceInfo?.source ?? '—'}</Text>
      {state.selfName && <Text style={styles.selfName}>{state.selfName}</Text>}
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
          <Text style={styles.label}>Media carril</Text>
          <Text style={styles.medTime}>{fmt(state.avgLapMs)}</Text>
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Vueltas</Text>
          <Text style={styles.medTime}>{state.lapCount}</Text>
        </View>
      </View>

      {isSlotTime && (
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Salidas</Text>
            <Text style={styles.medTime}>{state.exitCount}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Pit stops</Text>
            <Text style={styles.medTime}>{state.pitStopCount}</Text>
          </View>
        </View>
      )}

      {state.position != null && (
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Posición</Text>
            <Text style={styles.medTime}>
              {state.position} / {state.totalParticipants ?? '?'}
            </Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Gap delante</Text>
            <Text style={styles.medTime}>{fmtGapLaps(state.gapAheadLaps)}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Gap detrás</Text>
            <Text style={styles.medTime}>{fmtGapLaps(state.gapBehindLaps)}</Text>
          </View>
        </View>
      )}

      {isSlotTime && state.position != null && (
        <View style={styles.block}>
          <Text style={styles.label}>Media para subir</Text>
          <Text style={styles.medTime}>{fmt(state.avgToCatchMs)}</Text>
        </View>
      )}

      {isSlotTime && !isTraining && (
        <StrategyButton navigation={navigation} pendingCount={pendingCount} />
      )}

      {/* ── Entreno GO (solo modo entrenamiento) ───────────────────────── */}
      {isTraining && (
        <>
          <Text style={styles.section}>Registro de entrenamiento</Text>
          <Pressable
            onPress={() => (recorder.recording ? onStop() : recorder.start())}
            style={[styles.goBtn, recorder.recording ? styles.goBtnStop : styles.goBtnStart]}
          >
            <Text style={styles.goBtnText}>
              {recorder.recording ? '■  Detener y guardar' : '▶  Entreno GO'}
            </Text>
          </Pressable>
          {recorder.recording && (
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Vueltas</Text>
                <Text style={styles.medTime}>{recLaps.length}</Text>
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Mejor</Text>
                <Text style={styles.medTime}>{fmt(recBest)}</Text>
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Media</Text>
                <Text style={styles.medTime}>{fmt(recAvg)}</Text>
              </View>
            </View>
          )}
          <Pressable style={styles.linkBtn} onPress={() => navigation.push('Training')}>
            <Text style={styles.linkBtnText}>Ver mis entrenamientos</Text>
          </Pressable>
        </>
      )}

      {/* ── Voice toggles ──────────────────────────────────────────────── */}
      <VoiceControls settings={settings} toggle={toggle} update={update} isSlotTime={isSlotTime} />

      {/* ── Modal: datos del stint al detener ──────────────────────────── */}
      <Modal
        visible={pending != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPending(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Guardar stint</Text>
            <Text style={styles.modalSub}>
              {pending?.length ?? 0} vueltas · datos del coche (opcionales)
            </Text>
            <SetupField
              label="Modelo de coche"
              value={setup.carModel}
              onChange={v => setSetup(s => ({ ...s, carModel: v }))}
            />
            <SetupField
              label="Motor"
              value={setup.motor}
              onChange={v => setSetup(s => ({ ...s, motor: v }))}
            />
            <SetupField
              label="Neumático"
              value={setup.tire}
              onChange={v => setSetup(s => ({ ...s, tire: v }))}
            />
            <SetupField
              label="Medida de llanta"
              value={setup.rim}
              onChange={v => setSetup(s => ({ ...s, rim: v }))}
            />
            <SetupField
              label="Corona"
              value={setup.crown}
              onChange={v => setSetup(s => ({ ...s, crown: v }))}
            />
            <SetupField
              label="Piñón"
              value={setup.pinion}
              onChange={v => setSetup(s => ({ ...s, pinion: v }))}
            />
            <View style={styles.modalBtns}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setPending(null)}
              >
                <Text style={styles.modalBtnGhostText}>Descartar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={confirmSave}
              >
                <Text style={styles.modalBtnPrimaryText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

function SetupField({
  label, value, onChange,
}: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value ?? ''}
        onChangeText={onChange}
        placeholder="—"
        placeholderTextColor="#4a525e"
      />
    </View>
  );
}

// Cicla por 0 (off) → 1 → 2 → 3 → 5 → 0 cada vez que se pulsa el chip.
const MINUTE_CYCLE = [0, 1, 2, 3, 5];
function cycleMinutes(current: number): number {
  const i = MINUTE_CYCLE.indexOf(current);
  return MINUTE_CYCLE[(i + 1) % MINUTE_CYCLE.length] ?? 0;
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

// Botón de acceso a la pantalla de estrategia. Reutilizado en "mi turno" y en
// la vista de espera (pre-carrera / descanso) para poder configurar antes.
function StrategyButton({ navigation, pendingCount }: {
  navigation: NativeStackNavigationProp<RootStackParamList>;
  pendingCount: number;
}) {
  return (
    <Pressable style={styles.strategyBtn} onPress={() => navigation.push('Strategy')}>
      <Text style={styles.strategyBtnText}>
        Estrategia de neumáticos{pendingCount > 0 ? ` · ${pendingCount} ●` : ''} →
      </Text>
    </Pressable>
  );
}

// Sección de ajustes de voz. Reutilizada en "mi turno" y en la vista de espera.
function VoiceControls({ settings, toggle, update, isSlotTime }: {
  settings: VoiceSettings;
  toggle: (k: keyof VoiceSettings) => void;
  update: (p: Partial<VoiceSettings>) => void;
  isSlotTime: boolean;
}) {
  return (
    <>
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
            <ToggleChip label="Media manga" active={settings.sayHalfManga}     onPress={() => toggle('sayHalfManga')} />
            <ToggleChip label="Último min" active={settings.sayLastMinute}     onPress={() => toggle('sayLastMinute')} />
            <ToggleChip label="30 s"      active={settings.sayLast30s}        onPress={() => toggle('sayLast30s')} />
            <ToggleChip
              label={settings.sayAveragesEveryMin > 0 ? `Media ${settings.sayAveragesEveryMin} min` : 'Media'}
              active={settings.sayAveragesEveryMin > 0}
              onPress={() => update({ sayAveragesEveryMin: cycleMinutes(settings.sayAveragesEveryMin) })}
            />
            <ToggleChip
              label={settings.sayGapsEveryMin > 0 ? `Gaps ${settings.sayGapsEveryMin} min` : 'Gaps'}
              active={settings.sayGapsEveryMin > 0}
              onPress={() => update({ sayGapsEveryMin: cycleMinutes(settings.sayGapsEveryMin) })}
            />
            <ToggleChip
              label={settings.sayCatchUpEveryMin > 0 ? `P/Subir ${settings.sayCatchUpEveryMin} min` : 'P/Subir'}
              active={settings.sayCatchUpEveryMin > 0}
              onPress={() => update({ sayCatchUpEveryMin: cycleMinutes(settings.sayCatchUpEveryMin) })}
            />
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  kind: { color: '#9aa3ad', fontSize: 12, marginTop: 12, textTransform: 'uppercase' },
  selfName: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 },
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

  // Acceso a Estrategia
  strategyBtn: {
    marginTop: 18, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#f6c90e',
  },
  strategyBtnText: { color: '#f6c90e', fontSize: 15, fontWeight: '700' },

  // Vista de descanso
  restTitle: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4 },
  finalTitle: { fontSize: 44, fontWeight: '800', marginTop: 8, letterSpacing: 2 },
  restSub:   { color: '#9aa3ad', fontSize: 14, marginTop: 8 },

  // Entreno GO
  goBtn: { paddingVertical: 18, borderRadius: 10, alignItems: 'center' },
  goBtnStart: { backgroundColor: '#1f5f2a' },
  goBtnStop:  { backgroundColor: '#7a2230' },
  goBtnText:  { color: '#fff', fontSize: 18, fontWeight: '800' },
  linkBtn: { marginTop: 14, paddingVertical: 8, alignItems: 'center' },
  linkBtnText: { color: '#f6c90e', fontSize: 14, fontWeight: '600' },

  // Modal de guardado
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: 24,
  },
  modalCard: { backgroundColor: '#141923', borderRadius: 12, padding: 20 },
  modalTitle: { color: '#f6c90e', fontSize: 20, fontWeight: '800' },
  modalSub: { color: '#9aa3ad', fontSize: 13, marginTop: 4 },
  input: {
    marginTop: 4, backgroundColor: '#0a0d13', borderRadius: 8,
    borderWidth: 1, borderColor: '#3a4350',
    color: '#fff', fontSize: 16, paddingHorizontal: 12, paddingVertical: 10,
  },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalBtnGhost: { borderWidth: 1, borderColor: '#3a4350' },
  modalBtnGhostText: { color: '#cfd5dc', fontSize: 15, fontWeight: '600' },
  modalBtnPrimary: { backgroundColor: '#f6c90e' },
  modalBtnPrimaryText: { color: '#0a0d13', fontSize: 15, fontWeight: '700' },
});
