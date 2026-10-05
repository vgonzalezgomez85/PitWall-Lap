// Pantalla "mi turno": cronometraje personal en vivo + voz.
//
// Jerarquía pensada para mirarse de reojo en pista:
//   1. Tarjeta principal: carril, tiempo restante y la última vuelta en
//      grande, coloreada frente a la mejor (morado / verde / ámbar) + delta.
//   2. Carrera: posición, gaps (con el nombre del rival) y media para subir.
//   3. Accesos (estrategia, seguimiento) y, plegados, los ajustes de voz.
//
// La voz se activa con `useVoice()` y se controla en vivo: el interruptor
// general está siempre a mano en la cabecera; el resto, en "Voz y ajustes".
// Los toggles son persistentes (AsyncStorage).

import { useEffect, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import { useDataSource } from '../data/sourceContext';
import { useMangaDurationMin } from '../data/infolapSettings';
import { useStintRecorder } from '../data/useStintRecorder';
import { saveStint, type StintSetup } from '../data/trainingStore';
import { useVoice } from '../voice/useVoice';
import { useTireStrategy } from '../strategy/useTireStrategy';
import type { VoiceSettings } from '../voice/settings';
import type { LiveState } from '../data/types';
import BackButton from '../ui/BackButton';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Chip from '../ui/Chip';
import NavRow from '../ui/NavRow';
import Section from '../ui/Section';
import Stat from '../ui/Stat';
import { lapDeltaLabel, lapTone, type LapTone } from '../ui/lapTone';
import { colors, radius, spacing, type } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTurn'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

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

// Gap en vueltas (PitWall) o, si la fuente solo lo da en tiempo (TicTac
// nuevo), en segundos.
function fmtGap(laps: number | null, ms: number | null): string {
  if (laps != null || ms == null) return fmtGapLaps(laps);
  return `${fmt(ms)} s`;
}

// Etiqueta visible de la fuente (el id interno sigue siendo 'pitwall'/'infolap').
function sourceLabel(source: string | undefined): string {
  if (source === 'pitwall') return 'PitWall';
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

const TONE_COLOR: Record<LapTone, string> = {
  best: colors.best,
  good: colors.good,
  slow: colors.slow,
  neutral: colors.text,
};

export default function MyTurnScreen(_props: Props) {
  void _props;
  const { state, raceInfo, source } = useDataSource();
  const { pendingCount, available: strategyAvailable } = useTireStrategy();
  const { settings, toggle, update } = useVoice();
  const navigation = useNavigation<Nav>();

  const isPitWall = raceInfo?.source === 'pitwall';
  // TicTac nuevo (WSS): mismos datos que PitWall salvo salidas/pits/plan.
  const isTicTacLive = raceInfo?.source === 'infolap' && (raceInfo.capabilities.positions ?? false);
  const fullData = isPitWall || isTicTacLive;
  const isTraining = raceInfo?.mode === 'training';
  // Seguimiento de rivales: TicTac (local) y carreras por equipos de PitWall.
  const trackingAvailable = !isTraining && !!source?.getTracking && (
    raceInfo?.source === 'infolap'
    || (isPitWall && raceInfo?.format === 'team' && (raceInfo.mode ?? 'race') === 'race')
  );

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

  const header = (
    <Header
      source={sourceLabel(raceInfo?.source)}
      name={state.selfName ?? null}
      voiceOn={settings.enabled}
      onToggleVoice={() => toggle('enabled')}
    />
  );

  // ── Vista de espera: PRE-CARRERA (aún no empieza) o DESCANSO (no corres la
  // manga en curso). En ambos casos mostramos el horario y, sobre todo, dejamos
  // configurar la app (voz + estrategia) mientras esperas tu turno. Sin voz
  // (la app silencia eventos cuando no es turno; cuando llegue su manga, se
  // pasa solo a 'my-turn').
  if (state.status === 'resting' || state.status === 'pre-race') {
    const isPre = state.status === 'pre-race';
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <BackButton />
        {header}
        <AvisoManga state={state} conSiguiente={false} />

        {state.isFinal ? (
          <Card style={styles.hero}>
            <Text style={styles.finalTitle}>FINAL</Text>
            <Text style={[type.body, styles.centerText]}>
              Ya has corrido todas tus mangas. Carrera completada para ti.
            </Text>
          </Card>
        ) : (
          <Card style={styles.hero}>
            <Text style={styles.waitTitle}>
              {isPre ? 'La carrera aún no ha empezado' : 'Descansas esta manga'}
            </Text>
            {!isPre && state.currentMangaNum != null && !mangaCerrada(state) && (
              <Text style={[type.body, styles.waitSub]}>
                Ahora se corre la manga {state.currentMangaNum}
                {state.remainingMs != null && ` · quedan ${fmtRemaining(state.remainingMs)}`}
              </Text>
            )}
            {state.nextMangaInfo ? (
              <View style={styles.waitStats}>
                <Stat
                  label={isPre ? 'Tu primera manga' : 'Tu próxima manga'}
                  value={String(state.nextMangaInfo.mangaNum)}
                  align="center"
                  style={styles.waitStat}
                />
                <View style={styles.vDivider} />
                <Stat
                  label="Carril"
                  value={String(state.nextMangaInfo.lane)}
                  color={colors.accent}
                  align="center"
                  style={styles.waitStat}
                />
              </View>
            ) : (
              <Text style={[type.body, styles.waitSub]}>
                {isPre
                  ? 'Descansas toda la carrera (sin mangas asignadas).'
                  : isPitWall
                    ? 'Sin próxima manga programada.'
                    : 'El TicTac no envía el plan de mangas: te avisaré cuando empiece la tuya.'}
              </Text>
            )}
          </Card>
        )}

        {/* Config disponible mientras esperas (PitWall y TicTac nuevo). */}
        {fullData && !isTraining && (
          <>
            <Accesos
              navigation={navigation}
              strategy={strategyAvailable}
              tracking={trackingAvailable}
              pendingCount={pendingCount}
            />
            <Section title="Voz y ajustes">
              {isTicTacLive && <MangaDurationControl />}
              <VoiceControls settings={settings} toggle={toggle} update={update} full={fullData} />
            </Section>
          </>
        )}
      </ScrollView>
    );
  }

  // ── Vista "mi turno" ───────────────────────────────────────────────────
  const tone = lapTone(state.lastLapMs, state.bestLapMs);
  const delta = lapDeltaLabel(state.lastLapMs, state.bestLapMs);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <BackButton />
      {header}
      <AvisoManga state={state} conSiguiente />

      {/* ── Tarjeta principal ─────────────────────────────────────────── */}
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.lanePill}>
            <Text style={styles.lanePillText}>Carril {state.myLane ?? '—'}</Text>
          </View>
          {state.remainingMs != null && (
            <View style={styles.remaining}>
              <Text style={type.label}>Restante</Text>
              <Text style={styles.remainingValue}>{fmtRemaining(state.remainingMs)}</Text>
            </View>
          )}
        </View>

        <Text style={[type.label, styles.heroLabel]}>Última vuelta</Text>
        <Text
          style={[type.hero, styles.heroValue, { color: TONE_COLOR[tone] }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {fmt(state.lastLapMs)}
        </Text>
        <Text style={[styles.delta, { color: TONE_COLOR[tone] }]}>{delta ?? ' '}</Text>

        <View style={styles.divider} />
        <View style={styles.statsRow}>
          <Stat label="Rápida" value={fmt(state.bestLapMs)} color={state.bestLapMs != null ? colors.best : undefined} />
          <Stat label="Media carril" value={fmt(state.avgLapMs)} />
          <Stat label="Vueltas" value={String(state.lapCount)} />
        </View>
      </Card>

      {/* ── Carrera ───────────────────────────────────────────────────── */}
      {state.position != null && (
        <Card style={styles.card}>
          <View style={styles.statsRow}>
            <View style={styles.positionBox}>
              <Text style={type.label}>Posición</Text>
              <Text style={styles.positionValue} numberOfLines={1} adjustsFontSizeToFit>
                P{state.position}
                <Text style={styles.positionTotal}> / {state.totalParticipants ?? '?'}</Text>
              </Text>
            </View>
            <Stat
              label="Delante"
              value={fmtGap(state.gapAheadLaps, state.gapAheadMs)}
              sub={state.aheadName}
              small
            />
            <Stat
              label="Detrás"
              value={fmtGap(state.gapBehindLaps, state.gapBehindMs)}
              sub={state.behindName}
              small
            />
          </View>
          {fullData && (
            <>
              <View style={styles.divider} />
              <View style={styles.inlineStat}>
                <Text style={type.label}>Media para subir</Text>
                <Text style={styles.inlineValue}>{fmt(state.avgToCatchMs)}</Text>
              </View>
            </>
          )}
        </Card>
      )}

      {isPitWall && (
        <Card style={styles.card}>
          <View style={styles.statsRow}>
            <Stat label="Salidas" value={String(state.exitCount)} small />
            <Stat label="Pit stops" value={String(state.pitStopCount)} small />
          </View>
        </Card>
      )}

      {!isTraining && (
        <Accesos
          navigation={navigation}
          strategy={strategyAvailable}
          tracking={trackingAvailable}
          pendingCount={pendingCount}
        />
      )}

      {/* ── Entreno GO (solo modo entrenamiento) ───────────────────────── */}
      {isTraining && (
        <Section title="Registro de entrenamiento">
          <Pressable
            onPress={() => (recorder.recording ? onStop() : recorder.start())}
            style={({ pressed }) => [
              styles.goBtn,
              recorder.recording ? styles.goBtnStop : styles.goBtnStart,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.goBtnText}>
              {recorder.recording ? '■  Detener y guardar' : '▶  Entreno GO'}
            </Text>
          </Pressable>
          {recorder.recording && (
            <Card style={styles.card}>
              <View style={styles.statsRow}>
                <Stat label="Vueltas" value={String(recLaps.length)} />
                <Stat label="Mejor" value={fmt(recBest)} />
                <Stat label="Media" value={fmt(recAvg)} />
              </View>
            </Card>
          )}
          <View style={styles.card}>
            <NavRow title="Mis entrenamientos" onPress={() => navigation.push('Training')} />
          </View>
        </Section>
      )}

      {/* ── Ajustes (plegados: en carrera lo importante son los datos) ─── */}
      <Section
        title="Voz y ajustes"
        collapsible
        initiallyOpen={false}
        summary={voiceSummary(settings, fullData)}
      >
        {isTicTacLive && <MangaDurationControl />}
        <VoiceControls settings={settings} toggle={toggle} update={update} full={fullData} />
      </Section>

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
              <Button label="Descartar" variant="ghost" onPress={() => setPending(null)} style={styles.flex} />
              <Button label="Guardar" onPress={confirmSave} style={styles.flex} />
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

// Cabecera: fuente + nombre a la izquierda; interruptor general de voz a la
// derecha, siempre visible (es lo que más se toca en pista).
function Header({ source, name, voiceOn, onToggleVoice }: {
  source: string;
  name: string | null;
  voiceOn: boolean;
  onToggleVoice: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text style={type.label}>{source}</Text>
        {!!name && <Text style={[type.heading, styles.headerName]} numberOfLines={1}>{name}</Text>}
      </View>
      <Chip label={voiceOn ? 'Voz ON' : 'Voz OFF'} active={voiceOn} onPress={onToggleVoice} />
    </View>
  );
}

function mangaCerrada(s: LiveState): boolean {
  return s.estadoManga === 'terminada' || s.estadoManga === 'cancelada';
}

// Aviso del estado de la manga (PitWall): pausada, terminada o detenida con
// STOP. En curso no se muestra nada. `conSiguiente`: añadir la próxima manga
// del piloto (en la vista de espera ya sale en su tarjeta).
function AvisoManga({ state, conSiguiente }: { state: LiveState; conSiguiente: boolean }) {
  const e = state.estadoManga;
  if (e == null || e === 'en-curso') return null;
  let titulo: string;
  let texto: string | null;
  let color: string;
  if (e === 'pausada') {
    titulo = 'Manga en pausa';
    texto = 'El reloj está parado hasta que se reanude.';
    color = colors.slow;
  } else if (e === 'cancelada') {
    titulo = 'Manga detenida';
    texto = 'Se ha anulado y se repetirá desde cero con el próximo GO.';
    color = colors.danger;
  } else {
    titulo = 'Manga terminada';
    const sig = state.nextMangaInfo;
    texto = !conSiguiente ? null
      : sig ? `Tu próxima manga: ${sig.mangaNum} · carril ${sig.lane}`
      : 'No tienes más mangas programadas.';
    color = colors.accent;
  }
  return (
    <View style={[styles.aviso, { borderColor: color }]}>
      <Text style={[styles.avisoTitulo, { color }]}>{titulo}</Text>
      {!!texto && <Text style={styles.avisoTexto}>{texto}</Text>}
    </View>
  );
}

// Accesos a Estrategia y Seguimiento. Reutilizado en "mi turno" y en la vista
// de espera (pre-carrera / descanso) para poder configurar antes.
function Accesos({ navigation, strategy, tracking, pendingCount }: {
  navigation: Nav;
  strategy: boolean;
  tracking: boolean;
  pendingCount: number;
}) {
  if (!strategy && !tracking) return null;
  return (
    <View style={styles.accesos}>
      {strategy && (
        <NavRow
          title="Estrategia de neumáticos"
          subtitle={pendingCount > 0 ? 'Tienes cambios pendientes' : 'Plan y avisos de cambio de goma'}
          badge={pendingCount}
          onPress={() => navigation.push('Strategy')}
        />
      )}
      {tracking && (
        <NavRow
          title="Seguimiento de rivales"
          subtitle="Vueltas y medias por carril"
          onPress={() => navigation.push('Tracking')}
        />
      )}
    </View>
  );
}

function SetupField({
  label, value, onChange,
}: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={type.label}>{label}</Text>
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

// Resumen de la sección plegada: "Voz ON · 5 avisos".
function voiceSummary(s: VoiceSettings, full: boolean): string {
  if (!s.enabled) return 'Voz OFF';
  const avisos = full
    ? [s.sayLaps, s.sayPositionChange, s.sayHalfManga, s.sayLastMinute, s.sayLast30s,
       s.sayAveragesEveryMin > 0, s.sayRaceAvgEveryMin > 0, s.sayGapsEveryMin > 0,
       s.sayCatchUpEveryMin > 0]
    : [s.sayLaps];
  const n = avisos.filter(Boolean).length;
  return `Voz ON · ${n} ${n === 1 ? 'aviso' : 'avisos'}`;
}

// Duración de manga para TicTac: el TicTac no la transmite y sin ella no hay
// tiempo restante, avisos de fin, proyección ni media para subir.
function MangaDurationControl() {
  const { source } = useDataSource();
  const [min, setMin] = useMangaDurationMin();
  useEffect(() => {
    source?.setMangaDurationMs?.(min > 0 ? min * 60_000 : null);
  }, [source, min]);
  return (
    <Card style={styles.settingsCard}>
      <Text style={type.label}>Duración de manga (TicTac)</Text>
      <View style={styles.stepperRow}>
        <Pressable
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          onPress={() => setMin(min - 1)}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{min > 0 ? `${min} min` : 'Sin configurar'}</Text>
        <Pressable
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          onPress={() => setMin(min + 1)}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
      <Text style={type.caption}>
        Cuenta desde que empieza la manga en el TicTac. Si te conectas con la manga ya empezada, el tiempo aparece en la siguiente.
      </Text>
    </Card>
  );
}

// Avisos de voz. Reutilizado en "mi turno" y en la vista de espera. El
// interruptor general vive en la cabecera.
// `full`: PitWall o TicTac nuevo (todos los avisos); TicTac antiguo, solo vueltas.
function VoiceControls({ settings, toggle, update, full }: {
  settings: VoiceSettings;
  toggle: (k: keyof VoiceSettings) => void;
  update: (p: Partial<VoiceSettings>) => void;
  full: boolean;
}) {
  return (
    <Card style={[styles.settingsCard, !settings.enabled && styles.dimmed]}>
      <Text style={type.label}>Avisos de voz</Text>
      <View style={styles.togglesRow}>
        <Chip label="Vueltas" active={settings.sayLaps} onPress={() => toggle('sayLaps')} />
        {full && (
          <>
            <Chip label="Posición"    active={settings.sayPositionChange} onPress={() => toggle('sayPositionChange')} />
            <Chip label="Media manga" active={settings.sayHalfManga}      onPress={() => toggle('sayHalfManga')} />
            <Chip label="Último min"  active={settings.sayLastMinute}     onPress={() => toggle('sayLastMinute')} />
            <Chip label="30 s"        active={settings.sayLast30s}        onPress={() => toggle('sayLast30s')} />
          </>
        )}
      </View>
      {full && (
        <>
          <Text style={[type.label, styles.subLabel]}>Periódicos · toca para cambiar el intervalo</Text>
          <View style={styles.togglesRow}>
            <Chip
              label={settings.sayAveragesEveryMin > 0 ? `Media manga · ${settings.sayAveragesEveryMin} min` : 'Media manga'}
              active={settings.sayAveragesEveryMin > 0}
              onPress={() => update({ sayAveragesEveryMin: cycleMinutes(settings.sayAveragesEveryMin) })}
            />
            <Chip
              label={settings.sayRaceAvgEveryMin > 0 ? `Media carrera · ${settings.sayRaceAvgEveryMin} min` : 'Media carrera'}
              active={settings.sayRaceAvgEveryMin > 0}
              onPress={() => update({ sayRaceAvgEveryMin: cycleMinutes(settings.sayRaceAvgEveryMin) })}
            />
            <Chip
              label={settings.sayGapsEveryMin > 0 ? `Gaps · ${settings.sayGapsEveryMin} min` : 'Gaps'}
              active={settings.sayGapsEveryMin > 0}
              onPress={() => update({ sayGapsEveryMin: cycleMinutes(settings.sayGapsEveryMin) })}
            />
            <Chip
              label={settings.sayCatchUpEveryMin > 0 ? `P/Subir · ${settings.sayCatchUpEveryMin} min` : 'P/Subir'}
              active={settings.sayCatchUpEveryMin > 0}
              onPress={() => update({ sayCatchUpEveryMin: cycleMinutes(settings.sayCatchUpEveryMin) })}
            />
          </View>
        </>
      )}
      {!settings.enabled && (
        <Text style={[type.caption, styles.subLabel]}>La voz está apagada: actívala arriba.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 40 },
  flex: { flex: 1 },
  pressed: { opacity: 0.65 },

  // Cabecera
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  headerName: { marginTop: 2 },

  // Aviso de estado de la manga
  aviso: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, backgroundColor: colors.surface,
  },
  avisoTitulo: { fontSize: 18, fontWeight: '800' },
  avisoTexto: { ...type.body, marginTop: spacing.xs },

  // Tarjeta principal
  hero: { marginTop: spacing.lg, paddingVertical: spacing.xl },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lanePill: {
    backgroundColor: colors.accent, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  lanePillText: { color: colors.onAccent, fontSize: 18, fontWeight: '800' },
  remaining: { alignItems: 'flex-end' },
  remainingValue: { ...type.statSmall, fontSize: 24, color: colors.textSoft, marginTop: 2 },
  heroLabel: { marginTop: spacing.xl, textAlign: 'center' },
  heroValue: { textAlign: 'center', marginTop: spacing.xs },
  delta: { textAlign: 'center', fontSize: 16, fontWeight: '700', ...type.tabular },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.lg },
  statsRow: { flexDirection: 'row', gap: spacing.md },

  // Carrera
  card: { marginTop: spacing.md },
  positionBox: { flex: 1, minWidth: 0 },
  positionValue: { ...type.stat, fontSize: 34, color: colors.accent, marginTop: spacing.xs },
  positionTotal: { fontSize: 18, color: colors.textMuted, fontWeight: '600' },
  inlineStat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inlineValue: { ...type.statSmall },

  accesos: { marginTop: spacing.lg, gap: spacing.sm },

  // Vista de espera
  finalTitle: {
    color: colors.accent, fontSize: 48, fontWeight: '800', letterSpacing: 4,
    textAlign: 'center', marginBottom: spacing.sm,
  },
  centerText: { textAlign: 'center' },
  waitTitle: { ...type.title, fontSize: 24, textAlign: 'center' },
  waitSub: { textAlign: 'center', marginTop: spacing.sm, color: colors.textMuted },
  waitStats: { flexDirection: 'row', alignItems: 'stretch', marginTop: spacing.xl },
  waitStat: { paddingVertical: spacing.xs },
  vDivider: { width: 1, backgroundColor: colors.borderSoft },

  // Ajustes
  settingsCard: { marginBottom: spacing.md },
  dimmed: { opacity: 0.5 },
  subLabel: { marginTop: spacing.lg },
  togglesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  stepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.lg, marginVertical: spacing.md,
  },
  stepBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { color: colors.accent, fontSize: 24, fontWeight: '700' },
  stepValue: { ...type.statSmall, minWidth: 130, textAlign: 'center' },

  // Entreno GO
  goBtn: { paddingVertical: 18, borderRadius: radius.md, alignItems: 'center' },
  goBtnStart: { backgroundColor: colors.success },
  goBtnStop:  { backgroundColor: colors.dangerSoft },
  goBtnText:  { color: colors.text, fontSize: 18, fontWeight: '800' },

  // Modal de guardado
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: 24,
  },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl },
  modalTitle: { color: colors.accent, fontSize: 20, fontWeight: '800' },
  modalSub: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  input: {
    marginTop: 4, backgroundColor: colors.bg, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10,
  },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
});
