// Pantalla del seguidor: solo mira los tiempos y ve quién hay conectado, sin
// locución. Recibe los tiempos del asistente a través de `AsistenteSource`,
// igual que el piloto, pero no activa el motor de voz.

import { useEffect, useRef } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useDataSource } from '../data/sourceContext';
import { useIdioma } from '../i18n/IdiomaContext';
import { useRadio } from '../radio/RadioContext';
import { AudioRemoto } from '../radio/AudioRemoto';
import { useAsistenteSource } from '../radio/useAsistenteSource';
import { useVozRadio } from '../radio/useVozRadio';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Stat from '../ui/Stat';
import { colors, spacing, type } from '../ui/theme';
import { fmtTime } from '../voice/speak';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RadioSeguidor'>;

export default function RadioSeguidorScreen({ navigation }: Props) {
  const { t } = useIdioma();
  const { codigo, nombre, participantes, conectado, salir } = useRadio();
  const { state } = useDataSource();

  useAsistenteSource(nombre);
  const { pistas } = useVozRadio();

  // Al salir de la pantalla (gesto atrás, swipe), dejamos la sala libre.
  const salirRef = useRef(salir);
  salirRef.current = salir;
  useEffect(() => {
    return navigation.addListener('beforeRemove', () => salirRef.current());
  }, [navigation]);

  // Si la sala se cerró (o salimos), volvemos al hub.
  useEffect(() => {
    if (!conectado) navigation.replace('Radio');
  }, [conectado, navigation]);

  function confirmarSalir() {
    Alert.alert(t.radio.salir, t.radio.salirTexto, [
      { text: t.comun.cancelar, style: 'cancel' },
      { text: t.radio.salir, style: 'destructive', onPress: salir },
    ]);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={type.label}>{t.radio.titulo}</Text>
        <Text style={type.heading}>{t.radio.sala(codigo)}</Text>
        <Text style={styles.conectadoComo}>
          {t.radio.conectadoComo(t.radio.seguidor)} · {nombre}
        </Text>
      </View>

      <Card style={styles.tiempos}>
        {state.lapCount === 0 ? (
          <Text style={styles.esperando}>{t.radio.esperandoTiempos}</Text>
        ) : (
          <View style={styles.statsRow}>
            <Stat
              label={t.radio.mejorVuelta}
              value={fmtTime(state.bestLapMs)}
              color={state.bestLapMs != null ? colors.best : undefined}
            />
            <Stat label={t.comun.tituloMedia} value={fmtTime(state.avgLapMs)} />
            <Stat label={t.comun.tituloVueltas} value={String(state.lapCount)} />
          </View>
        )}
      </Card>

      <Card>
        <Text style={type.label}>{t.radio.conectados}</Text>
        {participantes.length === 0 ? (
          <Text style={styles.nadie}>{t.radio.nadie}</Text>
        ) : (
          participantes.map(p => (
            <View key={p.id} style={styles.participante}>
              <Text style={styles.participanteNombre}>{p.nombre}</Text>
              <Text style={styles.participanteRol}>
                {p.rol === 'piloto' ? t.radio.piloto : t.radio.seguidor}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Button label={t.radio.salir} variant="danger" onPress={confirmarSalir} style={styles.salir} />

      {/* Reproduce la voz del asistente (RTCView invisible). */}
      <AudioRemoto pistas={pistas} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 40 },

  header: { marginTop: spacing.xs },
  conectadoComo: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },

  tiempos: { marginTop: spacing.lg },
  esperando: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  statsRow: { flexDirection: 'row', gap: spacing.md },

  nadie: { ...type.body, color: colors.textMuted, marginTop: spacing.sm },
  participante: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  participanteNombre: { color: colors.text, fontSize: 16, fontWeight: '600' },
  participanteRol: { color: colors.textMuted, fontSize: 13 },

  salir: { marginTop: spacing.xxl },
});
