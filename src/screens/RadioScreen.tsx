// Pantalla «Radio»: punto de entrada a la capa de voz y tiempos entre el
// piloto y su equipo (D2/D4/D12). Aquí el usuario:
//   • crea la sala (se convierte en asistente: cronómetro + centro de la sala),
//     de carrera (con papeles) o de entrenos (sin papeles: todos hablan)
//   • o se une a una sala descubierta (piloto o seguidor; en entrenos, sin
//     elegir papel)
//
// La sala vive en el `RadioProvider` global; esta pantalla solo recoge nombre
// y papel y delega en `crearSala` / `unirse`. Al entrar, se sustituye por la
// pantalla del papel correspondiente.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useIdioma } from '../i18n/IdiomaContext';
import type { Textos } from '../i18n';
import { useRadio } from '../radio/RadioContext';
import type { Rol, TipoSala } from '../radio/mensajes';
import type { SalaDescubierta } from '../radio/red';
import { salaInternet, salaManual } from '../radio/salaManual';
import type { ModoSala } from '../radio/red';
import { PUERTO_RADIO } from '../radio/tcp';
import { RADIO_INTERNET_DISPONIBLE } from '../radio/transporteRelay';
import BackButton from '../ui/BackButton';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Section from '../ui/Section';
import { colors, radius, spacing, type } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Radio'>;

/** Traduce el código interno de error a su texto de UI. */
function errorTexto(error: string | null, t: Textos): string | null {
  switch (error) {
    case 'codigo': return t.radio.codigoIncorrecto;
    case 'rol-ocupado': return t.radio.rolOcupado;
    case 'sala-llena': return t.radio.salaLlena;
    case 'salaCerrada': return t.radio.salaCerrada;
    case 'sinConexion': return t.radio.sinConexion;
    case 'entradaFallida': return t.radio.entradaFallida;
    default: return null;
  }
}

