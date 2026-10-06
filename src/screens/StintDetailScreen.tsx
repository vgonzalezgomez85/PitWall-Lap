// Detalle de un stint de entrenamiento: gráfica de tiempos de vuelta
// (con media móvil) y estadísticas. Si llegan `compareIds`, superpone
// esos stints en la misma gráfica para comparar.

import { useCallback, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  deleteStint, getStint, stintSetupLabel, updateStintSetup,
  type Stint, type StintSetup,
} from '../data/trainingStore';
import LapChart, { type ChartSeries } from '../ui/LapChart';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import type { Textos } from '../i18n';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'StintDetail'>;

// Paleta para las series de la gráfica (el primero es el stint principal).
const PALETTE = ['#f6c90e', '#4ea1f6', '#5ec27a', '#e2724b'];

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Desviación estándar de los tiempos → indicador de consistencia.
function stdDev(laps: number[]): number | null {
  if (laps.length < 2) return null;
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
  const variance = laps.reduce((a, b) => a + (b - mean) ** 2, 0) / laps.length;
  return Math.sqrt(variance);
}

function seriesLabel(s: Stint, t: Textos, locale: string): string {
  return stintSetupLabel(s.setup) || t.entrenos.stintDe(formatDate(s.savedAt, locale));
}

export default function StintDetailScreen({ route, navigation }: Props) {
  const { id, compareIds } = route.params;
  const [main, setMain] = useState<Stint | null | undefined>(undefined);
  const [others, setOthers] = useState<Stint[]>([]);
  const [editing, setEditing] = useState(false);
  const [setup, setSetup] = useState<StintSetup>({});
  const { t, locale } = useIdioma();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const m = await getStint(id);
        const o = await Promise.all((compareIds ?? []).map(getStint));
        if (cancelled) return;
        setMain(m ?? null);
        setOthers(o.filter((s): s is Stint => s != null));
      })();
      return () => { cancelled = true; };
    }, [id, compareIds]),
  );

  async function saveSetup() {
    if (!main) return;
    await updateStintSetup(main.id, setup);
    setMain({ ...main, setup });
    setEditing(false);
  }

  function confirmDelete() {
    if (!main) return;
    Alert.alert(t.stint.borrarStint, t.stint.borrarTexto, [
      { text: t.comun.cancelar, style: 'cancel' },
      {
        text: t.stint.borrar, style: 'destructive',
        onPress: async () => { await deleteStint(main.id); navigation.goBack(); },
      },
    ]);
  }

  if (main === undefined) {
    return (
      <View style={styles.root}><BackButton />
        <Text style={styles.empty}>{t.comun.cargando}</Text>
      </View>
    );
  }
  if (main === null) {
    return (
      <View style={styles.root}><BackButton />
        <Text style={styles.empty}>{t.stint.noEncontrado}</Text>
      </View>
    );
  }

  const allStints = [main, ...others];
  const series: ChartSeries[] = allStints.map((s, i) => ({
    label: seriesLabel(s, t, locale),
    color: (PALETTE[i % PALETTE.length] ?? '#f6c90e'),
    laps: s.lapTimes,
  }));
  const comparing = others.length > 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <BackButton />
      <Text style={styles.title}>
        {comparing ? t.stint.comparativa : (stintSetupLabel(main.setup) || t.stint.stint)}
      </Text>
      <Text style={styles.subtitle}>
        {comparing
          ? t.stint.superpuestos(allStints.length)
          : `${formatDate(main.savedAt, locale)}${main.lane != null ? ` · ${t.comun.carrilMin(main.lane)}` : ''}`}
      </Text>

      <LapChart series={series} />

      {/* Tabla de stats por stint */}
      <View style={styles.statsTable}>
        {allStints.map((s, i) => {
          const sd = stdDev(s.lapTimes);
          return (
            <View key={s.id} style={styles.statsRow}>
              <View style={[styles.dot, { backgroundColor: (PALETTE[i % PALETTE.length] ?? '#f6c90e') }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.statsName} numberOfLines={1}>{seriesLabel(s, t, locale)}</Text>
                <Text style={styles.statsLine}>
                  {t.comun.vueltas(s.lapCount)} · {t.comun.mejor(fmt(s.bestMs))} · {t.comun.media(fmt(s.avgMs))}
                  {sd != null && ` · ±${fmt(sd)}`}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>{t.stint.consistencia}</Text>

      {!comparing && (
        <>
          {/* Datos del coche */}
          <Text style={styles.section}>{t.stint.datosCoche}</Text>
          <SetupRow label={t.coche.modelo} value={main.setup.carModel} />
          <SetupRow label={t.coche.motor} value={main.setup.motor} />
          <SetupRow label={t.coche.neumatico} value={main.setup.tire} />
          <SetupRow label={t.coche.llanta} value={main.setup.rim} />
          <SetupRow label={t.coche.corona} value={main.setup.crown} />
          <SetupRow label={t.coche.pinon} value={main.setup.pinion} />

          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => { setSetup(main.setup); setEditing(true); }}
          >
            <Text style={styles.editBtnText}>{t.stint.editarDatos}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
            <Text style={styles.deleteBtnText}>{t.stint.borrarStint}</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal visible={editing} transparent animationType="fade"
        onRequestClose={() => setEditing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.stint.datosCoche}</Text>
            <SetupField label={t.coche.modeloCoche} value={setup.carModel}
              onChange={v => setSetup(s => ({ ...s, carModel: v }))} />
            <SetupField label={t.coche.motor} value={setup.motor}
              onChange={v => setSetup(s => ({ ...s, motor: v }))} />
            <SetupField label={t.coche.neumatico} value={setup.tire}
              onChange={v => setSetup(s => ({ ...s, tire: v }))} />
            <SetupField label={t.coche.medidaLlanta} value={setup.rim}
              onChange={v => setSetup(s => ({ ...s, rim: v }))} />
            <SetupField label={t.coche.corona} value={setup.crown}
              onChange={v => setSetup(s => ({ ...s, crown: v }))} />
            <SetupField label={t.coche.pinon} value={setup.pinion}
              onChange={v => setSetup(s => ({ ...s, pinion: v }))} />
            <View style={styles.modalBtns}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setEditing(false)}>
                <Text style={styles.modalBtnGhostText}>{t.comun.cancelar}</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={saveSetup}>
                <Text style={styles.modalBtnPrimaryText}>{t.comun.guardar}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SetupRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.setupRow}>
      <Text style={styles.setupLabel}>{label}</Text>
      <Text style={styles.setupValue}>{value && value.trim() ? value : '—'}</Text>
    </View>
  );
}

function SetupField({
  label, value, onChange,
}: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.setupLabel}>{label}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  title: { color: '#f6c90e', fontSize: 24, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#9aa3ad', fontSize: 13, marginTop: 4 },
  empty: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', marginTop: 48 },

  statsTable: { marginTop: 16, gap: 4 },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#141923', borderRadius: 8, padding: 12,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statsName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  statsLine: { color: '#9aa3ad', fontSize: 12, marginTop: 3 },
  note: { color: '#6b7480', fontSize: 11, marginTop: 8 },

  section: {
    color: '#9aa3ad', fontSize: 12, marginTop: 28, marginBottom: 4,
    textTransform: 'uppercase',
  },
  setupRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1c2330',
  },
  setupLabel: { color: '#9aa3ad', fontSize: 14 },
  setupValue: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  editBtn: {
    marginTop: 20, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#3a4350', alignItems: 'center',
  },
  editBtnText: { color: '#cfd5dc', fontSize: 15, fontWeight: '600' },
  deleteBtn: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  deleteBtnText: { color: '#ff6b6b', fontSize: 15, fontWeight: '600' },

  input: {
    marginTop: 4, backgroundColor: '#0a0d13', borderRadius: 8,
    borderWidth: 1, borderColor: '#3a4350',
    color: '#fff', fontSize: 16, paddingHorizontal: 12, paddingVertical: 10,
  },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: 24,
  },
  modalCard: { backgroundColor: '#141923', borderRadius: 12, padding: 20 },
  modalTitle: { color: '#f6c90e', fontSize: 20, fontWeight: '800' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalBtnGhost: { borderWidth: 1, borderColor: '#3a4350' },
  modalBtnGhostText: { color: '#cfd5dc', fontSize: 15, fontWeight: '600' },
  modalBtnPrimary: { backgroundColor: '#f6c90e' },
  modalBtnPrimaryText: { color: '#0a0d13', fontSize: 15, fontWeight: '700' },
});
