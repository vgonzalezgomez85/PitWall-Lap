// Pantalla inicial: el usuario elige primero qué fuente quiere usar
// (PitWall o TicTac/InfoLap). Tras elegir:
//   1. Auto-discovery para esa fuente (mDNS para PitWall, UDP broadcast
//      para InfoLap). ~6 s.
//   2. Si no encuentra → pantalla con input de IP + botón "Conectar".
//      Sigue limitado a la fuente elegida; no salta de una a otra.
//
// Persistimos la última IP manual usada por fuente en AsyncStorage para
// precargarla la próxima vez.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Keyboard, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { discover, type SourceKind } from '../data/discovery';
import { useDataSource } from '../data/sourceContext';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Discovery'>;

const LAST_HOST_KEY = (kind: SourceKind) => `@pitwall/last-host/${kind}`;

type Mode =
  | { phase: 'choose' }
  | { phase: 'searching'; kind: SourceKind }
  | { phase: 'manual';    kind: SourceKind; error?: string }
  | { phase: 'connecting'; kind: SourceKind; host: string };

export default function DiscoveryScreen({ navigation }: Props) {
  const { setSource } = useDataSource();
  const [mode, setMode] = useState<Mode>({ phase: 'choose' });
  const [manualHost, setManualHost] = useState('');

  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Si volvemos a esta pantalla (back desde RacePicker/Select/etc),
  // reseteamos al estado inicial pero NO desconectamos la fuente — si el
  // usuario vuelve a entrar al mismo flujo no quiere reconectar.
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

    discover({ kind })
      .then(result => {
        if (cancelled || modeRef.current.phase !== 'searching') return;
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

    discover({ kind, manualHost: host })
      .then(result => {
        if (cancelled || modeRef.current.phase !== 'connecting') return;
        if (result) {
          void AsyncStorage.setItem(LAST_HOST_KEY(kind), host);
          routeToNext(result);
        } else {
          setMode({ phase: 'manual', kind, error: `No se conectó a ${host}.` });
        }
      })
      .catch(err => {
        if (!cancelled) {
          setMode({ phase: 'manual', kind, error: err?.message ?? String(err) });
        }
      });

    return () => { cancelled = true; };
  }, [mode.phase === 'connecting' ? `${mode.kind}|${mode.host}` : null]);

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
    return (
      <View style={styles.root}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.subtitle}>Elige a qué cronometrador conectar</Text>
        <TouchableOpacity
          style={[styles.bigBtn, styles.btnPitWall]}
          onPress={() => setMode({ phase: 'searching', kind: 'pitwall' })}
        >
          <Text style={[styles.bigBtnTitle, { color: '#0a0d13' }]}>PitWall</Text>
          <Text style={[styles.bigBtnSub, { color: '#0a0d13' }]}>Cronómetro DS-300 con PitWall Manager</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bigBtn, styles.btnInfolap]}
          onPress={() => setMode({ phase: 'searching', kind: 'infolap' })}
        >
          <Text style={[styles.bigBtnTitle, { color: '#fff' }]}>TicTac</Text>
          <Text style={[styles.bigBtnSub, { color: '#fff' }]}>Gestor de Carreras (InfoLap)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.historyLink}
          onPress={() => navigation.push('History')}
        >
          <Text style={styles.historyLinkText}>Ver carreras pasadas</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.historyLink}
          onPress={() => navigation.push('Training')}
        >
          <Text style={styles.historyLinkText}>Mis entrenamientos</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mode.phase === 'searching') {
    const label = mode.kind === 'pitwall' ? 'PitWall' : 'TicTac';
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{label}</Text>
        <ActivityIndicator size="large" color="#f6c90e" style={{ marginTop: 32 }} />
        <Text style={styles.phase}>Buscando {label}…</Text>
        {/* Salida directa a IP manual, sin esperar al timeout de la búsqueda. */}
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, { marginTop: 28 }]}
          onPress={() => setMode({ phase: 'manual', kind: mode.kind })}
        >
          <Text style={styles.btnGhostText}>Introducir IP manualmente</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode({ phase: 'choose' })}>
          <Text style={styles.backText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mode.phase === 'connecting') {
    const label = mode.kind === 'pitwall' ? 'PitWall' : 'TicTac';
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{label}</Text>
        <ActivityIndicator size="large" color="#f6c90e" style={{ marginTop: 32 }} />
        <Text style={styles.phase}>Conectando a {mode.host}…</Text>
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
        {mode.error ? 'No se encontró automáticamente' : 'Conexión manual'}
      </Text>
      {mode.error && <Text style={styles.errorBody}>{mode.error}</Text>}
      <Text style={styles.errorBody}>Introduce la IP del servidor manualmente.</Text>

      <View style={styles.manualBlock}>
        <Text style={styles.manualLabel}>IP del servidor</Text>
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
          <Text style={styles.btnPrimaryText}>Conectar a {label}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => setMode({ phase: 'searching', kind: mode.kind })}
        >
          <Text style={styles.btnGhostText}>Reintentar búsqueda automática</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode({ phase: 'choose' })}>
          <Text style={styles.backText}>Volver al inicio</Text>
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
  title: { color: '#f6c90e', fontSize: 36, fontWeight: '700' },
  logo: { width: 120, height: 120, marginBottom: 16 },
  subtitle: { color: '#9aa3ad', fontSize: 14, marginTop: 8, marginBottom: 32 },
  phase: { color: '#cfd5dc', fontSize: 16, marginTop: 16, textAlign: 'center' },

  bigBtn: {
    width: '100%', paddingVertical: 28, paddingHorizontal: 20,
    borderRadius: 12, marginTop: 16, alignItems: 'center',
  },
  btnPitWall: { backgroundColor: '#f6c90e' },
  btnInfolap:  { backgroundColor: '#2c5cdd' },
  bigBtnTitle: { fontSize: 26, fontWeight: '800' },
  bigBtnSub:   { fontSize: 13, marginTop: 6, opacity: 0.85 },
  // bigBtn text colors set inline via parent style — but we override
  // separately. To keep TS happy and styles flat:
  // (using inline color via wrapper Text styles below)

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
  btnPrimary: { backgroundColor: '#f6c90e' },
  btnPrimaryText: { color: '#0a0d13', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
  btnGhost: { borderColor: '#3a4350', borderWidth: 1 },
  btnGhostText: { color: '#cfd5dc', fontSize: 14 },

  backBtn: { marginTop: 24, paddingVertical: 8 },
  backText: { color: '#9aa3ad', fontSize: 14, textDecorationLine: 'underline' },

  historyLink: { marginTop: 32, paddingVertical: 8 },
  historyLinkText: { color: '#9aa3ad', fontSize: 14, textDecorationLine: 'underline' },
});
