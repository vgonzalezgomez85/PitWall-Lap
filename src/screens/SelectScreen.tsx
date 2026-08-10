// Selector de piloto/equipo. Si la navegación trae `tandaNum`, filtra los
// participantes a los que corren en esa tanda (solo aplica a PitWall; en
// InfoLap no se pasa tanda y se ven todos).

import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useDataSource } from '../data/sourceContext';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Select'>;

export default function SelectScreen({ route, navigation }: Props) {
  const { source, raceInfo } = useDataSource();
  const tandaNum = route.params?.tandaNum;

  // Filtrar participantes por tanda si la ruta lo indica. Para PitWall
  // tenemos `participantsPlan` con info de mangas → comprobamos si el
  // participante corre en esa tanda. Para InfoLap o si no hay tanda,
  // pasamos todos.
  const participants = useMemo(() => {
    if (!raceInfo) return [];
    if (tandaNum == null || !raceInfo.participantsPlan) return raceInfo.participants;
    const idsInTanda = new Set(
      raceInfo.participantsPlan
        .filter(p => p.mangas.some(m => m.tandaNum === tandaNum && !m.isRest))
        .map(p => p.id),
    );
    return raceInfo.participants.filter(p => idsInTanda.has(p.id));
  }, [raceInfo, tandaNum]);

  if (!source || !raceInfo) {
    navigation.replace('Discovery');
    return null;
  }

  const onPick = (id: string) => {
    source.selectParticipant(id);
    navigation.push('MyTurn');
  };

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>{raceInfo.name}</Text>
      <Text style={styles.subtitle}>
        {tandaNum != null && `Tanda ${tandaNum} · `}
        Elige tu {raceInfo.format === 'team' ? 'equipo' : 'piloto'}
      </Text>
      <FlatList
        data={participants}
        keyExtractor={p => p.id}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { borderLeftColor: item.color ?? '#8b949e' }]}
            onPress={() => onPick(item.id)}
          >
            <Text style={styles.rowName}>{item.name}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No hay participantes en esta tanda.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 12 },
  subtitle: { color: '#9aa3ad', fontSize: 14, marginTop: 6, marginBottom: 8 },
  row: {
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 6, borderRadius: 8, borderLeftWidth: 4,
  },
  rowName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  empty: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', marginTop: 32 },
});
