// Pantalla «Radio»: punto de entrada a la capa de voz y tiempos entre el
// piloto y su equipo (D2/D4/D12). Aquí el usuario:
//   • crea la sala (se convierte en asistente: cronómetro + centro de la sala)
//   • o se une a una sala descubierta (piloto o seguidor)
//
// La sala vive en el `RadioProvider` global; esta pantalla solo recoge nombre
// y papel y delega en `crearSala` / `unirse`. Al entrar, se sustituye por la
// pantalla del papel correspondiente.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useIdioma } from '../i18n/IdiomaContext';
import type { Textos } from '../i18n';
import { useRadio } from '../radio/RadioContext';
import type { Rol } from '../radio/mensajes';
import type { SalaDescubierta } from '../radio/red';
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

  // Si ya estamos dentro de una sala (volvimos sin salir), vamos a su pantalla.
  useEffect(() => {
    if (!radio.conectado) return;
    if (radio.rol === 'asistente') navigation.replace('RadioAsistente');
    else if (radio.rol === 'piloto') navigation.replace('RadioPiloto');
    else navigation.replace('RadioSeguidor');
  }, [radio.conectado, radio.rol, navigation]);

  // Al desmontar la pantalla, paramos la búsqueda mDNS si sigue activa.
  // `detenerBusqueda` es estable; no queremos re-ejecutar esto en cada render.
  const detenerBusqueda = radio.detenerBusqueda;
  useEffect(() => {
    return () => { detenerBusqueda(); };
  }, [detenerBusqueda]);

  const puedeEntrar = !!nombre.trim() && !!papel && !!salaElegida && !ocupado;
  const puedeCrear = !!nombre.trim() && !ocupado;

  async function crear() {
    setOcupado(true);
    try {
      await radio.crearSala(nombre.trim());
      // El estado `conectado` dispara el redirect hacia RadioAsistente.
    } catch (e) {
      setOcupado(false);
      Alert.alert(t.comun.error, e instanceof Error ? e.message : String(e));
    }
  }

  async function entrar() {
    if (!salaElegida || !papel) return;
    setOcupado(true);
    const motivo = await radio.unirse(salaElegida, papel, nombre.trim());
    if (motivo) {
      // El motivo ya está en radio.error y se muestra arriba; volvemos a dejar
      // elegir papel sin perder lo tecleado.
      setOcupado(false);
      return;
    }
    // El estado `conectado` dispara el redirect hacia RadioPiloto/RadioSeguidor.
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
          <Button
            label={t.radio.crear}
            onPress={crear}
            disabled={!puedeCrear}
            style={styles.mt}
          />
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
                <Text style={styles.salaCodigo}>{t.radio.sala(sala.codigo)}</Text>
              </Pressable>
            );
          })}

          {/* Papel dentro de la sala elegida. */}
          {!!salaElegida && (
            <View style={styles.papel}>
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

/** Tarjeta de elección de papel (piloto / seguidor). */
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

  nombre: { marginTop: spacing.xl },
  input: {
    marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 17,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  cardSub: { ...type.body, color: colors.textMuted },
  mt: { marginTop: spacing.lg },

  buscando: { alignItems: 'center', paddingVertical: spacing.lg },
  sinSalas: { color: colors.textMuted, fontSize: 14, marginTop: spacing.lg, lineHeight: 20 },
  sinSalasTexto: { color: colors.textFaint, fontSize: 13 },

  sala: {
    marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
  },
  salaElegida: { borderColor: colors.accent },
  salaNombre: { color: colors.text, fontSize: 16, fontWeight: '700' },
  salaCodigo: { color: colors.textMuted, fontSize: 13, marginTop: 2 },

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
