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
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'StintDetail'>;

// Paleta para las series de la gráfica (el primero es el stint principal).
const PALETTE = ['#f6c90e', '#4ea1f6', '#5ec27a', '#e2724b'];

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', {
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

function seriesLabel(s: Stint): string {
  return stintSetupLabel(s.setup) || `Stint ${formatDate(s.savedAt)}`;
}

export default function StintDetailScreen({ route, navigation }: Props) {
  const { id, compareIds } = route.params;
  const [main, setMain] = useState<Stint | null | undefined>(undefined);
  const [others, setOthers] = useState<Stint[]>([]);
  const [editing, setEditing] = useState(false);
  const [setup, setSetup] = useState<StintSetup>({});

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
    Alert.alert('Borrar stint', '¿Eliminar este entrenamiento? No se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => { await deleteStint(main.id); navigation.goBack(); },
      },
    ]);
  }

  if (main === undefined) {
    return (
      <View style={styles.root}><BackButton />
        <Text style={styles.empty}>Cargando…</Text>
      </View>
    );
  }
  if (main === null) {
    return (
      <View style={styles.root}><BackButton />
        <Text style={styles.empty}>No se encontró este stint.</Text>
      </View>
    );
  }

  const allStints = [main, ...others];
  const series: ChartSeries[] = allStints.map((s, i) => ({
    label: seriesLabel(s),
    color: (PALETTE[i % PALETTE.length] ?? '#f6c90e'),
    laps: s.lapTimes,
  }));
  const comparing = others.length > 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <BackButton />
      <Text style={styles.title}>
        {comparing ? 'Comparativa' : (stintSetupLabel(main.setup) || 'Stint')}
      </Text>
      <Text style={styles.subtitle}>
        {comparing
          ? `${allStints.length} stints superpuestos`
          : `${formatDate(main.savedAt)}${main.lane != null ? ` · carril ${main.lane}` : ''}`}
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
                <Text style={styles.statsName} numberOfLines={1}>{seriesLabel(s)}</Text>
                <Text style={styles.statsLine}>
                  {s.lapCount} vueltas · mejor {fmt(s.bestMs)} · media {fmt(s.avgMs)}
                  {sd != null && ` · ±${fmt(sd)}`}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>±  = consistencia (desviación de los tiempos; menor es mejor)</Text>

      {!comparing && (
        <>
          {/* Datos del coche */}
          <Text style={styles.section}>Datos del coche</Text>
          <SetupRow label="Modelo" value={main.setup.carModel} />
          <SetupRow label="Motor" value={main.setup.motor} />
          <SetupRow label="Neumático" value={main.setup.tire} />
          <SetupRow label="Llanta" value={main.setup.rim} />

          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => { setSetup(main.setup); setEditing(true); }}
          >
            <Text style={styles.editBtnText}>Editar datos del coche</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
            <Text style={styles.deleteBtnText}>Borrar stint</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal visible={editing} transparent animationType="fade"
        onRequestClose={() => setEditing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Datos del coche</Text>
            <SetupField label="Modelo de coche" value={setup.carModel}
              onChange={v => setSetup(s => ({ ...s, carModel: v }))} />
            <SetupField label="Motor" value={setup.motor}
              onChange={v => setSetup(s => ({ ...s, motor: v }))} />
            <SetupField label="Neumático" value={setup.tire}
              onChange={v => setSetup(s => ({ ...s, tire: v }))} />
            <SetupField label="Medida de llanta" value={setup.rim}
              onChange={v => setSetup(s => ({ ...s, rim: v }))} />
            <View style={styles.modalBtns}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setEditing(false)}>
                <Text style={styles.modalBtnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={saveSetup}>
                <Text style={styles.modalBtnPrimaryText}>Guardar</Text>
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
