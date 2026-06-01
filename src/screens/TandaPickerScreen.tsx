// Selector de tanda dentro de una carrera. Carga el detalle de la carrera
// (incluyendo plan completo de mangas por participante) y deriva las tandas
// únicas. Si solo hay una, salta automáticamente a Select.
//
// Es también donde finalmente se crea el `SlotTimeSource` y se guarda en
// el context — la fuente necesita la carrera concreta para arrancar el
// socket.io y filtrar el state al participante elegido.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { SlotTimeSource } from '../data/SlotTimeSource';
import { useDataSource } from '../data/sourceContext';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'TandaPicker'>;

export default function TandaPickerScreen({ route, navigation }: Props) {
  const { host, port, raceId } = route.params;
  const { setSource } = useDataSource();
  const [tandas, setTandas] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Hacemos una "preview" del detalle de la carrera SOLO para conocer
    // las tandas. La conexión real del source se hace cuando el usuario
    // elige tanda (o automáticamente si solo hay una).
    fetch(`http://${host}:${port}/api/mobile/races/${raceId}`)
      .then(r => r.json())
      .then((data: { participants: { mangas: { tandaNum: number; isRest: boolean }[] }[] }) => {
        if (cancelled) return;
        const set = new Set<number>();
        for (const p of data.participants ?? []) {
          for (const m of p.mangas ?? []) {
            if (!m.isRest) set.add(m.tandaNum);
          }
        }
        const list = [...set].sort((a, b) => a - b);
        setTandas(list);
        if (list.length === 1) {
          // Solo una tanda → conectamos y vamos directos a Select.
          void connectAndGo(list[0]!);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? String(err));
      });
    return () => { cancelled = true; };
  }, [host, port, raceId]);

  async function connectAndGo(tandaNum: number) {
    setConnecting(true);
    try {
      const src = new SlotTimeSource({ host, port }, raceId);
      const raceInfo = await src.connect();
      setSource(src, raceInfo);
      // Si entramos en TandaPicker con 1 sola tanda, esta pantalla se
      // auto-saltó → usamos replace para que back vaya a RacePicker
      // (o Discovery si solo había 1 carrera). Si el usuario eligió tanda
      // de una lista, usamos push.
      if (tandas?.length === 1) {
        navigation.replace('Select', { tandaNum });
      } else {
        navigation.push('Select', { tandaNum });
      }
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      // Importante: al volver atrás desde Select, esta pantalla sigue
      // montada (native-stack la conserva). Si dejamos `connecting=true`
      // se queda con el spinner para siempre.
      setConnecting(false);
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

  if (tandas === null || connecting) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#f6c90e" />
          <Text style={styles.loading}>{connecting ? 'Conectando…' : 'Cargando tandas…'}</Text>
        </View>
      </View>
    );
  }

  if (tandas.length === 0) {
    return (
      <View style={styles.root}>
        <BackButton />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Sin tandas</Text>
          <Text style={styles.errorBody}>Esta carrera no tiene tandas configuradas.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>Elige tanda</Text>
      <FlatList
        data={tandas}
        keyExtractor={t => String(t)}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => connectAndGo(item)}>
            <Text style={styles.rowName}>Tanda {item}</Text>
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
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 6, borderRadius: 8,
  },
  rowName: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
