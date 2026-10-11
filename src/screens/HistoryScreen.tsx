// Resultados de carreras. Combina lo guardado localmente (offline) con la
// lista del servidor (si es accesible), para poder abrir también carreras que
// no seguiste en vivo o desde un móvil nuevo, y los archivos (Excel, PDF o
// foto) que el piloto sube a mano.

import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ArchivoResultado } from '../data/archivosResultados';
import { anadirArchivo, listArchivos } from '../data/archivosResultadosStore';
import { listHistory } from '../data/historyStore';
import { getCachedHost } from '../data/discovery';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import type { RootStackParamList } from '../navigation';
import { colors } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

interface Row {
  raceId: number | string;
  name: string;
  format: 'team' | 'individual';
  finishedAt: string | null;
  local: boolean;   // true = dossier guardado en el móvil (offline)
  archivo?: ArchivoResultado;   // presente = archivo subido a mano
}

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function loadRows(): Promise<Row[]> {
  const local = await listHistory();
  const rows: Row[] = local.map(e => ({
    raceId: e.raceId, name: e.name, format: e.format,
    finishedAt: e.finishedAt, local: true,
  }));
  const localIds = new Set(local.map(e => String(e.raceId)));

  // Añadir carreras del servidor que no tengamos en local (si es accesible).
  const host = await getCachedHost();
  if (host) {
    try {
      const res = await fetch(`http://${host}:3000/api/mobile/races`);
      if (res.ok) {
        const data: { races: { id: number; name: string; format: 'team' | 'individual'; finishedAt: string | null }[] } = await res.json();
        for (const r of data.races ?? []) {
          if (!localIds.has(String(r.id))) {
            rows.push({ raceId: r.id, name: r.name, format: r.format, finishedAt: r.finishedAt, local: false });
          }
        }
      }
    } catch { /* sin servidor: solo locales */ }
  }
  for (const a of await listArchivos()) {
    rows.push({
      raceId: a.id, name: a.nombre, format: 'individual',
      finishedAt: a.anadidoEn, local: true, archivo: a,
    });
  }
  rows.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  return rows;
}

export default function HistoryScreen({ navigation }: Props) {
  const [entries, setEntries] = useState<Row[] | null>(null);
  const { t, locale } = useIdioma();

  const tipoArchivo = (a: ArchivoResultado) => ({
    excel: t.resultados.tipoExcel,
    pdf: t.resultados.tipoPdf,
    imagen: t.resultados.tipoImagen,
    otro: t.resultados.tipoOtro,
  }[a.tipo]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadRows().then(list => { if (!cancelled) setEntries(list); });
      return () => { cancelled = true; };
    }, []),
  );

  async function recargarYAbrir(a: ArchivoResultado) {
    setEntries(await loadRows());
    navigation.push('ArchivoResultado', { id: a.id });
  }

  async function subirArchivo() {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'image/*',
        ],
        copyToCacheDirectory: true,
      });
      const f = r.canceled ? null : r.assets[0];
      if (!f) return;
      await recargarYAbrir(await anadirArchivo(f.uri, f.name, f.mimeType));
    } catch {
      Alert.alert(t.comun.error, t.resultados.errorAnadir);
    }
  }

  async function subirFoto(camara: boolean) {
    try {
      if (camara) {
        const permiso = await ImagePicker.requestCameraPermissionsAsync();
        if (!permiso.granted) {
          Alert.alert(t.comun.error, t.resultados.sinPermisoCamara);
          return;
        }
      }
      const opciones: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
      const r = camara
        ? await ImagePicker.launchCameraAsync(opciones)
        : await ImagePicker.launchImageLibraryAsync(opciones);
      const f = r.canceled ? null : r.assets[0];
      if (!f) return;
      const nombre = f.fileName ?? `${t.resultados.tipoImagen} ${Date.now()}.jpg`;
      await recargarYAbrir(await anadirArchivo(f.uri, nombre, f.mimeType ?? 'image/jpeg'));
    } catch {
      Alert.alert(t.comun.error, t.resultados.errorAnadir);
    }
  }

  function anadir() {
    Alert.alert(t.resultados.anadir, undefined, [
      { text: t.resultados.archivo, onPress: subirArchivo },
      { text: t.resultados.fotoGaleria, onPress: () => subirFoto(false) },
      { text: t.resultados.hacerFoto, onPress: () => subirFoto(true) },
      { text: t.comun.cancelar, style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>{t.resultados.titulo}</Text>
      <TouchableOpacity style={styles.addBtn} onPress={anadir}>
        <Text style={styles.addBtnText}>＋ {t.resultados.anadir}</Text>
      </TouchableOpacity>
      {entries === null ? (
        <Text style={styles.empty}>{t.comun.cargando}</Text>
      ) : entries.length === 0 ? (
        <Text style={styles.empty}>{t.resultados.vacio}</Text>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={e => `${e.archivo ? 'a' : 'r'}-${e.raceId}`}
          contentContainerStyle={{ paddingVertical: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => item.archivo
                ? navigation.push('ArchivoResultado', { id: item.archivo.id })
                : navigation.push('HistoryDetail', { raceId: item.raceId })}
            >
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.archivo
                  ? `📎 ${tipoArchivo(item.archivo)} · ${t.resultados.subidoPorMi} · `
                  : `${item.format === 'team' ? t.comun.equipos : t.comun.pilotos} · `}
                {formatDate(item.finishedAt, locale)}
                {!item.local && `  ·  ${t.historial.enServidor}`}
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
  title: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  addBtn: {
    marginTop: 16, marginBottom: 4, paddingVertical: 14, borderRadius: 8,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  addBtnText: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
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
