// Menú principal: las cuatro áreas de la app en cuadrícula. "Lap" es la
// conexión con el cronómetro de la pista (PitWall o TicTac) para escuchar los
// tiempos: ocupa todo el ancho y las otras cuatro son cuadradas.

import {
  Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getCurrentVersion } from '../data/appVersion';
import { useAjustes } from '../data/AjustesContext';
import { useIdioma } from '../i18n/IdiomaContext';
import { useRadio } from '../radio/RadioContext';
import AvisoActualizacion from '../ui/AvisoActualizacion';
import { colors, radius, spacing } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** Ancho máximo del contenido: en iPad la cuadrícula no se estira. */
const ANCHO_MAX = 520;
const HUECO = spacing.md;
// Proporción de assets/logo-pitwall.png (718 × 140).
const PROPORCION_LOGO = 718 / 140;

interface Baldosa {
  icono: string;
  titulo: string;
  subtitulo: string;
  onPress: () => void;
}

export default function HomeScreen({ navigation }: Props) {
  const { t } = useIdioma();
  const radio = useRadio();
  const { ajustes } = useAjustes();
  // Radio está en pruebas: solo con la contraseña metida en Ajustes (o si ya
  // hay una sala abierta, para poder volver a ella).
  const verRadio = ajustes.radioDesbloqueada || radio.conectado;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const ancho = Math.min(width - spacing.xl * 2, ANCHO_MAX);
  const lado = (ancho - HUECO) / 2;
  const anchoLogo = Math.min(ancho * 0.8, 280);

  const cuadradas: Baldosa[] = [
    {
      icono: '📅', titulo: t.menu.calendario, subtitulo: t.menu.calendarioSub,
      onPress: () => navigation.push('Calendario'),
    },
    {
      icono: '⏱', titulo: t.menu.entrenamientos, subtitulo: t.menu.entrenamientosSub,
      onPress: () => navigation.push('Training'),
    },
    {
      icono: '🎯', titulo: t.menu.competicion, subtitulo: t.menu.competicionSub,
      onPress: () => navigation.push('EntrenosCompeticion'),
    },
    {
      icono: '🏆', titulo: t.menu.resultados, subtitulo: t.menu.resultadosSub,
      onPress: () => navigation.push('History'),
    },
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Image
        source={require('../../assets/logo-pitwall.png')}
        style={{ width: anchoLogo, height: anchoLogo / PROPORCION_LOGO, marginBottom: spacing.xxl }}
        resizeMode="contain"
        accessibilityLabel="PitWall"
      />

      <View style={{ width: ancho }}>
        <AvisoActualizacion />
      </View>

      <View style={{ width: ancho, gap: HUECO }}>
        <Pressable
          onPress={() => navigation.push('Discovery')}
          style={({ pressed }) => [styles.lap, pressed && styles.pulsada]}
        >
          <Text style={styles.lapIcono}>🏁</Text>
          <View style={styles.lapTextos}>
            <Text style={styles.lapTitulo}>{t.menu.lap}</Text>
            <Text style={styles.lapSubtitulo}>{t.menu.lapSub}</Text>
          </View>
        </Pressable>

        {verRadio && <Pressable
          onPress={() => navigation.push('Radio')}
          style={({ pressed }) => [styles.radio, pressed && styles.pulsada]}
        >
          <Text style={styles.radioIcono}>🎧</Text>
          <View style={styles.lapTextos}>
            <View style={styles.radioTituloRow}>
              <Text style={styles.radioTitulo}>{t.menu.radio}</Text>
              {radio.conectado && <View style={styles.radioPunto} />}
            </View>
            <Text style={styles.radioSubtitulo} numberOfLines={1}>
              {radio.conectado ? t.radio.sala(radio.codigo) : t.menu.radioSub}
            </Text>
          </View>
        </Pressable>}

        <View style={styles.rejilla}>
          {cuadradas.map(b => (
            <Pressable
              key={b.titulo}
              onPress={b.onPress}
              style={({ pressed }) => [
                styles.baldosa, { width: lado, height: lado }, pressed && styles.pulsada,
              ]}
            >
              <Text style={styles.icono}>{b.icono}</Text>
              <View>
                <Text style={styles.titulo} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {b.titulo}
                </Text>
                <Text style={styles.subtitulo} numberOfLines={2}>{b.subtitulo}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => navigation.push('Ajustes')}
          style={({ pressed }) => [styles.ajustes, pressed && styles.pulsada]}
        >
          <Text style={styles.ajustesIcono}>⚙️</Text>
          <View style={styles.ajustesTextos}>
            <Text style={styles.ajustesTitulo}>{t.menu.ajustes}</Text>
            <Text style={styles.ajustesSub} numberOfLines={1}>{t.menu.ajustesSub}</Text>
          </View>
          <Text style={styles.ajustesChevron}>›</Text>
        </Pressable>
      </View>

      <Pressable style={styles.enlace} onPress={() => navigation.push('Changelog')}>
        <Text style={styles.versionTexto}>{t.inicio.novedades(getCurrentVersion())}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { alignItems: 'center', paddingHorizontal: spacing.xl },
  pulsada: { opacity: 0.8 },

  // Lap: ancho completo, destacada.
  lap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    paddingVertical: spacing.xl, paddingHorizontal: spacing.xl, minHeight: 104,
    borderRadius: radius.md + 4, backgroundColor: colors.accentFill,
  },
  lapIcono: { fontSize: 38 },
  lapTextos: { flex: 1 },
  lapTitulo: { color: colors.onAccent, fontSize: 24, fontWeight: '800' },
  lapSubtitulo: { color: colors.onAccent, opacity: 0.8, fontSize: 13, marginTop: 3, lineHeight: 18 },

  // Radio: ancho completo, misma franja que Lap pero en superficie (no compite
  // con el rojo del Lap). El punto verde indica una sala viva.
  radio: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, minHeight: 84,
    borderRadius: radius.md + 4, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  radioIcono: { fontSize: 30 },
  radioTituloRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  radioTitulo: { color: colors.text, fontSize: 20, fontWeight: '800' },
  radioSubtitulo: { color: colors.textMuted, fontSize: 13, marginTop: 3, lineHeight: 18 },
  radioPunto: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.good,
  },

  // Las otras tres: cuadradas, en dos columnas.
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: HUECO },
  baldosa: {
    padding: spacing.lg, justifyContent: 'space-between',
    borderRadius: radius.md + 4, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  icono: { fontSize: 32 },
  titulo: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitulo: { color: colors.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 },

  // Ajustes: franja baja y discreta; no compite con las cuatro áreas de arriba.
  ajustes: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: radius.md + 4, borderWidth: 1, borderColor: colors.borderSoft,
  },
  ajustesIcono: { fontSize: 20 },
  ajustesTextos: { flex: 1, minWidth: 0 },
  ajustesTitulo: { color: colors.textSoft, fontSize: 16, fontWeight: '600' },
  ajustesSub: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  ajustesChevron: { color: colors.textFaint, fontSize: 24, fontWeight: '300', marginTop: -2 },

  enlace: { paddingVertical: spacing.md, marginTop: spacing.sm },
  versionTexto: { color: colors.textFaint, fontSize: 12 },
});
