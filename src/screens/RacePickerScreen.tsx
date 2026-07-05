// Selector de carrera (sólo SlotTime). Carga la lista de carreras activas
// y pendientes del servidor. Si sólo hay una, salta automáticamente al
// selector de tanda. Si hay varias, deja al usuario elegir.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RacePicker'>;

interface RaceBrief {
  id: number;
  name: string;
  format: 'team' | 'individual';
  status: 'active' | 'pending';
  lanesCount: number;
  mangaDurationMin: number;
  tandasCount: number;
  participantsCount: number;
  hasPole?: boolean;
}

export default function RacePickerScreen({ route, navigation }: Props) {
  const { host, port } = route.params;
  const [races, setRaces] = useState<RaceBrief[] | null>(null);
  const [trainingActive, setTrainingActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`http://${host}:${port}/api/mobile/races/active`).then(r => r.json()),
      fetch(`http://${host}:${port}/api/mobile/training`).then(r => r.json()),
    ])
      .then(([racesData, trainingData]: [{ races: RaceBrief[] }, { active: boolean }]) => {
        if (cancelled) return;
        const list = racesData.races ?? [];
        setRaces(list);
        setTrainingActive(!!trainingData.active);

        // Si no hay carreras y hay entrenamiento → directo al selector
        // de carriles de entrenamiento.
        if (list.length === 0 && trainingData.active) {
          navigation.replace('TrainingLanePicker', { host, port });
          return;
        }
        // Si solo hay una carrera y no hay entrenamiento → directo a su
        // destino (pole o selector de tanda).
        if (list.length === 1 && !trainingData.active) {
          const r = list[0]!;
          if (r.hasPole) {
            navigation.replace('Pole', { host, port, raceId: r.id });
          } else {
            navigation.replace('TandaPicker', { host, port, raceId: r.id });
          }
        }
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? String(err));
      });
    return () => { cancelled = true; };
  }, [host, port, navigation]);

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

  if (races === null) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#f6c90e" />
          <Text style={styles.loading}>Cargando carreras…</Text>
        </View>
      </View>
    );
  }

  if (races.length === 0 && !trainingActive) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Sin actividad</Text>
          <Text style={styles.errorBody}>
            El servidor PitWall no tiene carreras preparadas ni una sesión de entrenamiento activa.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>Elige actividad</Text>
      <FlatList
        data={races}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={{ paddingVertical: 12 }}
        ListHeaderComponent={trainingActive ? (
          <TouchableOpacity
            style={[styles.row, styles.trainingRow]}
            onPress={() => navigation.push('TrainingLanePicker', { host, port })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>Entrenamiento</Text>
              <Text style={styles.rowMeta}>Sesión libre · elige tu carril</Text>
            </View>
            <View style={[styles.badge, styles.badgeActive]}>
              <Text style={[styles.badgeText, styles.badgeTextActive]}>Activo</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              if (item.hasPole) {
                navigation.push('Pole', { host, port, raceId: item.id });
              } else {
                navigation.push('TandaPicker', { host, port, raceId: item.id });
              }
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.format === 'team' ? 'Equipos' : 'Pilotos'} · {item.participantsCount} ·{' '}
                {item.tandasCount} {item.tandasCount === 1 ? 'tanda' : 'tandas'} ·{' '}
                {item.mangaDurationMin} min/manga
              </Text>
            </View>
            {item.hasPole && (
              <View style={[styles.badge, styles.badgePole]}>
                <Text style={[styles.badgeText, styles.badgeTextPole]}>POLE</Text>
              </View>
            )}
            <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgePending, { marginLeft: 6 }]}>
              <Text style={[styles.badgeText, item.status === 'active' ? styles.badgeTextActive : styles.badgeTextPending]}>
                {item.status === 'active' ? 'En curso' : 'Pendiente'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0a0d13' },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 12 },
  loading: { color: '#cfd5dc', fontSize: 14, marginTop: 12 },
  errorTitle: { color: '#ff6b6b', fontSize: 20, fontWeight: '600' },
  errorBody: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  btn: { marginTop: 24, paddingHorizontal: 28, paddingVertical: 12, backgroundColor: '#f6c90e', borderRadius: 8 },
  btnText: { color: '#0a0d13', fontWeight: '700', fontSize: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 6, borderRadius: 8,
  },
  rowName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowMeta: { color: '#9aa3ad', fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeActive: { backgroundColor: '#1f3a1f' },
  badgePending: { backgroundColor: '#2a2a2a' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextActive: { color: '#5fd167' },
  badgeTextPending: { color: '#9aa3ad' },
  badgePole: { backgroundColor: '#3a2a00' },
  badgeTextPole: { color: '#f6c90e' },

  trainingRow: { borderLeftWidth: 4, borderLeftColor: '#22c55e' },
});
