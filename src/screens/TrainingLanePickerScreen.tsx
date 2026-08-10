// Selector de carril cuando el servidor PitWall está en modo
// entrenamiento. Cada carril es un "participante" — al elegirlo, se
// crea el PitWallSource en modo 'training' y vamos a MyTurn.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { PitWallSource } from '../data/PitWallSource';
import { useDataSource } from '../data/sourceContext';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'TrainingLanePicker'>;

interface TrainingLane {
  lane: number;
  color: string;
  count: number;
  avgMs: number | null;
  bestMs: number | null;
}

interface TrainingStatus {
  active: boolean;
  durationMs: number | null;
  lanes: TrainingLane[];
}

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const totalCs = Math.round(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

export default function TrainingLanePickerScreen({ route, navigation }: Props) {
  const { host, port } = route.params;
  const { setSource } = useDataSource();
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`http://${host}:${port}/api/mobile/training`)
      .then(r => r.json())
      .then((data: TrainingStatus) => { if (!cancelled) setStatus(data); })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); });
    return () => { cancelled = true; };
  }, [host, port]);

  async function pickLane(lane: number) {
    setConnecting(true);
    try {
      const src = new PitWallSource({ host, port }, { mode: 'training' });
      const raceInfo = await src.connect();
      setSource(src, raceInfo);
      src.selectParticipant(String(lane));
      navigation.replace('MyTurn');
    } catch (err) {
      setConnecting(false);
      setError((err as Error)?.message ?? String(err));
    }
  }

  if (error) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorBody}>{error}</Text>
        </View>
      </View>
    );
  }

  if (!status || connecting) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#f6c90e" />
          <Text style={styles.loading}>{connecting ? 'Conectando…' : 'Cargando carriles…'}</Text>
        </View>
      </View>
    );
  }

  if (!status.active || status.lanes.length === 0) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Entrenamiento no activo</Text>
          <Text style={styles.errorBody}>
            El servidor PitWall no tiene una sesión de entrenamiento activa ahora mismo.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>Entrenamiento</Text>
      <Text style={styles.subtitle}>Elige tu carril</Text>
      <FlatList
        data={status.lanes}
        keyExtractor={l => String(l.lane)}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { borderLeftColor: item.color }]}
            onPress={() => pickLane(item.lane)}
          >
            <Text style={styles.rowName}>Carril {item.lane}</Text>
            <Text style={styles.rowMeta}>
              {item.count} vueltas · mejor {fmt(item.bestMs)} · media {fmt(item.avgMs)}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#9aa3ad', fontSize: 14, marginTop: 6 },
  loading: { color: '#cfd5dc', fontSize: 14, marginTop: 12 },
  errorTitle: { color: '#ff6b6b', fontSize: 20, fontWeight: '600' },
  errorBody: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  row: {
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 6, borderRadius: 8, borderLeftWidth: 4,
  },
  rowName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowMeta: { color: '#9aa3ad', fontSize: 12, marginTop: 4 },
});
