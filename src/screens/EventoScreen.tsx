// Alta y edición de una carrera del calendario, con sus avisos. Al guardar se
// reprograman las notificaciones del evento; al borrar se cancelan.

import { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  AVISOS, AVISOS_POR_DEFECTO, avisosPendientes, combinarFechaHora, nuevoIdEvento, type AvisoId, type Evento,
} from '../data/calendario';
import { deleteEvento, getEvento, saveEvento } from '../data/calendarioStore';
import { cancelarAvisos, programarAvisos } from '../data/avisos';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Evento'>;

/** Primera hora en punto de mañana: punto de partida de una carrera nueva. */
function inicioPorDefecto(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

export default function EventoScreen({ navigation, route }: Props) {
  const id = route.params?.id;
  const { t, locale } = useIdioma();
  const [cargado, setCargado] = useState(!id);
  const [anteriores, setAnteriores] = useState<string[]>([]);
  const [nombre, setNombre] = useState('');
  const [lugar, setLugar] = useState('');
  const [notas, setNotas] = useState('');
  const [inicio, setInicio] = useState<Date>(inicioPorDefecto);
  const [avisos, setAvisos] = useState<AvisoId[]>(AVISOS_POR_DEFECTO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!id) return;
    getEvento(id).then(e => {
      if (e) {
        setNombre(e.nombre);
        setLugar(e.lugar ?? '');
        setNotas(e.notas ?? '');
        setInicio(new Date(e.inicio));
        setAvisos(e.avisos);
        setAnteriores(e.notificaciones);
      }
      setCargado(true);
    });
  }, [id]);

  function alternarAviso(a: AvisoId) {
    setAvisos(prev => (prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]));
  }

  // Android no admite fecha y hora a la vez: dos diálogos seguidos.
  function elegirAndroid(modo: 'date' | 'time') {
    DateTimePickerAndroid.open({
      value: inicio,
      mode: modo,
      is24Hour: true,
      onChange: (_e, valor) => {
        if (!valor) return;
        setInicio(modo === 'date' ? combinarFechaHora(valor, inicio) : combinarFechaHora(inicio, valor));
      },
    });
  }

  async function guardar() {
    if (!nombre.trim()) {
      Alert.alert(t.comun.error, t.calendario.nombreObligatorio);
      return;
    }
    setGuardando(true);
    try {
      await cancelarAvisos(anteriores);
      const evento: Evento = {
        id: id ?? nuevoIdEvento(),
        nombre: nombre.trim(),
        lugar: lugar.trim() || undefined,
        notas: notas.trim() || undefined,
        inicio: inicio.toISOString(),
        avisos,
        notificaciones: [],
      };
      evento.notificaciones = await programarAvisos(evento, a => {
        const cuerpo = t.calendario.avisoCuerpo[a];
        return evento.lugar ? `${cuerpo} · ${evento.lugar}` : cuerpo;
      });
      await saveEvento(evento);
      // Había avisos por programar y no salió ninguno: falta el permiso.
      if (avisosPendientes(evento.inicio, avisos, new Date()).length > 0
          && evento.notificaciones.length === 0) {
        Alert.alert(t.calendario.avisarme, t.calendario.sinPermiso);
      }
      navigation.goBack();
    } finally {
      setGuardando(false);
    }
  }

  function borrar() {
    if (!id) return;
    Alert.alert(t.calendario.borrar, t.calendario.borrarTexto, [
      { text: t.comun.cancelar, style: 'cancel' },
      {
        text: t.calendario.borrar, style: 'destructive',
        onPress: async () => {
          await cancelarAvisos(anteriores);
          await deleteEvento(id);
          navigation.goBack();
        },
      },
    ]);
  }

  if (!cargado) return <View style={styles.root} />;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <BackButton />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.titulo}>{id ? t.calendario.editar : t.calendario.nueva}</Text>

        <Text style={styles.etiqueta}>{t.calendario.nombre}</Text>
        <TextInput
          style={styles.input}
          value={nombre}
          onChangeText={setNombre}
          placeholder={t.calendario.nombrePh}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
        />

        <Text style={styles.etiqueta}>{t.calendario.fecha} · {t.calendario.hora}</Text>
        {Platform.OS === 'ios' ? (
          <View style={styles.pickers}>
            <DateTimePicker
              value={inicio}
              mode="date"
              display="compact"
              locale={locale}
              themeVariant="dark"
              onChange={(_e, v) => { if (v) setInicio(combinarFechaHora(v, inicio)); }}
            />
            <DateTimePicker
              value={inicio}
              mode="time"
              display="compact"
              locale={locale}
              themeVariant="dark"
              onChange={(_e, v) => { if (v) setInicio(combinarFechaHora(inicio, v)); }}
            />
          </View>
        ) : (
          <View style={styles.pickers}>
            <Pressable style={styles.chipFecha} onPress={() => elegirAndroid('date')}>
              <Text style={styles.chipFechaTexto}>
                {inicio.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
              </Text>
            </Pressable>
            <Pressable style={styles.chipFecha} onPress={() => elegirAndroid('time')}>
              <Text style={styles.chipFechaTexto}>
                {inicio.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.etiqueta}>{t.calendario.lugar}</Text>
        <TextInput
          style={styles.input}
          value={lugar}
          onChangeText={setLugar}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
        />

        <Text style={styles.etiqueta}>{t.calendario.notas}</Text>
        <TextInput
          style={[styles.input, styles.inputNotas]}
          value={notas}
          onChangeText={setNotas}
          placeholderTextColor={colors.textFaint}
          multiline
        />

        <Text style={styles.etiqueta}>{t.calendario.avisarme}</Text>
        <View style={styles.avisos}>
          {AVISOS.map(a => {
            const activo = avisos.includes(a.id);
            return (
              <Pressable
                key={a.id}
                onPress={() => alternarAviso(a.id)}
                style={[styles.aviso, activo && styles.avisoActivo]}
              >
                <Text style={[styles.avisoTexto, activo && styles.avisoTextoActivo]}>
                  {activo ? '✓ ' : ''}{t.calendario.aviso[a.id]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={[styles.guardar, guardando && styles.deshabilitado]}
          onPress={guardar}
          disabled={guardando}
        >
          <Text style={styles.guardarTexto}>{guardando ? t.comun.guardando : t.comun.guardar}</Text>
        </Pressable>
        {!!id && (
          <Pressable style={styles.borrar} onPress={borrar}>
            <Text style={styles.borrarTexto}>{t.calendario.borrar}</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, backgroundColor: colors.bg },
  titulo: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  etiqueta: {
    color: colors.textMuted, fontSize: 12, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface, color: colors.text, fontSize: 17,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.sm,
    borderColor: colors.border, borderWidth: 1,
  },
  inputNotas: { minHeight: 80, textAlignVertical: 'top' },
  pickers: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  chipFecha: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 16,
  },
  chipFechaTexto: { color: colors.text, fontSize: 16 },
  avisos: { gap: spacing.sm },
  aviso: {
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  avisoActivo: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  avisoTexto: { color: colors.textSoft, fontSize: 15 },
  avisoTextoActivo: { color: colors.accent, fontWeight: '600' },
  guardar: {
    marginTop: spacing.xxl, paddingVertical: 14, borderRadius: radius.sm,
    backgroundColor: colors.accentFill, alignItems: 'center',
  },
  guardarTexto: { color: colors.onAccent, fontSize: 16, fontWeight: '700' },
  deshabilitado: { opacity: 0.5 },
  borrar: { marginTop: spacing.lg, paddingVertical: 12, alignItems: 'center', marginBottom: spacing.xxl },
  borrarTexto: { color: colors.danger, fontSize: 15 },
});
