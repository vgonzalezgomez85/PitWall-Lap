// Pantalla "Estrategia" — estrategia de neumáticos en vivo (Fase 1 + 2).
//
// Config (coste de parada y nº de juegos), botón "Cambié gomas" y la
// recomendación del piloto seguido: cuándo parar (por tiempo) y el consejo
// por posición. Fase 2: confirmación de cambios de goma de los rivales de
// delante/detrás (auto-detectados o manuales) e info de su goma.

import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { useTireStrategy, type RivalView } from '../strategy/useTireStrategy';
import { MIN_CONFIDENCE_LAPS, type StrategyResult } from '../strategy/computeTireStrategy';
import BackButton from '../ui/BackButton';

export default function StrategyScreen() {
  const {
    available, config, setConfig, changeTires, result, followedName, ready,
    serverDriven, ownTire,
    pending, confirmRivalChange, dismissRivalChange, markRivalChange, rivals,
  } = useTireStrategy();

  function confirmChange() {
    Alert.alert(
      'Cambié gomas',
      'Consume un juego y reinicia el stint del piloto seguido. ¿Confirmar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sí, cambié', style: 'destructive', onPress: changeTires },
      ],
    );
  }

  if (!available) {
    return (
      <View style={styles.root}>
        <BackButton />
        <Text style={styles.title}>Estrategia</Text>
        <View style={styles.center}>
          <Text style={styles.muted}>
            La estrategia de neumáticos solo está disponible en carreras PitWall
            con un piloto seleccionado.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <BackButton />
      <Text style={styles.title}>Estrategia</Text>
      {followedName && <Text style={styles.self}>{followedName}</Text>}

      {/* ── Neumáticos según el servidor (PitWall Manager) ──────────────── */}
      {serverDriven && ownTire && (
        <View style={styles.serverBlock}>
          <Text style={styles.label}>Neumáticos · servidor</Text>
          <Text style={styles.serverMain}>
            {ownTire.available} de {ownTire.allowance} juegos restantes
          </Text>
          <Text style={styles.serverSub}>{lastChangeText(ownTire.lastChange)}</Text>
          <Text style={styles.serverHint}>
            Dotación y cambios los controla PitWall Manager.
          </Text>
        </View>
      )}

      {/* ── Confirmaciones de cambio de rival (auto-detectado) ──────────── */}
      {pending.map(p => (
        <View key={p.name} style={styles.confirmBanner}>
          <Text style={styles.confirmText}>
            ¿{p.name} ({p.side === 'ahead' ? 'delante' : 'detrás'}) ha cambiado gomas?
          </Text>
          <View style={styles.confirmBtns}>
            <Pressable style={[styles.confirmBtn, styles.confirmNo]} onPress={() => dismissRivalChange(p.name)}>
              <Text style={styles.confirmNoText}>No</Text>
            </Pressable>
            <Pressable style={[styles.confirmBtn, styles.confirmYes]} onPress={() => confirmRivalChange(p.name)}>
              <Text style={styles.confirmYesText}>Sí, cambió</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {/* ── Recomendación principal ─────────────────────────────────────── */}
      {result && <RecommendationCard result={result} />}

      {/* ── Consejo por posición ────────────────────────────────────────── */}
      {result?.position && (
        <View style={[styles.block, posStyle(result.position.action)]}>
          <Text style={styles.label}>Posición</Text>
          <Text style={styles.posText}>{result.position.text}</Text>
        </View>
      )}

      {/* ── Métricas ────────────────────────────────────────────────────── */}
      {result && (
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Degradación</Text>
            <Text style={styles.metric}>{fmtDeg(result.degradationMsPerLap)}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Vuelta del stint</Text>
            <Text style={styles.metric}>{result.stintLap}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Juegos restantes</Text>
            <Text style={styles.metric}>{result.setsAvailable}</Text>
          </View>
        </View>
      )}

      {/* ── Cambié gomas (sólo manual; con servidor lo marca el Manager) ── */}
      {!serverDriven && (
        <Pressable style={styles.changeBtn} onPress={confirmChange} disabled={!ready}>
          <Text style={styles.changeBtnText}>Cambié gomas</Text>
        </Pressable>
      )}

      {/* ── Goma de los rivales (Fase 2) ────────────────────────────────── */}
      {(rivals.ahead || rivals.behind) && (
        <>
          <Text style={styles.section}>Goma de los rivales</Text>
          {rivals.ahead && (
            <RivalCard rival={rivals.ahead} onMark={() => markRivalChange('ahead')} hideMark={serverDriven} />
          )}
          {rivals.behind && (
            <RivalCard rival={rivals.behind} onMark={() => markRivalChange('behind')} hideMark={serverDriven} />
          )}
        </>
      )}

      {/* ── Configuración ───────────────────────────────────────────────── */}
      <Text style={styles.section}>Configuración</Text>
      <Stepper
        label="Coste de parada (s)"
        value={config.pitCostSec}
        onChange={v => setConfig({ pitCostSec: clamp(v, 5, 120) })}
        step={1}
      />
      {/* Con control del servidor, la dotación viene del Manager (no editable). */}
      {!serverDriven && (
        <Stepper
          label="Juegos de neumáticos"
          value={config.setsTotal}
          onChange={v => setConfig({ setsTotal: clamp(v, 1, 20) })}
          step={1}
        />
      )}
      <Stepper
        label="Cambios obligatorios (reglamento)"
        value={config.mandatoryChanges}
        onChange={v => setConfig({ mandatoryChanges: clamp(v, 0, (serverDriven && ownTire ? ownTire.allowance : config.setsTotal - 1)) })}
        step={1}
      />
    </ScrollView>
  );
}

function RecommendationCard({ result }: { result: StrategyResult }) {
  let headline: string;
  let sub: string | null = null;
  switch (result.recommendation.kind) {
    case 'change-in':
      if (result.recommendation.basis === 'scheduled') {
        headline = `Cambio pautado en ~${result.recommendation.laps} vueltas`;
        sub = 'Sin degradación de ritmo — reparto de juegos por vueltas restantes.';
      } else {
        headline = `Cambio óptimo en ~${result.recommendation.laps} vueltas`;
      }
      break;
    case 'window-open':
      headline = 'Ventana abierta · cambia cuanto antes';
      if (result.recommendation.basis === 'scheduled') {
        sub = 'Reparto pautado: toca gastar un juego.';
      }
      break;
    case 'hold-to-end':
      if (result.setsAvailable > 0) {
        headline = 'Aguanta hasta meta';
        sub = 'Sin degradación y sin cambios obligatorios: parar es tiempo regalado.';
      } else {
        headline = 'Sin juegos · aguanta a meta';
      }
      break;
    case 'no-degradation':
      headline = 'Sin degradación medible';
      sub = 'Las gomas no pierden ritmo — decide por posición o relevo.';
      break;
    case 'insufficient-data':
    default:
      headline = 'Recogiendo datos…';
      sub = `${result.stintLap}/${MIN_CONFIDENCE_LAPS} vueltas para afinar`;
      break;
  }
  return (
    <View style={styles.heroBlock}>
      <Text style={styles.heroLabel}>Recomendación</Text>
      <Text style={styles.hero}>{headline}</Text>
      {sub && <Text style={styles.heroSub}>{sub}</Text>}
      {result.confidence === 'low' && (
        <Text style={styles.lowConf}>Baja confianza (pocas vueltas)</Text>
      )}
    </View>
  );
}

function RivalCard({ rival, onMark, hideMark }: { rival: RivalView; onMark: () => void; hideMark?: boolean }) {
  const sideLabel = rival.side === 'ahead' ? 'Delante' : 'Detrás';
  const age = rival.ageKnown
    ? `${rival.tireAgeLaps} v${rival.confidence !== 'ok' ? ' · baja conf.' : ''}`
    : 'edad desconocida';
  return (
    <View style={styles.rivalCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{sideLabel} · {rival.name}</Text>
        <Text style={styles.rivalInfo}>
          Goma: {age}   ·   Degr. {fmtDeg(rival.degradationMsPerLap)}
        </Text>
      </View>
      {!hideMark && (
        <Pressable style={styles.markBtn} onPress={onMark}>
          <Text style={styles.markBtnText}>Marcar cambio</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Texto del último cambio de goma según el servidor. */
function lastChangeText(lc: { setNumber: number; mangaNumber: number | null; raceElapsedMs: number | null } | null): string {
  if (!lc) return 'Sin cambios registrados';
  const parts = [`Último cambio: juego ${lc.setNumber}`];
  if (lc.mangaNumber != null) parts.push(`manga ${lc.mangaNumber}`);
  if (lc.raceElapsedMs != null) parts.push(fmtElapsed(lc.raceElapsedMs));
  return parts.join(' · ');
}

/** ms de carrera → "h:mm:ss" o "mm:ss". */
function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Stepper({
  label, value, onChange, step,
}: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperCtrl}>
        <Pressable style={styles.stepBtn} onPress={() => onChange(value - step)}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable style={styles.stepBtn} onPress={() => onChange(value + step)}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fmtDeg(ms: number | null): string {
  if (ms == null) return '—';
  const s = ms / 1000;
  return `${s >= 0 ? '+' : ''}${s.toFixed(2)} s`;
}

function posStyle(action: 'change' | 'hold' | 'neutral') {
  if (action === 'change') return { borderColor: '#f6c90e', borderWidth: 1 };
  if (action === 'hold') return { borderColor: '#2c5cdd', borderWidth: 1 };
  return {};
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 12 },
  self: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 4 },
  muted: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  heroBlock: { marginTop: 20, padding: 18, backgroundColor: '#141923', borderRadius: 10 },
  heroLabel: { color: '#9aa3ad', fontSize: 12, textTransform: 'uppercase' },
  hero: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 6 },
  heroSub: { color: '#9aa3ad', fontSize: 13, marginTop: 6 },
  lowConf: { color: '#e0a93b', fontSize: 12, marginTop: 8 },

  // Bloque de neumáticos según el servidor
  serverBlock: {
    marginTop: 16, padding: 16, borderRadius: 10,
    backgroundColor: '#141923', borderWidth: 1, borderColor: '#2c5cdd',
  },
  serverMain: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 6 },
  serverSub: { color: '#cfd5dc', fontSize: 14, marginTop: 6 },
  serverHint: { color: '#7f8a97', fontSize: 12, marginTop: 8 },

  block: { marginTop: 14, padding: 16, backgroundColor: '#141923', borderRadius: 10 },
  label: { color: '#9aa3ad', fontSize: 12, textTransform: 'uppercase' },
  posText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 6 },

  row: { flexDirection: 'row', marginTop: 14, gap: 12 },
  col: { flex: 1, padding: 14, backgroundColor: '#141923', borderRadius: 10 },
  metric: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 },

  changeBtn: {
    marginTop: 22, paddingVertical: 16, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#7a2230',
  },
  changeBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },

  // Confirmación de cambio de rival
  confirmBanner: {
    marginTop: 16, padding: 16, borderRadius: 10,
    backgroundColor: '#1a2030', borderWidth: 1, borderColor: '#f6c90e',
  },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  confirmBtns: { flexDirection: 'row', gap: 12, marginTop: 14 },
  confirmBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  confirmNo: { borderWidth: 1, borderColor: '#3a4350' },
  confirmNoText: { color: '#cfd5dc', fontSize: 15, fontWeight: '600' },
  confirmYes: { backgroundColor: '#f6c90e' },
  confirmYesText: { color: '#0a0d13', fontSize: 15, fontWeight: '700' },

  // Goma de rivales
  rivalCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 10, padding: 14, backgroundColor: '#141923', borderRadius: 10,
  },
  rivalInfo: { color: '#cfd5dc', fontSize: 14, marginTop: 4 },
  markBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#3a4350',
  },
  markBtnText: { color: '#f6c90e', fontSize: 13, fontWeight: '700' },

  section: {
    color: '#9aa3ad', fontSize: 12, marginTop: 28, marginBottom: 8,
    textTransform: 'uppercase',
  },
  stepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#141923',
    borderRadius: 10, marginBottom: 10,
  },
  stepperLabel: { color: '#cfd5dc', fontSize: 15, flex: 1 },
  stepperCtrl: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 40, height: 40, borderRadius: 8, backgroundColor: '#0a0d13',
    borderWidth: 1, borderColor: '#3a4350', alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { color: '#f6c90e', fontSize: 22, fontWeight: '800' },
  stepperValue: { color: '#fff', fontSize: 20, fontWeight: '700', minWidth: 36, textAlign: 'center' },
});
