// Selector de idioma. "Automático" sigue el idioma del móvil (inglés si no es
// ninguno de los soportados); el resto fija el idioma de la app y de la voz.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useIdioma } from '../i18n/IdiomaContext';
import { IDIOMAS, nombreIdioma, type PreferenciaIdioma } from '../i18n/idiomas';
import BackButton from '../ui/BackButton';

export default function IdiomaScreen() {
  const { t, preferencia, idiomaSistema, setPreferencia } = useIdioma();

  const opciones: { valor: PreferenciaIdioma; titulo: string; sub?: string }[] = [
    { valor: 'auto', titulo: t.idioma.automatico, sub: t.idioma.automaticoSub(nombreIdioma(idiomaSistema)) },
    ...IDIOMAS.map(i => ({ valor: i.codigo as PreferenciaIdioma, titulo: i.nombre })),
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <BackButton />
      <Text style={styles.title}>{t.idioma.titulo}</Text>
      {opciones.map(o => {
        const activo = o.valor === preferencia;
        return (
          <Pressable
            key={o.valor}
            style={[styles.row, activo && styles.rowActivo]}
            onPress={() => setPreferencia(o.valor)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{o.titulo}</Text>
              {!!o.sub && <Text style={styles.rowSub}>{o.sub}</Text>}
            </View>
            {activo && <Text style={styles.check}>✓</Text>}
          </Pressable>
        );
      })}
      <Text style={styles.nota}>{t.idioma.notaVoz}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4, marginBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141923', paddingVertical: 16, paddingHorizontal: 16,
    marginVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: 'transparent',
  },
  rowActivo: { borderColor: '#f6c90e' },
  rowName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowSub: { color: '#9aa3ad', fontSize: 12, marginTop: 4 },
  check: { color: '#f6c90e', fontSize: 20, fontWeight: '800' },
  nota: { color: '#7f8a97', fontSize: 12, lineHeight: 18, marginTop: 18 },
});
