// Detalle de una carrera pasada (clasificación final + datos por
// participante). Lee del store local — no necesita servidor online.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getSnapshot } from '../data/historyStore';
import type { RaceStatsSnapshot } from '../data/types';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'HistoryDetail'>;

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  const totalCs = Math.round(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function HistoryDetailScreen({ route }: Props) {
  const { raceId } = route.params;
  const [snap, setSnap] = useState<RaceStatsSnapshot | null | undefined>(undefined);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getSnapshot(raceId).then(setSnap);
  }, [raceId]);

  async function downloadExcel() {
    if (!snap?.excelPath || !snap.serverBaseUrl) return;
    setDownloading(true);
    try {
      const url = `${snap.serverBaseUrl}${snap.excelPath}`;
      const filename = `${(snap.name || 'carrera').replace(/[^\w-]+/g, '_')}.xlsx`;
      const dir = new Directory(Paths.cache);
      const file = await File.downloadFileAsync(url, new File(dir, filename));
      const can = await Sharing.isAvailableAsync();
      if (!can) {
        Alert.alert('Compartir no disponible', 'Tu dispositivo no soporta compartir archivos.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: snap.name,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (e) {
      Alert.alert('Error', (e as Error)?.message ?? String(e));
    } finally {
      setDownloading(false);
    }
  }

  if (snap === undefined) {
    return (
      <View style={styles.center}>
        <BackButton />
        <ActivityIndicator size="large" color="#f6c90e" />
      </View>
    );
  }
  if (snap === null) {
    return (
      <View style={styles.center}>
        <BackButton />
        <Text style={styles.error}>No se encontró esta carrera en el histórico local.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>{snap.name}</Text>
      <Text style={styles.subtitle}>
        {snap.format === 'team' ? 'Por equipos' : 'Individual'} · {formatDate(snap.finishedAt)}
      </Text>

      {snap.excelPath && snap.serverBaseUrl && (
        <TouchableOpacity
          style={[styles.excelBtn, downloading && styles.excelBtnDisabled]}
          onPress={downloadExcel}
          disabled={downloading}
        >
          <Text style={styles.excelBtnText}>
            {downloading ? 'Descargando…' : 'Descargar Excel comparativa'}
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={snap.standings}
        keyExtractor={s => `${s.entityType}-${s.entityId}`}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderLeftColor: item.color ?? '#8b949e' }]}>
            <View style={styles.posCol}>
              <Text style={styles.pos}>{item.position}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.totalLaps} vueltas · mejor {fmtMs(item.bestLapMs)}
                {item.avgLapMs != null && ` · media ${fmtMs(item.avgLapMs)}`}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  center: { flex: 1, padding: 20, backgroundColor: '#0a0d13', alignItems: 'center', justifyContent: 'center' },
  title:    { color: '#f6c90e', fontSize: 24, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#9aa3ad', fontSize: 13, marginTop: 4 },
  error:    { color: '#ff6b6b', fontSize: 14, textAlign: 'center', marginTop: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141923', paddingVertical: 14, paddingHorizontal: 14,
    marginVertical: 4, borderRadius: 8, borderLeftWidth: 4,
  },
  posCol:  { width: 36 },
  pos:     { color: '#f6c90e', fontSize: 22, fontWeight: '800' },
  rowName: { color: '#fff', fontSize: 17, fontWeight: '600' },
  rowMeta: { color: '#9aa3ad', fontSize: 12, marginTop: 4 },

  excelBtn: {
    marginTop: 16, paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: '#1f5f2a', borderRadius: 8, alignItems: 'center',
  },
  excelBtnDisabled: { opacity: 0.5 },
  excelBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
