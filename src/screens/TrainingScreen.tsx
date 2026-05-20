// Listado de stints de entrenamiento guardados localmente.
//
// Permite abrir un stint para ver su gráfica, o seleccionar varios y
// compararlos superpuestos en una sola gráfica.

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { listStints, stintSetupLabel, type StintMeta } from '../data/trainingStore';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Training'>;

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function TrainingScreen({ navigation }: Props) {
  const [stints, setStints] = useState<StintMeta[] | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listStints().then(list => { if (!cancelled) setStints(list); });
      return () => { cancelled = true; };
    }, []),
  );

  function toggleSelect(id: string) {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length >= 4 ? prev : [...prev, id],
    );
  }

  function openOne(id: string) {
    navigation.push('StintDetail', { id });
  }

  function openComparison() {
    if (selected.length < 2) return;
    const [first, ...rest] = selected;
    if (!first) return;
    navigation.push('StintDetail', { id: first, compareIds: rest });
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <View style={styles.headerRow}>
        <Text style={styles.title}>Entrenamientos</Text>
        {stints != null && stints.length >= 2 && (
          <TouchableOpacity
            onPress={() => { setCompareMode(m => !m); setSelected([]); }}
          >
            <Text style={styles.compareToggle}>
              {compareMode ? 'Cancelar' : 'Comparar'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {stints === null ? (
        <Text style={styles.empty}>Cargando…</Text>
      ) : stints.length === 0 ? (
        <Text style={styles.empty}>
          Aún no tienes stints guardados.{'\n'}
          Activa "Entreno GO" durante un entrenamiento para registrar tus vueltas.
        </Text>
      ) : (
        <>
          {compareMode && (
            <Text style={styles.hint}>
              Selecciona 2-4 stints para comparar ({selected.length} elegidos)
            </Text>
          )}
          <FlatList
            data={stints}
            keyExtractor={s => s.id}
            contentContainerStyle={{ paddingVertical: 12 }}
            renderItem={({ item }) => {
              const isSel = selected.includes(item.id);
              const label = stintSetupLabel(item.setup);
              return (
                <TouchableOpacity
                  style={[styles.row, compareMode && isSel && styles.rowSelected]}
                  onPress={() => (compareMode ? toggleSelect(item.id) : openOne(item.id))}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>
                      {label || `Stint ${formatDate(item.savedAt)}`}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {formatDate(item.savedAt)}
                      {item.lane != null && ` · carril ${item.lane}`}
                      {' · '}{item.lapCount} vueltas
                    </Text>
                    <Text style={styles.rowStats}>
                      mejor {fmt(item.bestMs)} · media {fmt(item.avgMs)}
                    </Text>
                  </View>
                  {compareMode && (
                    <View style={[styles.check, isSel && styles.checkOn]}>
                      {isSel && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
          {compareMode && (
            <TouchableOpacity
              style={[styles.compareBtn, selected.length < 2 && styles.compareBtnDisabled]}
              disabled={selected.length < 2}
              onPress={openComparison}
            >
              <Text style={styles.compareBtnText}>
                Comparar {selected.length} stints
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4,
  },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700' },
  compareToggle: { color: '#f6c90e', fontSize: 15, fontWeight: '600' },
  hint: { color: '#9aa3ad', fontSize: 13, marginTop: 8 },
  empty: {
    color: '#9aa3ad', fontSize: 14, textAlign: 'center',
    marginTop: 48, lineHeight: 22,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141923', paddingVertical: 14, paddingHorizontal: 16,
    marginVertical: 6, borderRadius: 8,
  },
  rowSelected: { borderWidth: 1, borderColor: '#f6c90e' },
  rowName: { color: '#fff', fontSize: 17, fontWeight: '600' },
  rowMeta: { color: '#9aa3ad', fontSize: 12, marginTop: 4 },
  rowStats: { color: '#cfd5dc', fontSize: 13, marginTop: 4 },
  check: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    borderColor: '#3a4350', alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: '#f6c90e', borderColor: '#f6c90e' },
  checkMark: { color: '#0a0d13', fontSize: 15, fontWeight: '800' },
  compareBtn: {
    backgroundColor: '#f6c90e', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', marginBottom: 8,
  },
  compareBtnDisabled: { opacity: 0.4 },
  compareBtnText: { color: '#0a0d13', fontSize: 16, fontWeight: '700' },
});
