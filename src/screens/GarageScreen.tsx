// Garage: abre SlotGarage (la app de Emanuele Palena) embebida en un WebView.
// La app es suya; aquí solo la mostramos. El login es el de SlotGarage.

import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import { colors } from '../ui/theme';

// `embed=true` oculta la cabecera y el pie de Streamlit.
export const URL_SLOTGARAGE = 'https://slotgarage-bbgymhfi3t84jmpw5f6usu.streamlit.app/?embed=true';

export default function GarageScreen() {
  const { t } = useIdioma();
  const webRef = useRef<WebView>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  const reintentar = () => {
    setError(false);
    setCargando(true);
    webRef.current?.reload();
  };

  return (
    <View style={styles.root}>
      <View style={styles.cabecera}>
        <BackButton />
        <Text style={styles.titulo}>{t.menu.garage}</Text>
      </View>

      <View style={styles.contenido}>
        <WebView
          ref={webRef}
          source={{ uri: URL_SLOTGARAGE }}
          style={styles.web}
          onLoadEnd={() => setCargando(false)}
          onError={() => { setCargando(false); setError(true); }}
          onHttpError={() => { setCargando(false); setError(true); }}
          allowsBackForwardNavigationGestures
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
        />

        {cargando && !error && (
          <View style={styles.centro} pointerEvents="none">
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}

        {error && (
          <View style={[styles.centro, styles.fondoError]}>
            <Text style={styles.textoError}>{t.menu.garageError}</Text>
            <Pressable onPress={reintentar} style={({ pressed }) => [styles.boton, pressed && { opacity: 0.8 }]}>
              <Text style={styles.botonTexto}>{t.menu.garageReintentar}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  titulo: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 8 },
  contenido: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.bg },
  centro: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fondoError: { backgroundColor: colors.bg, padding: 24, gap: 16 },
  textoError: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  boton: { borderWidth: 1, borderColor: colors.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 },
  botonTexto: { color: colors.accent, fontWeight: '700', fontSize: 15 },
});
