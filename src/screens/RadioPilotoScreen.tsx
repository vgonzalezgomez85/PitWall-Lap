// Pantalla del piloto en la sala: corre con el coche y escucha los tiempos.
//
// Recibe los tiempos del asistente a través de la fuente `AsistenteSource`
// (D8) y los anuncia con `useVoice()` (la locución reutiliza el motor de voz
// de la app: habla en cada `lap-completed`). No hay botón de vuelta aquí — el
// piloto no mira la pantalla en pista; solo oye.

import { useEffect, useRef } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useDataSource } from '../data/sourceContext';
import { useIdioma } from '../i18n/IdiomaContext';
import { useRadio } from '../radio/RadioContext';
import { useAsistenteSource } from '../radio/useAsistenteSource';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Stat from '../ui/Stat';
import { colors, spacing, type } from '../ui/theme';
import { useVoice } from '../voice/useVoice';
import { fmtTime } from '../voice/speak';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RadioPiloto'>;

export default function RadioPilotoScreen({ navigation }: Props) {
  const { t } = useIdioma();
  const { codigo, nombre, participantes, conectado, salir } = useRadio();
  const { state } = useDataSource();

  // Fuente de tiempos + locución (voz en cada vuelta).
  useAsistenteSource(nombre);
  useVoice();

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
          {t.radio.conectadoComo(t.radio.piloto)} · {nombre}
        </Text>
      </View>

      {/* Tiempos en vivo (del asistente, vía AsistenteSource). */}
      <Card style={styles.tiempos}>
        {state.lapCount === 0 ? (
          <Text style={styles.esperando}>{t.radio.esperandoTiempos}</Text>
        ) : (
          <>
            <Text style={type.label}>{t.radio.ultima}</Text>
            <Text style={styles.ultima} numberOfLines={1} adjustsFontSizeToFit>
              {fmtTime(state.lastLapMs)}
            </Text>
            <View style={styles.statsRow}>
              <Stat
                label={t.radio.mejorVuelta}
                value={fmtTime(state.bestLapMs)}
                color={state.bestLapMs != null ? colors.best : undefined}
              />
              <Stat label={t.comun.tituloMedia} value={fmtTime(state.avgLapMs)} />
              <Stat label={t.comun.tituloVueltas} value={String(state.lapCount)} />
            </View>
          </>
        )}
      </Card>

      {/* Conectados. */}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 40 },

  header: { marginTop: spacing.xs },
  conectadoComo: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },

  tiempos: { marginTop: spacing.lg, alignItems: 'stretch' },
  esperando: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  ultima: {
    color: colors.text, fontSize: 64, fontWeight: '800', textAlign: 'center',
    marginTop: spacing.xs, marginBottom: spacing.lg, fontVariant: ['tabular-nums'],
  },
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
