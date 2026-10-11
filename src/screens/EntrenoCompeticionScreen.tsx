// Detalle de un entreno de competición descargado: clasificación de la sesión y,
// heat a heat, lo que hizo cada carril. Funciona sin conexión.

import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { EntrenoCompeticion } from '../data/entrenoCompeticion';
import {
  deleteEntrenoCompeticion, getEntrenoCompeticion,
} from '../data/entrenoCompeticionStore';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import Section from '../ui/Section';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EntrenoCompeticion'>;

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

export default function EntrenoCompeticionScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const { t, locale } = useIdioma();
  const [entreno, setEntreno] = useState<EntrenoCompeticion | null | undefined>(undefined);

  useEffect(() => {
    getEntrenoCompeticion(id).then(setEntreno);
  }, [id]);

  if (entreno === undefined) return <View style={styles.root} />;
  if (entreno === null) {
    return (
      <View style={styles.root}>
        <BackButton />
        <Text style={styles.vacio}>{t.entrenoComp.noEncontrado}</Text>
      </View>
    );
  }

  const fmtFecha = (iso: string | null) => (iso
    ? new Date(iso).toLocaleString(locale, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '');

  function borrar() {
    Alert.alert(t.entrenoComp.borrar, t.entrenoComp.borrarTexto, [
      { text: t.comun.cancelar, style: 'cancel' },
      {
        text: t.entrenoComp.borrar, style: 'destructive',
        onPress: async () => {
          await deleteEntrenoCompeticion(id);
          navigation.goBack();
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <BackButton />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.contenido}>
        <Text style={styles.titulo}>{fmtFecha(entreno.startedAt) || t.entrenoComp.titulo}</Text>
        <Text style={styles.sub}>{t.entrenoComp.descargadoEl(fmtFecha(entreno.descargadoEn))}</Text>

        <Section title={t.entrenoComp.clasificacion}>
          <Text style={styles.nota}>{t.entrenoComp.explicacion}</Text>
          <View style={styles.tabla}>
            <View style={[styles.fila, styles.cabecera]}>
              <Text style={[styles.cPos, styles.cabTexto]}>#</Text>
              <Text style={[styles.cNombre, styles.cabTexto]}>{t.entrenoComp.participante}</Text>
              <Text style={[styles.cNum, styles.cabTexto]}>{t.comun.tituloVueltas}</Text>
              <Text style={[styles.cNum, styles.cabTexto]}>{t.comun.tituloMejor}</Text>
              <Text style={[styles.cNum, styles.cabTexto]}>{t.comun.tituloMedia}</Text>
            </View>
            {entreno.standings.map(s => (
              <View key={s.name} style={styles.fila}>
                <Text style={[styles.cPos, styles.texto]}>{s.pos}</Text>
                <Text style={[styles.cNombre, styles.texto]} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.cNum, styles.texto]}>{s.laps}</Text>
                <Text style={[styles.cNum, styles.texto]}>{fmt(s.bestLapMs)}</Text>
                <Text style={[styles.cNum, styles.texto]}>{fmt(s.avgLapMs)}</Text>
              </View>
            ))}
          </View>
        </Section>

        {entreno.heats.map(h => (
          <Section key={h.heat} title={t.entrenoComp.heatN(h.heat)}>
            <View style={styles.tabla}>
              <View style={[styles.fila, styles.cabecera]}>
                <Text style={[styles.cPos, styles.cabTexto]}>{t.comun.tituloCarril.slice(0, 1)}</Text>
                <Text style={[styles.cNombre, styles.cabTexto]}>{t.entrenoComp.participante}</Text>
                <Text style={[styles.cNum, styles.cabTexto]}>{t.comun.tituloVueltas}</Text>
                <Text style={[styles.cNum, styles.cabTexto]}>{t.comun.tituloMejor}</Text>
                <Text style={[styles.cNum, styles.cabTexto]}>{t.comun.tituloMedia}</Text>
              </View>
              {h.lanes.map(l => (
                <View key={l.lane} style={styles.fila}>
                  <Text style={[styles.cPos, styles.texto]}>{l.lane}</Text>
                  <Text style={[styles.cNombre, styles.texto]} numberOfLines={1}>{l.name}</Text>
                  <Text style={[styles.cNum, styles.texto]}>{l.laps}</Text>
                  <Text style={[styles.cNum, styles.texto]}>{fmt(l.bestLapMs)}</Text>
                  <Text style={[styles.cNum, styles.texto]}>{fmt(l.avgLapMs)}</Text>
                </View>
              ))}
            </View>
          </Section>
        ))}

        <Pressable style={styles.borrar} onPress={borrar}>
          <Text style={styles.borrarTexto}>{t.entrenoComp.borrar}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, backgroundColor: colors.bg },
  contenido: { paddingBottom: spacing.xxl },
  titulo: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 4 },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 4, marginBottom: spacing.lg },
  vacio: {
    color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: 48, lineHeight: 22,
  },
  nota: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginBottom: spacing.sm },
  tabla: { backgroundColor: colors.surface, borderRadius: radius.sm, overflow: 'hidden' },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  cabecera: { backgroundColor: colors.surfaceRaised, borderTopWidth: 0 },
  cabTexto: { color: colors.textMuted, fontSize: 11, textTransform: 'uppercase' },
  texto: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  cPos: { width: 22 },
  cNombre: { flex: 1, minWidth: 0 },
  cNum: { width: 52, textAlign: 'right' },
  borrar: { marginTop: spacing.xl, paddingVertical: 12, alignItems: 'center' },
  borrarTexto: { color: colors.danger, fontSize: 15 },
});
