// Lap: el usuario elige qué fuente quiere usar (PitWall o TicTac/InfoLap),
// con dos tarjetas grandes y el botón de volver al menú. Tras elegir:
//   1. Auto-discovery para esa fuente (mDNS para PitWall, UDP broadcast
//      para InfoLap). ~6 s.
//   2. Si no encuentra → pantalla con input de IP + botón "Conectar".
//      Sigue limitado a la fuente elegida; no salta de una a otra.
//
// Persistimos la última IP manual usada por fuente en AsyncStorage para
// precargarla la próxima vez.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { discover, type SourceKind } from '../data/discovery';
import { useDataSource } from '../data/sourceContext';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';
import { colors } from '../ui/theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Discovery'>;

const LAST_HOST_KEY = (kind: SourceKind) => `@pitwall/last-host/${kind}`;

type Mode =
  | { phase: 'choose' }
  | { phase: 'searching'; kind: SourceKind }
  | { phase: 'manual';    kind: SourceKind; error?: string }
  | { phase: 'connecting'; kind: SourceKind; host: string };

/** Tarjeta grande de una fuente de tiempos (PitWall o TicTac). */
function Fuente({ titulo, subtitulo, marca, fondo, tinta, borde, chip, onPress }: {
  titulo: string;
  subtitulo: string;
  marca: string;
  fondo: string;
  tinta: string;
  /** Borde de la tarjeta; sin él, la tarjeta no lleva. */
  borde?: string;
  /** Fondo del círculo de la flecha; por defecto, el color del texto. */
  chip?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fuente, { backgroundColor: fondo },
        borde ? { borderWidth: 1, borderColor: borde } : null, pressed && styles.fuentePulsada,
      ]}
    >
      {/* Marca de agua: da cuerpo a la tarjeta sin competir con el texto. */}
      <Text style={[styles.marca, { color: tinta }]}>{marca}</Text>
      <View style={styles.fuenteTextos}>
        <Text style={[styles.fuenteTitulo, { color: tinta }]}>{titulo}</Text>
        <Text style={[styles.fuenteSub, { color: tinta }]}>{subtitulo}</Text>
      </View>
      <View style={[styles.flecha, { backgroundColor: chip ?? tinta }]}>
        <Text style={[styles.flechaTexto, { color: chip ? tinta : fondo }]}>→</Text>
      </View>
    </Pressable>
  );
}

