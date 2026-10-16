// Pantalla del asistente: cronómetro manual de la sala. El asistente es el
// centro de la red (D6) y la fuente de verdad de las vueltas (D8): pulsa
// «Vuelta» en cada cruce y el resto recibe los tiempos. Muestra también el
// código para que el equipo se una y quién está conectado.

import { useEffect, useRef } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useIdioma } from '../i18n/IdiomaContext';
import { useRadio } from '../radio/RadioContext';
import { fmtTime } from '../voice/speak';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Stat from '../ui/Stat';
import { colors, radius, spacing, type } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RadioAsistente'>;

export default function RadioAsistenteScreen({ navigation }: Props) {
  const { t } = useIdioma();
  const {
    codigo, nombre, participantes, vueltas, mejor, tandaIniciada,
    conectado, salir, pulsarVuelta, deshacerVuelta, terminarTanda,
  } = useRadio();

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

  const ultima = vueltas.length > 0 ? vueltas[vueltas.length - 1]!.ms : null;

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
          {t.radio.conectadoComo(t.radio.asistente)} · {nombre}
        </Text>
      </View>

      {/* Código para compartir con el equipo. */}
      <Card style={styles.codigoCard}>
        <Text style={type.label}>{t.radio.comparteCodigo}</Text>
        <Text style={styles.codigo} numberOfLines={1} adjustsFontSizeToFit>{codigo}</Text>
      </Card>

      {/* Botón grande de vuelta. */}
      <Pressable
        onPress={pulsarVuelta}
        style={({ pressed }) => [styles.vuelta, pressed && styles.vueltaPulsada]}
      >
        <Text style={styles.vueltaTexto}>{t.radio.vuelta}</Text>
        {!tandaIniciada && (
          <Text style={styles.vueltaSub}>{t.radio.esperandoInicio}</Text>
        )}
      </Pressable>

      {/* Tiempos. */}
      <Card>
        <View style={styles.statsRow}>
          <Stat label={t.radio.ultima} value={fmtTime(ultima)} />
          <Stat
            label={t.radio.mejorVuelta}
            value={fmtTime(mejor?.ms ?? null)}
            color={mejor ? colors.best : undefined}
          />
          <Stat label={t.comun.tituloVueltas} value={String(vueltas.length)} />
        </View>
      </Card>

      {/* Acciones. */}
      <View style={styles.acciones}>
        <Button
          label={t.radio.deshacer}
          variant="outline"
          onPress={deshacerVuelta}
          disabled={!tandaIniciada && vueltas.length === 0}
          style={styles.flex}
        />
        <Button
          label={t.radio.terminar}
          variant="ghost"
          onPress={terminarTanda}
          disabled={!tandaIniciada && vueltas.length === 0}
          style={styles.flex}
        />
      </View>

      {/* Conectados. */}
      <Card>
        <Text style={type.label}>{t.radio.conectados}</Text>
        {participantes.length === 0 ? (
          <Text style={styles.nadie}>{t.radio.nadie}</Text>
        ) : (
          participantes.map(p => (
            <View key={p.id} style={styles.participante}>
              <Text style={styles.participanteNombre}>{p.nombre}</Text>
              <Text style={styles.participanteRol}>{papelTexto(p.rol, t)}</Text>
            </View>
          ))
        )}
      </Card>

      <Button label={t.radio.salir} variant="danger" onPress={confirmarSalir} style={styles.salir} />
    </ScrollView>
  );
}

function papelTexto(rol: string, t: ReturnType<typeof useIdioma>['t']): string {
  if (rol === 'piloto') return t.radio.piloto;
  if (rol === 'seguidor') return t.radio.seguidor;
  return rol;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 40 },

  header: { marginTop: spacing.xs },
  conectadoComo: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },

  codigoCard: { marginTop: spacing.lg, alignItems: 'center' },
  codigo: {
    color: colors.text, fontSize: 40, fontWeight: '800', letterSpacing: 3,
    marginTop: spacing.sm, fontVariant: ['tabular-nums'],
  },

  vuelta: {
    marginTop: spacing.lg, paddingVertical: 28, borderRadius: radius.md,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  vueltaPulsada: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  vueltaTexto: { color: colors.onAccent, fontSize: 28, fontWeight: '800' },
  vueltaSub: { color: colors.onAccent, opacity: 0.85, fontSize: 13, marginTop: 4 },

  statsRow: { flexDirection: 'row', gap: spacing.md },

  acciones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  flex: { flex: 1 },

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