export default function RadioScreen({ navigation }: Props) {
  const { t } = useIdioma();
  const radio = useRadio();
  const [nombre, setNombre] = useState('');
  const [salaElegida, setSalaElegida] = useState<SalaDescubierta | null>(null);
  const [papel, setPapel] = useState<Rol | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [tipoNueva, setTipoNueva] = useState<TipoSala>('carrera');

  // Si ya estamos dentro de una sala (volvimos sin salir), vamos a su pantalla.
  useEffect(() => {
    if (radio.conectado) navigation.replace('RadioSala');
  }, [radio.conectado, navigation]);

  // Al desmontar la pantalla, paramos la búsqueda mDNS si sigue activa.
  // `detenerBusqueda` es estable; no queremos re-ejecutar esto en cada render.
  const detenerBusqueda = radio.detenerBusqueda;
  useEffect(() => {
    return () => { detenerBusqueda(); };
  }, [detenerBusqueda]);

  const [ipManual, setIpManual] = useState('');
  const [codigoManual, setCodigoManual] = useState('');

  const [codigoInternet, setCodigoInternet] = useState('');

  const [consultando, setConsultando] = useState(false);

  /** Con IP o por internet no hay anuncio que diga el tipo de sala: se le
   *  pregunta al hub antes de enseñar los papeles. */
  async function elegirConConsulta(sala: SalaDescubierta) {
    setConsultando(true);
    try {
      const tipo = await radio.consultarTipo(sala);
      if (!tipo) {
        Alert.alert(t.comun.error, t.radio.codigoIncorrecto);
        return;
      }
      setSalaElegida({ ...sala, tipo });
      setPapel(null);
    } catch {
      Alert.alert(t.comun.error, t.radio.entradaFallida);
    } finally {
      setConsultando(false);
    }
  }

  function usarSalaInternet() {
    const sala = salaInternet(codigoInternet);
    if (!sala) {
      Alert.alert(t.comun.error, t.radio.codigoNoValido);
      return;
    }
    void elegirConConsulta(sala);
  }

  function usarSalaManual() {
    const sala = salaManual(ipManual, codigoManual, PUERTO_RADIO);
    if (!sala) {
      Alert.alert(t.comun.error, t.radio.datosManualesNoValidos);
      return;
    }
    void elegirConConsulta(sala);
  }

  // Sala de entrenos: no hay papel que elegir.
  const elegidaEntrenos = salaElegida?.tipo === 'entrenos';
  const puedeEntrar = !!nombre.trim() && (!!papel || elegidaEntrenos) && !!salaElegida && !ocupado;
  const puedeCrear = !!nombre.trim() && !ocupado;

  async function crear(modo: ModoSala = 'local') {
    setOcupado(true);
    try {
      await radio.crearSala(nombre.trim(), modo, tipoNueva);
      // El estado `conectado` dispara el redirect hacia RadioAsistente.
    } catch (e) {
      setOcupado(false);
      Alert.alert(t.comun.error, e instanceof Error ? e.message : String(e));
    }
  }

  async function entrar() {
    const rol: Rol | null = elegidaEntrenos ? 'libre' : papel;
    if (!salaElegida || !rol) return;
    setOcupado(true);
    try {
      const motivo = await radio.unirse(salaElegida, rol, nombre.trim());
      if (motivo) {
        // El motivo ya está en radio.error y se muestra arriba; volvemos a dejar
        // elegir papel sin perder lo tecleado.
        setOcupado(false);
        return;
      }
      // El estado `conectado` dispara el redirect hacia RadioPiloto/RadioSeguidor.
    } catch {
      // Red de seguridad: un error inesperado no debe dejar el botón
      // colgado en «Entrando…».
      setOcupado(false);
    }
  }

  const err = errorTexto(radio.error, t);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <BackButton />
      <Text style={type.title}>{t.radio.titulo}</Text>
      <Text style={styles.sub}>{t.radio.sub}</Text>

      {!!err && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{err}</Text>
        </View>
      )}

      {!!radio.diagnostico && (
        <View style={styles.diagBox}>
          <Text style={styles.diagText}>{radio.diagnostico}</Text>
        </View>
      )}

      {/* Nombre: lo comparte crear y unirse. */}
      <View style={styles.nombre}>
        <Text style={type.label}>{t.radio.nombre}</Text>
        <TextInput
          style={styles.input}
          value={nombre}
          onChangeText={setNombre}
          placeholder={t.radio.nombrePh}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="words"
          maxLength={20}
        />
      </View>

      {/* ── Crear sala (asistente) ─────────────────────────────────────── */}
      <Section title={t.radio.crear}>
        <Card>
          <Text style={styles.cardSub}>{t.radio.crearSub}</Text>
          <Text style={[type.label, styles.mt]}>{t.radio.tipoSala}</Text>
          <RolCard
            titulo={t.radio.carrera}
            sub={t.radio.carreraSub}
            activo={tipoNueva === 'carrera'}
            onPress={() => setTipoNueva('carrera')}
          />
          <RolCard
            titulo={t.radio.entrenos}
            sub={t.radio.entrenosSub}
            activo={tipoNueva === 'entrenos'}
            onPress={() => setTipoNueva('entrenos')}
          />
          <Button
            label={t.radio.crearLocal}
            onPress={() => crear('local')}
            disabled={!puedeCrear}
            style={styles.mt}
          />
          {/* Por internet solo si el build trae el relé (builds de prueba). */}
          {RADIO_INTERNET_DISPONIBLE && (
            <>
              <Button
                label={t.radio.crearInternet}
                variant="outline"
                onPress={() => crear('internet')}
                disabled={!puedeCrear}
                style={styles.mtSm}
              />
              <Text style={styles.manualTexto}>{t.radio.crearModosTexto}</Text>
            </>
          )}
        </Card>
      </Section>

      {/* ── Unirse (piloto / seguidor) ─────────────────────────────────── */}
      <Section title={t.radio.unirse}>
        <Card>
          <Text style={styles.cardSub}>{t.radio.unirseSub}</Text>
          <Button
            label={radio.descubriendo ? t.radio.buscando : t.radio.buscar}
            variant="outline"
            onPress={radio.descubriendo ? radio.detenerBusqueda : radio.buscarSalas}
            style={styles.mt}
          />

          {radio.descubriendo && (
            <View style={styles.buscando}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )}

          {/* Diagnóstico: distingue «no se oye nada» de «se oye pero sin IP». */}
          {!!radio.diagBusqueda && (
            <Text style={styles.diagBusqueda}>
              {t.radio.diagBusqueda(radio.diagBusqueda.oidos, radio.diagBusqueda.resueltos)}
              {radio.diagBusqueda.oidos > radio.diagBusqueda.resueltos && `\n${t.radio.oidaSinIp}`}
              {!!radio.diagBusqueda.error && `\n${radio.diagBusqueda.error}`}
            </Text>
          )}

          {!radio.descubriendo && radio.salas.length === 0 && !salaElegida && (
            <Text style={styles.sinSalas}>
              {t.radio.sinSalas}{'\n'}
              <Text style={styles.sinSalasTexto}>{t.radio.sinSalasTexto}</Text>
            </Text>
          )}

          {radio.salas.map(sala => {
            const elegida = salaElegida?.host === sala.host && salaElegida?.codigo === sala.codigo;
            return (
              <Pressable
                key={`${sala.host}:${sala.codigo}`}
                onPress={() => { setSalaElegida(sala); setPapel(null); }}
                style={({ pressed }) => [
                  styles.sala, elegida && styles.salaElegida, pressed && styles.pressed,
                ]}
              >
                <Text style={styles.salaNombre}>{sala.nombre}</Text>
                <Text style={styles.salaCodigo}>
                  {t.radio.sala(sala.codigo)}
                  {sala.tipo ? ` · ${sala.tipo === 'entrenos' ? t.radio.entrenos : t.radio.carrera}` : ''}
                </Text>
                <Text style={styles.salaHost}>{sala.host}:{sala.puerto}</Text>
              </Pressable>
            );
          })}

          {/* Por internet: solo el código (no hace falta estar en la misma red). */}
          {RADIO_INTERNET_DISPONIBLE && <View style={styles.manual}>
            <Text style={type.label}>{t.radio.entrarInternet}</Text>
            <Text style={styles.manualTexto}>{t.radio.entrarInternetTexto}</Text>
            <View style={styles.manualFila}>
              <TextInput
                style={[styles.input, styles.manualIp]}
                value={codigoInternet}
                onChangeText={setCodigoInternet}
                placeholder={t.radio.codigoPh}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
              />
              <Button
                label={consultando ? t.radio.comprobandoSala : t.radio.usarSala}
                variant="outline"
                onPress={usarSalaInternet}
                disabled={!codigoInternet.trim() || consultando}
              />
            </View>
          </View>}

          {/* Entrada manual: si la búsqueda no encuentra la sala. */}
          <View style={styles.manual}>
            <Text style={type.label}>{t.radio.entrarConIp}</Text>
            <Text style={styles.manualTexto}>{t.radio.entrarConIpTexto}</Text>
            <View style={styles.manualFila}>
              <TextInput
                style={[styles.input, styles.manualIp]}
                value={ipManual}
                onChangeText={setIpManual}
                placeholder={t.radio.ipPh}
                placeholderTextColor={colors.textFaint}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={[styles.input, styles.manualCodigo]}
                value={codigoManual}
                onChangeText={setCodigoManual}
                placeholder={t.radio.codigoPh}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
              />
            </View>
            <Button
              label={consultando ? t.radio.comprobandoSala : t.radio.usarSala}
              variant="outline"
              onPress={usarSalaManual}
              disabled={!ipManual.trim() || !codigoManual.trim() || consultando}
              style={styles.mt}
            />
          </View>

          {/* Papel dentro de la sala elegida (en entrenos no hay). */}
          {!!salaElegida && (
            <View style={styles.papel}>
              {elegidaEntrenos ? (
                <Text style={styles.cardSub}>{t.radio.entrenosEntrarTexto}</Text>
              ) : (
                <>
                  <Text style={[type.label, styles.papelLabel]}>{t.radio.elegirPapel}</Text>
                  <RolCard
                    titulo={t.radio.piloto}
                    sub={t.radio.pilotoSub}
                    activo={papel === 'piloto'}
                    onPress={() => setPapel('piloto')}
                  />
                  <RolCard
                    titulo={t.radio.seguidor}
                    sub={t.radio.seguidorSub}
                    activo={papel === 'seguidor'}
                    onPress={() => setPapel('seguidor')}
                  />
                </>
              )}
              <Button
                label={ocupado ? t.radio.entrando : t.radio.entrar}
                onPress={entrar}
                disabled={!puedeEntrar}
                style={styles.mt}
              />
            </View>
          )}
        </Card>
      </Section>
    </ScrollView>
  );
}

