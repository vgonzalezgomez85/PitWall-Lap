// Pantalla única de sala de Radio: se adapta al rol en vivo (piloto, asistente
// o seguidor). Sustituye a las antiguas RadioAsistente / RadioPiloto /
// RadioSeguidor para que el rol pueda cambiarse durante la carrera sin cambiar
// de pantalla.
//
// La sala (TCP + WebRTC + participantes) vive en el `RadioProvider` global:
// salir hacia atrás solo navega y NO la deshace; únicamente el botón «Salir» (o
// que el hub cierre la sala / se pierda la conexión) la libera.

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Network from 'expo-network';

import { useDataSource } from '../data/sourceContext';
import { esFuentePista } from '../data/types';
import { useIdioma } from '../i18n/IdiomaContext';
import type { Textos } from '../i18n';
import { MedidorNivel } from '../radio/MedidorNivel';
import { useRadio } from '../radio/RadioContext';
import { useAsistenteSource } from '../radio/useAsistenteSource';
import type { Rol } from '../radio/mensajes';
import Button from '../ui/Button';
import BackButton from '../ui/BackButton';
import Card from '../ui/Card';
import Stat from '../ui/Stat';
import { colors, radius, spacing, type } from '../ui/theme';
import { useVoice } from '../voice/useVoice';
import { fmtTime } from '../voice/speak';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RadioSala'>;

/** Traduce el código interno de rol a su texto de UI. */
function papelTexto(rol: Rol, t: Textos): string {
  if (rol === 'piloto') return t.radio.piloto;
  if (rol === 'asistente') return t.radio.asistente;
  return t.radio.seguidor;
}

const ROLES: Rol[] = ['piloto', 'asistente', 'seguidor'];

