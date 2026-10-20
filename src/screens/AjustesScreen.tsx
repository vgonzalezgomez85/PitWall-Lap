// Ajustes: idioma de la app y opciones de Lap (estrategia de neumáticos y avisos
// de voz). Lo que se fija aquí es con lo que arranca cada sesión; el piloto
// puede cambiar los avisos sobre la marcha desde la pantalla de Lap.

import { useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAjustes } from '../data/AjustesContext';
import { useIdioma } from '../i18n/IdiomaContext';
import { nombreIdioma } from '../i18n/idiomas';
import { claveRadioValida } from '../radio/desbloqueo';
import { useVoiceSettings } from '../voice/settings';
import BackButton from '../ui/BackButton';
import { BuscarActualizacion } from '../ui/AvisoActualizacion';
import Card from '../ui/Card';
import NavRow from '../ui/NavRow';
import Section from '../ui/Section';
import VoiceControls from '../ui/VoiceControls';
import { colors, radius, spacing, type } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Ajustes'>;

/** Fila con título, explicación y un interruptor. */
function FilaInterruptor({ titulo, texto, valor, onChange }: {
  titulo: string;
  texto: string;
  valor: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.fila}>
      <View style={styles.filaTextos}>
        <Text style={styles.filaTitulo}>{titulo}</Text>
        <Text style={type.caption}>{texto}</Text>
      </View>
      <Switch
        value={valor}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.accentFill }}
        thumbColor="#ffffff"
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

/** Radio en pruebas: se muestra en el menú tras meter la contraseña. */
function SeccionRadio() {
  const { t } = useIdioma();
  const { ajustes, actualizar } = useAjustes();
  const [clave, setClave] = useState('');
  const [error, setError] = useState(false);
  const a = t.ajustes;

  if (ajustes.radioDesbloqueada) {
    return (
      <Card style={styles.tarjeta}>
        <FilaInterruptor
          titulo={a.radioVisible}
          texto={a.radioVisibleSub}
          valor
          onChange={v => { if (!v) actualizar({ radioDesbloqueada: false }); }}
        />
      </Card>
    );
  }

  const probar = () => {
    if (claveRadioValida(clave)) {
      setClave('');
      setError(false);
      actualizar({ radioDesbloqueada: true });
    } else {
      setError(true);
    }
  };

  return (
    <Card style={styles.tarjeta}>
      <Text style={type.caption}>{a.radioSub}</Text>
      <View style={styles.claveFila}>
        <TextInput
          style={styles.claveInput}
          value={clave}
          onChangeText={v => { setClave(v); setError(false); }}
          onSubmitEditing={probar}
          placeholder={a.radioClave}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        <Pressable
          onPress={probar}
          disabled={clave.length === 0}
          style={({ pressed }) => [
            styles.claveBoton, clave.length === 0 && styles.claveBotonOff, pressed && styles.pulsado,
          ]}
        >
          <Text style={styles.claveBotonTexto}>{a.radioDesbloquear}</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.claveError}>{a.radioClaveMal}</Text>}
    </Card>
  );
}

export default function AjustesScreen({ navigation }: Props) {
  const { t, idioma, preferencia } = useIdioma();
  const { ajustes, actualizar } = useAjustes();
  const voz = useVoiceSettings();
  const a = t.ajustes;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.contenido}
      showsVerticalScrollIndicator={false}
    >
      <BackButton />
      <Text style={styles.titulo}>{t.menu.ajustes}</Text>

      <Section title={a.idioma}>
        <NavRow
          title={`🌐 ${nombreIdioma(idioma)}`}
          subtitle={preferencia === 'auto' ? t.idioma.automatico : undefined}
          onPress={() => navigation.push('Idioma')}
        />
      </Section>

      <Section title={a.lap}>
        <Card style={styles.tarjeta}>
          <FilaInterruptor
            titulo={a.estrategia}
            texto={a.estrategiaSub}
            valor={ajustes.estrategiaNeumaticos}
            onChange={v => actualizar({ estrategiaNeumaticos: v })}
          />
        </Card>

        <Card style={styles.tarjeta}>
          <FilaInterruptor
            titulo={a.voz}
            texto={a.vozSub}
            valor={voz.settings.enabled}
            onChange={v => voz.update({ enabled: v })}
          />
        </Card>
        <VoiceControls
          settings={voz.settings}
          toggle={voz.toggle}
          update={voz.update}
          full
        />
        <Text style={type.caption}>{a.vozNota}</Text>
      </Section>

      <Section title={a.radio}>
        <SeccionRadio />
      </Section>

      {Platform.OS === 'android' && (
        <Section title={t.actualizacion.seccion}>
          <BuscarActualizacion />
        </Section>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  contenido: { padding: spacing.xl, paddingBottom: spacing.xxl },
  titulo: { ...type.title, marginTop: 4, marginBottom: spacing.sm },
  tarjeta: { marginBottom: spacing.md },
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  filaTextos: { flex: 1, minWidth: 0, gap: 2 },
  filaTitulo: { color: colors.text, fontSize: 16, fontWeight: '600' },
  claveFila: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  claveInput: {
    flex: 1, minWidth: 0, color: colors.text, fontSize: 16,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  claveBoton: {
    backgroundColor: colors.accentFill, borderRadius: radius.sm,
    paddingHorizontal: spacing.lg, justifyContent: 'center',
  },
  claveBotonOff: { opacity: 0.4 },
  claveBotonTexto: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  claveError: { color: colors.danger, marginTop: spacing.sm, fontSize: 14 },
  pulsado: { opacity: 0.65 },
});