/** Tarjeta de elección (papel al entrar o tipo de sala al crearla). */
function RolCard({ titulo, sub, activo, onPress }: {
  titulo: string;
  sub: string;
  activo: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.rolCard, activo && styles.rolCardActivo, pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.rolTitulo, activo && styles.rolTituloActivo]}>{titulo}</Text>
      <Text style={styles.rolSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 40 },
  sub: { ...type.body, marginTop: spacing.xs, color: colors.textMuted },
  pressed: { opacity: 0.7 },

  errorBox: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface,
  },
  errorText: { color: colors.danger, fontSize: 14, fontWeight: '600' },

  diagBox: {
    marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface,
  },
  diagText: { color: colors.textFaint, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },

  nombre: { marginTop: spacing.xl },
  input: {
    marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 17,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  cardSub: { ...type.body, color: colors.textMuted },
  mt: { marginTop: spacing.lg },
  mtSm: { marginTop: spacing.sm },

  buscando: { alignItems: 'center', paddingVertical: spacing.lg },
  sinSalas: { color: colors.textMuted, fontSize: 14, marginTop: spacing.lg, lineHeight: 20 },
  sinSalasTexto: { color: colors.textFaint, fontSize: 13 },
  diagBusqueda: { color: colors.textFaint, fontSize: 12, marginTop: spacing.md, lineHeight: 17 },

  sala: {
    marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
  },
  salaElegida: { borderColor: colors.accent },
  salaNombre: { color: colors.text, fontSize: 16, fontWeight: '700' },
  salaCodigo: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  salaHost: { color: colors.textFaint, fontSize: 11, marginTop: 2, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },

  manual: {
    marginTop: spacing.xl, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSoft,
  },
  manualTexto: { color: colors.textFaint, fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  manualFila: { flexDirection: 'row', gap: spacing.sm },
  manualIp: { flex: 3 },
  manualCodigo: { flex: 2 },

  papel: { marginTop: spacing.lg },
  papelLabel: { marginBottom: spacing.sm },
  rolCard: {
    marginTop: spacing.sm, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.bg,
  },
  rolCardActivo: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rolTitulo: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rolTituloActivo: { color: colors.accent },
  rolSub: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
});
