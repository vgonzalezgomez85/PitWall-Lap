// Detalle de un archivo de resultados subido a mano (Excel, PDF o foto): se
// puede renombrar, abrir/compartir y borrar. Las fotos se ven en pantalla.

import { useEffect, useState } from 'react';
import {
  Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ArchivoResultado } from '../data/archivosResultados';
import {
  borrarArchivo, ficheroDe, getArchivo, renombrarArchivo,
} from '../data/archivosResultadosStore';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ArchivoResultado'>;

export default function ArchivoResultadoScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const { t } = useIdioma();
  const [archivo, setArchivo] = useState<ArchivoResultado | null | undefined>(undefined);
  const [nombre, setNombre] = useState('');

  useEffect(() => {
    getArchivo(id).then(a => {
      setArchivo(a);
      if (a) setNombre(a.nombre);
    });
  }, [id]);

  if (archivo === undefined) return <View style={styles.root} />;
  if (archivo === null) {
    return (
      <View style={styles.root}>
        <BackButton />
        <Text style={styles.vacio}>{t.resultados.noEncontrado}</Text>
      </View>
    );
  }

  const fichero = ficheroDe(archivo);
  const existe = fichero.exists;

  async function guardarNombre() {
    const limpio = nombre.trim();
    if (!archivo || !limpio || limpio === archivo.nombre) return;
    await renombrarArchivo(archivo.id, limpio);
    setArchivo({ ...archivo, nombre: limpio });
  }

  async function abrir() {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t.historial.compartirNoDisp, t.historial.compartirNoDispTexto);
        return;
      }
      await Sharing.shareAsync(fichero.uri, { dialogTitle: archivo?.nombre });
    } catch (e) {
      Alert.alert(t.comun.error, (e as Error)?.message ?? String(e));
    }
  }

  function borrar() {
    if (!archivo) return;
    Alert.alert(t.resultados.borrar, t.resultados.borrarTexto, [
      { text: t.comun.cancelar, style: 'cancel' },
      {
        text: t.resultados.borrar, style: 'destructive',
        onPress: async () => {
          await borrarArchivo(archivo.id);
          navigation.goBack();
        },
      },
    ]);
  }

  const etiquetaTipo = {
    excel: t.resultados.tipoExcel,
    pdf: t.resultados.tipoPdf,
    imagen: t.resultados.tipoImagen,
    otro: t.resultados.tipoOtro,
  }[archivo.tipo];

  return (
    <View style={styles.root}>
      <BackButton />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.tipo}>{etiquetaTipo}</Text>
        <Text style={styles.etiqueta}>{t.resultados.nombre}</Text>
        <TextInput
          style={styles.input}
          value={nombre}
          onChangeText={setNombre}
          onEndEditing={guardarNombre}
          returnKeyType="done"
        />

        {!existe ? (
          <Text style={styles.vacio}>{t.resultados.ficheroPerdido}</Text>
        ) : archivo.tipo === 'imagen' ? (
          <Image source={{ uri: fichero.uri }} style={styles.imagen} resizeMode="contain" />
        ) : null}

        {existe && (
          <Pressable style={styles.abrir} onPress={abrir}>
            <Text style={styles.abrirTexto}>{t.resultados.abrir}</Text>
          </Pressable>
        )}
        <Pressable style={styles.borrar} onPress={borrar}>
          <Text style={styles.borrarTexto}>{t.resultados.borrar}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, backgroundColor: colors.bg },
  tipo: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  etiqueta: {
    color: colors.textMuted, fontSize: 12, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface, color: colors.text, fontSize: 17,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.sm,
    borderColor: colors.border, borderWidth: 1,
  },
  imagen: { width: '100%', height: 420, marginTop: spacing.xl, borderRadius: radius.sm },
  vacio: {
    color: colors.textMuted, fontSize: 14, textAlign: 'center',
    marginTop: 48, lineHeight: 22,
  },
  abrir: {
    marginTop: spacing.xl, paddingVertical: 14, borderRadius: radius.sm,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  abrirTexto: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  borrar: { marginTop: spacing.lg, paddingVertical: 12, alignItems: 'center', marginBottom: spacing.xxl },
  borrarTexto: { color: colors.danger, fontSize: 15 },
});
