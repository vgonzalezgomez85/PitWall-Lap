// Selector de carrera (sólo PitWall). Carga la lista de carreras activas
// y pendientes del servidor. Si sólo hay una, salta automáticamente al
// selector de tanda. Si hay varias, deja al usuario elegir.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';
import { colors } from '../ui/theme';

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
  const [refrescando, setRefrescando] = useState(false);
  const { t } = useIdioma();

  // Solo vale la respuesta de la última petición, y ninguna tras salir.
  const peticion = useRef(0);
  useEffect(() => () => { peticion.current = -1; }, []);

  /**
   * Pide las carreras y el entrenamiento activos. `saltar` aplica los atajos de
   * siempre (una sola actividad → directo a ella); al refrescar desde una lista
   * que ya tenía actividades no se salta, para no mover al usuario de pantalla.
   */
  const cargar = useCallback((saltar: boolean) => {
    const mia = ++peticion.current;
    setError(null);
    return Promise.all([
      fetch(`http://${host}:${port}/api/mobile/races/active`).then(r => r.json()),
      fetch(`http://${host}:${port}/api/mobile/training`).then(r => r.json()),
    ])
      .then(([racesData, trainingData]: [{ races: RaceBrief[] }, { active: boolean }]) => {
        if (peticion.current !== mia) return;
        const list = racesData.races ?? [];
        setRaces(list);
        setTrainingActive(!!trainingData.active);
        if (!saltar) return;

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
        if (peticion.current === mia) setError(err?.message ?? String(err));
      });
  }, [host, port, navigation]);

  useEffect(() => { void cargar(true); }, [cargar]);

  // Botón "Actualizar" / tirar de la lista. Desde "sin actividad" o un error sí
  // se aplican los atajos: no había nada que elegir y ahora puede haberlo.
  const sinNada = error != null || (races != null && races.length === 0 && !trainingActive);
  const actualizar = useCallback(async () => {
    setRefrescando(true);
    await cargar(sinNada);
    setRefrescando(false);
  }, [cargar, sinNada]);

  const botonActualizar = (
    <TouchableOpacity
      style={[styles.refresh, refrescando && styles.refreshBusy]}
      onPress={actualizar}
      disabled={refrescando}
    >
      {refrescando
        ? <ActivityIndicator size="small" color={colors.accent} />
        : <Text style={styles.refreshText}>↻ {t.carreras.actualizar}</Text>}
    </TouchableOpacity>
  );

  if (error) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>{t.comun.error}</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <View style={{ marginTop: 16 }}>{botonActualizar}</View>
        </View>
      </View>
    );
  }

  if (races === null) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loading}>{t.carreras.cargando}</Text>
        </View>
      </View>
    );
  }

  if (races.length === 0 && !trainingActive) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>{t.carreras.sinActividad}</Text>
          <Text style={styles.errorBody}>{t.carreras.sinActividadTexto}</Text>
          <View style={{ marginTop: 16 }}>{botonActualizar}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <View style={styles.header}>
        <Text style={[styles.title, styles.headerTitle]}>{t.carreras.eligeActividad}</Text>
        {botonActualizar}
      </View>
      <FlatList
        data={races}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={{ paddingVertical: 12 }}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={actualizar} tintColor={colors.accent} />
        }
        ListHeaderComponent={trainingActive ? (
          <TouchableOpacity
            style={[styles.row, styles.trainingRow]}
            onPress={() => navigation.push('TrainingLanePicker', { host, port })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{t.comun.entrenamiento}</Text>
              <Text style={styles.rowMeta}>{t.carreras.sesionLibre}</Text>
            </View>
            <View style={[styles.badge, styles.badgeActive]}>
              <Text style={[styles.badgeText, styles.badgeTextActive]}>{t.carreras.activo}</Text>
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
                {item.format === 'team' ? t.comun.equipos : t.comun.pilotos} · {item.participantsCount} ·{' '}
                {t.carreras.tandas(item.tandasCount)} ·{' '}
                {t.carreras.minPorManga(item.mangaDurationMin)}
              </Text>
            </View>
            {item.hasPole && (
              <View style={[styles.badge, styles.badgePole]}>
                <Text style={[styles.badgeText, styles.badgeTextPole]}>POLE</Text>
              </View>
            )}
            <View style={[styles.badge, item.status === 'active' ? styles.badgeActive : styles.badgePending, { marginLeft: 6 }]}>
              <Text style={[styles.badgeText, item.status === 'active' ? styles.badgeTextActive : styles.badgeTextPending]}>
                {item.status === 'active' ? t.carreras.enCurso : t.carreras.pendiente}
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
  title: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 12 },
  loading: { color: '#cfd5dc', fontSize: 14, marginTop: 12 },
  errorTitle: { color: '#ff6b6b', fontSize: 20, fontWeight: '600' },
  errorBody: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  btn: { marginTop: 24, paddingHorizontal: 28, paddingVertical: 12, backgroundColor: colors.accentFill, borderRadius: 8 },
  btnText: { color: colors.onAccent, fontWeight: '700', fontSize: 16 },
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
  badgePole: { backgroundColor: colors.accentSoft },
  badgeTextPole: { color: colors.accent },

  trainingRow: { borderLeftWidth: 4, borderLeftColor: '#22c55e' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerTitle: { flex: 1 },
  refresh: {
    minWidth: 112, minHeight: 40, paddingHorizontal: 14, marginTop: 12,
    borderRadius: 8, borderWidth: 1, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  refreshBusy: { opacity: 0.6 },
  refreshText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
});