export default function DiscoveryScreen({ navigation }: Props) {
  const { setSource, clearSource } = useDataSource();
  const insets = useSafeAreaInsets();
  const { t } = useIdioma();
  const tRef = useRef(t);
  tRef.current = t;
  const [mode, setMode] = useState<Mode>({ phase: 'choose' });
  const [manualHost, setManualHost] = useState('');

  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Ref para usar clearSource en los efectos sin re-dispararlos cada vez que
  // cambia la fuente (clearSource depende de `source`).
  const clearSourceRef = useRef(clearSource);
  clearSourceRef.current = clearSource;

  // Si volvemos a esta pantalla (back desde RacePicker/Select/etc),
  // reseteamos al estado inicial pero NO desconectamos la fuente aquí: se
  // libera al lanzar una nueva búsqueda o conexión manual.
  useFocusEffect(
    useCallback(() => {
      if (modeRef.current.phase !== 'choose') {
        setMode({ phase: 'choose' });
      }
    }, []),
  );

  // Cargar última IP manual usada para la fuente actualmente elegida.
  useEffect(() => {
    if (mode.phase !== 'manual' && mode.phase !== 'connecting') return;
    AsyncStorage.getItem(LAST_HOST_KEY(mode.kind)).then(v => {
      if (v) setManualHost(v);
    });
  }, [mode.phase, mode.phase === 'manual' || mode.phase === 'connecting' ? mode.kind : null]);

  // Lanzar auto-discovery cuando entramos en 'searching'.
  useEffect(() => {
    if (mode.phase !== 'searching') return;
    const kind = mode.kind;
    let cancelled = false;
    // Una nueva búsqueda libera la fuente anterior: TicTac antiguo necesita el
    // puerto UDP 12543, y si sigue cogido por la conexión previa las
    // respuestas le llegan a ese socket y esta búsqueda caduca.
    clearSourceRef.current();

    discover({ kind })
      .then(result => {
        if (cancelled || modeRef.current.phase !== 'searching') {
          descartar(result);
          return;
        }
        if (result) {
          routeToNext(result);
        } else {
          setMode({ phase: 'manual', kind });
        }
      })
      .catch(err => {
        if (cancelled) return;
        setMode({ phase: 'manual', kind, error: err?.message ?? String(err) });
      });

    return () => { cancelled = true; };
  }, [mode.phase === 'searching' ? mode.kind : null]);

  // Lanzar conexión manual cuando entramos en 'connecting'.
  useEffect(() => {
    if (mode.phase !== 'connecting') return;
    const { kind, host } = mode;
    let cancelled = false;
    clearSourceRef.current();

    discover({ kind, manualHost: host })
      .then(result => {
        if (cancelled || modeRef.current.phase !== 'connecting') {
          descartar(result);
          return;
        }
        if (result) {
          void AsyncStorage.setItem(LAST_HOST_KEY(kind), host);
          routeToNext(result);
        } else {
          setMode({ phase: 'manual', kind, error: tRef.current.inicio.noConecto(host) });
        }
      })
      .catch(err => {
        if (!cancelled) {
          setMode({ phase: 'manual', kind, error: err?.message ?? String(err) });
        }
      });

    return () => { cancelled = true; };
  }, [mode.phase === 'connecting' ? `${mode.kind}|${mode.host}` : null]);

  // Resultado que llega cuando el usuario ya cambió de modo: si trae una
  // fuente conectada (InfoLap) hay que cerrarla, o deja el socket cogido.
  function descartar(result: import('../data/discovery').DiscoveryResult | null) {
    if (result?.kind === 'infolap') {
      try { result.source.disconnect(); } catch { /* ignore */ }
    }
  }

  // Decide la siguiente pantalla según la fuente:
  //   • PitWall → RacePicker (puede haber varias carreras activas).
  //   • InfoLap  → Select directamente (no hay multi-carrera).
  function routeToNext(result: import('../data/discovery').DiscoveryResult) {
    // push (no replace) → mantenemos Discovery en el stack para que la
    // siguiente pantalla pueda volver atrás.
    if (result.kind === 'pitwall') {
      navigation.push('RacePicker', { host: result.server.host, port: result.server.port });
    } else {
      setSource(result.source, result.raceInfo);
      navigation.push('Select');
    }
  }

  // ── Render por phase ────────────────────────────────────────────────────

  if (mode.phase === 'choose') {
    // Solo volver y las dos fuentes: cada una ocupa media pantalla, así el
    // toque en pista es grande y no hay nada más que mirar.
    return (
      <View style={[styles.chooseRoot, { paddingBottom: insets.bottom + 20 }]}>
        <BackButton />
        <View style={styles.fuentes}>
          <Fuente
            titulo="PitWall"
            subtitulo={t.inicio.pitwallSub}
            marca="PW"
            fondo={colors.accentFill}
            tinta="#ffffff"
            onPress={() => setMode({ phase: 'searching', kind: 'pitwall' })}
          />
          <Fuente
            titulo="TicTac"
            subtitulo={t.inicio.tictacSub}
            marca="TT"
            fondo={colors.surface}
            tinta={colors.textSoft}
            borde={colors.border}
            chip={colors.surfaceRaised}
            onPress={() => setMode({ phase: 'searching', kind: 'infolap' })}
          />
        </View>
      </View>
    );
  }

  if (mode.phase === 'searching') {
    const label = mode.kind === 'pitwall' ? 'PitWall' : 'TicTac';
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{label}</Text>
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 32 }} />
        <Text style={styles.phase}>{t.inicio.buscando(label)}</Text>
        {/* Salida directa a IP manual, sin esperar al timeout de la búsqueda. */}
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, { marginTop: 28 }]}
          onPress={() => setMode({ phase: 'manual', kind: mode.kind })}
        >
          <Text style={styles.btnGhostText}>{t.inicio.ipManual}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode({ phase: 'choose' })}>
          <Text style={styles.backText}>{t.comun.cancelar}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mode.phase === 'connecting') {
    const label = mode.kind === 'pitwall' ? 'PitWall' : 'TicTac';
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{label}</Text>
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 32 }} />
        <Text style={styles.phase}>{t.inicio.conectandoA(mode.host)}</Text>
      </View>
    );
  }

  // mode.phase === 'manual'
  const label = mode.kind === 'pitwall' ? 'PitWall' : 'TicTac';
  const submit = () => {
    if (!manualHost.trim()) return;
    Keyboard.dismiss();
    setMode({ phase: 'connecting', kind: mode.kind, host: manualHost.trim() });
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{label}</Text>
      <Text style={styles.errorTitle}>
        {mode.error ? t.inicio.noEncontrado : t.inicio.conexionManual}
      </Text>
      {mode.error && <Text style={styles.errorBody}>{mode.error}</Text>}
      <Text style={styles.errorBody}>{t.inicio.introduceIp}</Text>

      <View style={styles.manualBlock}>
        <Text style={styles.manualLabel}>{t.inicio.ipServidor}</Text>
        <TextInput
          style={styles.input}
          value={manualHost}
          onChangeText={setManualHost}
          placeholder="192.168.10.99"
          placeholderTextColor="#5a6573"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, !manualHost.trim() && styles.btnDisabled]}
          onPress={submit}
          disabled={!manualHost.trim()}
        >
          <Text style={styles.btnPrimaryText}>{t.inicio.conectarA(label)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => setMode({ phase: 'searching', kind: mode.kind })}
        >
          <Text style={styles.btnGhostText}>{t.inicio.reintentar}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode({ phase: 'choose' })}>
          <Text style={styles.backText}>{t.inicio.volverInicio}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, backgroundColor: '#0a0d13',
  },
  title: { color: colors.text, fontSize: 36, fontWeight: '700' },
  phase: { color: '#cfd5dc', fontSize: 16, marginTop: 16, textAlign: 'center' },

  errorTitle: { color: '#ff6b6b', fontSize: 20, fontWeight: '600', marginTop: 32 },
  errorBody: {
    color: '#9aa3ad', fontSize: 14, textAlign: 'center',
    marginTop: 12, lineHeight: 20,
  },
  manualBlock: { marginTop: 24, width: '100%' },
  manualLabel: { color: '#9aa3ad', fontSize: 12, textTransform: 'uppercase', marginBottom: 8 },
  input: {
    backgroundColor: '#141923', color: '#fff', fontSize: 18,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8,
    borderColor: '#3a4350', borderWidth: 1,
  },
  btn: { marginTop: 12, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.accentFill },
  btnPrimaryText: { color: colors.onAccent, fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
  btnGhost: { borderColor: '#3a4350', borderWidth: 1 },
  btnGhostText: { color: '#cfd5dc', fontSize: 14 },

  backBtn: { marginTop: 24, paddingVertical: 8 },
  backText: { color: '#9aa3ad', fontSize: 14, textDecorationLine: 'underline' },

  chooseRoot: { flex: 1, backgroundColor: '#0a0d13', paddingHorizontal: 20 },
  fuentes: { flex: 1, gap: 16, paddingTop: 8 },
  fuente: {
    flex: 1, borderRadius: 28, padding: 24, overflow: 'hidden',
    justifyContent: 'flex-end', maxHeight: 360,
  },
  fuentePulsada: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  marca: {
    position: 'absolute', top: -18, right: 6, fontSize: 150, fontWeight: '900',
    opacity: 0.14, letterSpacing: -6,
  },
  fuenteTextos: { paddingRight: 64 },
  fuenteTitulo: { fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  fuenteSub: { fontSize: 14, marginTop: 6, opacity: 0.8, lineHeight: 20 },
  flecha: {
    position: 'absolute', right: 20, bottom: 20, width: 48, height: 48,
    borderRadius: 24, alignItems: 'center', justifyContent: 'center',
  },
  flechaTexto: { fontSize: 24, fontWeight: '700', marginTop: -2 },
});
