// Histórico local de carreras pasadas. Funciona offline — los datos los
// guardó la app cuando llegaba el `race:stats-snapshot` del servidor.

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { listHistory, type HistoryEntryMeta } from '../data/historyStore';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function HistoryScreen({ navigation }: Props) {
  const [entries, setEntries] = useState<HistoryEntryMeta[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listHistory().then(list => { if (!cancelled) setEntries(list); });
      return () => { cancelled = true; };
    }, []),
  );

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>Histórico</Text>
      {entries === null ? (
        <Text style={styles.empty}>Cargando…</Text>
      ) : entries.length === 0 ? (
        <Text style={styles.empty}>
          Aún no tienes carreras guardadas.{'\n'}
          Las carreras terminadas en SlotTime se guardan aquí automáticamente.
        </Text>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={e => String(e.raceId)}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.push('HistoryDetail', { raceId: item.raceId })}
            >
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.format === 'team' ? 'Equipos' : 'Pilotos'} · {formatDate(item.finishedAt)}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4 },
  empty: {
    color: '#9aa3ad', fontSize: 14, textAlign: 'center',
    marginTop: 48, lineHeight: 22,
  },
  row: {
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 6, borderRadius: 8,
  },
  rowName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowMeta: { color: '#9aa3ad', fontSize: 12, marginTop: 4 },
});
