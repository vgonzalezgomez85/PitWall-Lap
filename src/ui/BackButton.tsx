// Botón "Volver" para pantallas secundarias. Se posiciona respetando el
// safe-area (status bar de iOS) y con un área de tap generosa.

import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIdioma } from '../i18n/IdiomaContext';
import { colors } from './theme';

interface Props {
  label?: string;
}

export default function BackButton({ label }: Props) {
  const navigation = useNavigation();
  const { t } = useIdioma();
  const insets = useSafeAreaInsets();
  if (!navigation.canGoBack()) return null;
  return (
    <Pressable
      onPress={() => navigation.goBack()}
      style={({ pressed }) => [styles.btn, { marginTop: insets.top + 4 }, pressed && styles.pressed]}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
    >
      <Text style={styles.text}>{'‹ ' + (label ?? t.comun.volver)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginLeft: -8,        // alinear texto con el resto del contenido
  },
  pressed: { opacity: 0.6 },
  text: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '600',
  },
});
