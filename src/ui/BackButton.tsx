// Botón "Volver" para pantallas secundarias. Se posiciona respetando el
// safe-area (status bar de iOS) y con un área de tap generosa.

import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  label?: string;
}

export default function BackButton({ label = 'Volver' }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  if (!navigation.canGoBack()) return null;
  return (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={[styles.btn, { marginTop: insets.top + 4 }]}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      activeOpacity={0.6}
    >
      <Text style={styles.text}>{'‹ ' + label}</Text>
    </TouchableOpacity>
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
  text: {
    color: '#f6c90e',
    fontSize: 17,
    fontWeight: '600',
  },
});