export default function RadioSalaScreen({ navigation }: Props) {
  const { t } = useIdioma();
  const {
    rol, esHub, codigo, nombre, participantes, conectado, salir,
    cambiarRol, pulsarVuelta, deshacerVuelta, terminarTanda,
    tandaIniciada, vueltas, voz, tuId,
  } = useRadio();
  const { source, state } = useDataSource();
  const hayPista = esFuentePista(source?.kind);

  // Tiempos por la fuente «Asistente» (igual para hub y remotos) y locución.
  // Con «la pista manda», no instalamos el cronómetro propio si ya hay pista.
  useAsistenteSource(nombre, !hayPista);
  useVoice();

  const esAsistente = rol === 'asistente';

  // IP del hub en la red, para que entren a mano si la búsqueda no encuentra
  // la sala (el anuncio mDNS se pierde a menudo sin dar error).
  const [miIp, setMiIp] = useState('');
  useEffect(() => {
    if (!esHub) return;
    let vivo = true;
    Network.getIpAddressAsync()
      .then(ip => { if (vivo && ip && ip !== '0.0.0.0') setMiIp(ip); })
      .catch(() => { /* sin IP: solo se enseña el código */ });
    return () => { vivo = false; };
  }, [esHub]);

  // Estado de la tanda, coherente para el hub (cronómetro local) y para un
  // asistente remoto (lo ve reflejado en la fuente Asistente).
  const enMarcha = esHub ? tandaIniciada : state.status === 'my-turn';
  const hayLaps = esHub ? vueltas.length > 0 : state.lapCount > 0;

  // Si la sala se cerró (o salimos), volvemos al hub de Radio.
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
      <BackButton />

      {/* Cabecera. */}
      <View style={styles.header}>
        <Text style={type.label}>{t.radio.titulo}</Text>
        <Text style={type.heading}>{t.radio.sala(codigo)}</Text>
        <Text style={styles.conectadoComo}>
          {rol ? t.radio.conectadoComo(papelTexto(rol, t)) : ''} · {nombre}
        </Text>
      </View>

      {/* Código para compartir (solo lo enseña el hub). */}
      {esHub && (
        <Card style={styles.codigoCard}>
          <Text style={type.label}>{t.radio.comparteCodigo}</Text>
          <Text style={styles.codigo} numberOfLines={1} adjustsFontSizeToFit>{codigo}</Text>
          {!!miIp && (
            <>
              <Text style={styles.ip}>{t.radio.tuIp(miIp)}</Text>
              <Text style={styles.ipTexto}>{t.radio.tuIpTexto}</Text>
            </>
          )}
        </Card>
      )}

      {/* Selector de rol en vivo (máx. 1 piloto + 1 asistente). */}
      <Card style={styles.rolCard}>
        <Text style={type.label}>{t.radio.elegirPapel}</Text>
        <View style={styles.roles}>
          {ROLES.map(r => {
            const ocupado = r !== 'seguidor' && participantes.some(p => p.id !== tuId && p.rol === r);
            const activo = rol === r;
            return (
              <Pressable
                key={r}
                disabled={ocupado}
                onPress={() => cambiarRol(r)}
                style={({ pressed }) => [
                  styles.rol, activo && styles.rolActivo, ocupado && styles.rolOcupado,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.rolTexto, activo && styles.rolTextoActivo]}>
                  {papelTexto(r, t)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* Contenido según el rol. */}
      {esAsistente && (
        <>
          {hayPista ? (
            <Card style={styles.pistaCard}>
              <Text style={styles.pistaTexto}>{t.radio.pistaCronometrando}</Text>
              <Button
                label={t.radio.irAPista}
                onPress={() => navigation.navigate('MyTurn')}
                style={styles.pistaBoton}
              />
            </Card>
          ) : (
            <>
              {/* Botón grande de vuelta. */}
              <Pressable
                onPress={pulsarVuelta}
                style={({ pressed }) => [styles.vuelta, pressed && styles.vueltaPulsada]}
              >
                <Text style={styles.vueltaTexto}>{t.radio.vuelta}</Text>
                {!enMarcha && <Text style={styles.vueltaSub}>{t.radio.esperandoInicio}</Text>}
              </Pressable>

              {/* Acciones del cronómetro. */}
              <View style={styles.acciones}>
                <Button
                  label={t.radio.deshacer}
                  variant="outline"
                  onPress={deshacerVuelta}
                  disabled={!enMarcha && !hayLaps}
                  style={styles.flex}
                />
                <Button
                  label={t.radio.terminar}
                  variant="ghost"
                  onPress={terminarTanda}
                  disabled={!enMarcha && !hayLaps}
                  style={styles.flex}
                />
              </View>
            </>
          )}

          {/* Voz: walkie (pulsar-para-hablar) + medidor de nivel. */}
          <Card style={styles.vozCard}>
            <Text style={type.label}>{t.radio.nivelMicro}</Text>
            <Text style={styles.vozEstado}>{voz.listo ? t.radio.vozLista : t.radio.vozConectando}</Text>
            <MedidorNivel nivel={voz.nivel} />
            <Pressable
              onPressIn={() => voz.fijarMicro(true)}
              onPressOut={() => voz.fijarMicro(false)}
              style={({ pressed }) => [
                styles.walkie,
                (pressed || voz.hablando) && styles.walkieActivo,
              ]}
            >
              <Text style={styles.walkieTexto}>{t.radio.hablar}</Text>
            </Pressable>
          </Card>
        </>
      )}

      {/* Tiempos (unificados: hub y remotos leen la fuente Asistente). */}
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

      {/* Piloto: micro abierto, con medidor para calibrar la puerta de voz. */}
      {rol === 'piloto' && (
        <Card style={styles.microCard}>
          <Text style={type.label}>{t.radio.nivelMicro}</Text>
          <Text style={styles.vozEstado}>{voz.listo ? t.radio.vozLista : t.radio.vozConectando}</Text>
          <MedidorNivel nivel={voz.nivel} />
        </Card>
      )}

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

  ip: {
    color: colors.textSoft, fontSize: 16, fontWeight: '700', marginTop: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  ipTexto: { color: colors.textFaint, fontSize: 12, marginTop: 2, textAlign: 'center' },

  rolCard: { marginTop: spacing.lg },
  roles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  rol: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    backgroundColor: colors.bg,
  },
  rolActivo: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rolOcupado: { opacity: 0.4 },
  rolTexto: { color: colors.textSoft, fontSize: 14, fontWeight: '600' },
  rolTextoActivo: { color: colors.accent },
  pressed: { opacity: 0.7 },

  vuelta: {
    marginTop: spacing.lg, paddingVertical: 28, borderRadius: radius.md,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  vueltaPulsada: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  vueltaTexto: { color: colors.onAccent, fontSize: 28, fontWeight: '800' },
  vueltaSub: { color: colors.onAccent, opacity: 0.85, fontSize: 13, marginTop: 4 },

  pistaCard: { marginTop: spacing.lg },
  pistaTexto: { ...type.body, color: colors.textMuted, marginTop: 2 },
  pistaBoton: { marginTop: spacing.md },

  statsRow: { flexDirection: 'row', gap: spacing.md },

  vozCard: { marginTop: spacing.lg },
  vozEstado: { ...type.body, color: colors.textMuted, marginTop: 2 },
  walkie: {
    marginTop: spacing.md, paddingVertical: 18, borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  walkieActivo: {
    backgroundColor: colors.accentFill, borderColor: colors.accentFill,
  },
  walkieTexto: {
    color: colors.onAccent, fontSize: 18, fontWeight: '700',
  },

  acciones: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  flex: { flex: 1 },

  tiempos: { marginTop: spacing.lg, alignItems: 'stretch' },
  esperando: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  ultima: {
    color: colors.text, fontSize: 64, fontWeight: '800', textAlign: 'center',
    marginTop: spacing.xs, marginBottom: spacing.lg, fontVariant: ['tabular-nums'],
  },

  microCard: { marginTop: spacing.lg },

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
