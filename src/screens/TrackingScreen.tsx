// Pantalla "Seguimiento" — seguimiento de rivales por carril.
//
// Mi equipo/piloto (el participante seleccionado, marcado «Tú») y hasta 5
// más que elijo seguir, cada uno con una tabla por carril: vueltas, rápida y
// media (y «Limpia», sin salidas, solo con PitWall). Solo cuentan las mangas
// terminadas. Con PitWall los datos y la lista vienen del servidor (los
// comparte el Lap web del box) y cambiar la lista puede pedir el PIN del
// equipo; con TicTac todo se calcula y guarda en este móvil.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { useDataSource } from '../data/sourceContext';
import { loadTeamPin, saveTeamPin } from '../data/trackingStore';
import type { TrackingData, TrackingLane, TrackingTeam } from '../data/types';
import BackButton from '../ui/BackButton';

const REFRESH_MS = 60_000;

function fmt(ms: number | null): string {
  if (ms == null) return '—';
  const totalCs = Math.round(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

type Status = 'loading' | 'ok' | 'unavailable' | 'error';

export default function TrackingScreen() {
  const { source, raceInfo } = useDataSource();
  const [data, setData] = useState<TrackingData | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [askPin, setAskPin] = useState<{ names: string[]; wrong: boolean } | null>(null);
  const [pinText, setPinText] = useState('');

  const refresh = useCallback(async () => {
    if (!source?.getTracking) { setStatus('unavailable'); return; }
    try {
      const d = await source.getTracking();
      setData(d);
      setStatus(d ? 'ok' : 'unavailable');
    } catch {
      // Red caída: conservamos lo que se veía.
      setStatus(prev => (prev === 'ok' ? 'ok' : 'error'));
    }
  }, [source]);

  useEffect(() => {
    void refresh();
    const unsub = source?.onTrackingChange?.(() => { void refresh(); });
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { unsub?.(); clearInterval(timer); };
  }, [source, refresh]);

  const me = data?.teams.find(t => t.isMe) ?? null;
  const raceId = raceInfo?.source === 'pitwall' ? raceInfo.raceId ?? null : null;

  function startEditing() {
    setSelected(data?.tracked ?? []);
    setEditing(true);
  }

  function toggle(name: string) {
    setSelected(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (data && prev.length >= data.max) return prev;
      return [...prev, name];
    });
  }

  async function save(names: string[], typedPin?: string) {
    if (!source?.setTracked) return;
    setSaving(true);
    const storedPin = typedPin
      ?? (data?.pinRequired && raceId != null && me ? await loadTeamPin(raceId, me.name) : null);
    const res = await source.setTracked(names, storedPin ?? undefined);
    setSaving(false);
    if (res.ok) {
      if (typedPin && raceId != null && me) await saveTeamPin(raceId, me.name, typedPin);
      setAskPin(null);
      setPinText('');
      setEditing(false);
      void refresh();
    } else if (res.error === 'pin') {
      setAskPin({ names, wrong: storedPin != null });
    } else {
      Alert.alert('No se pudo guardar', res.error === 'network'
        ? 'Sin conexión con el servidor. Inténtalo de nuevo.'
        : 'El seguimiento no está disponible en esta carrera.');
    }
  }

  function confirmReset() {
    Alert.alert(
      'Reiniciar datos',
      'Borra el acumulado por carril guardado en este móvil. La lista de seguidos se mantiene.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reiniciar', style: 'destructive', onPress: () => { source?.resetTracking?.(); } },
      ],
    );
  }

  if (status !== 'ok' || !data) {
    return (
      <View style={styles.root}>
        <BackButton />
        <Text style={styles.title}>Seguimiento</Text>
        <View style={styles.center}>
          {status === 'loading' ? <ActivityIndicator color="#f6c90e" /> : (
            <Text style={styles.muted}>
              {status === 'error'
                ? 'No se pudo cargar el seguimiento. Se reintentará en un minuto.'
                : 'El seguimiento de rivales está disponible con TicTac y en carreras por equipos de PitWall, con un participante seleccionado.'}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <BackButton />
      <Text style={styles.title}>Seguimiento</Text>
      <Text style={styles.note}>
        Solo mangas terminadas: la manga en curso entra al cerrarse.
        {data.local ? ' Datos de este móvil, desde que se conectó.' : ''}
      </Text>

      {data.teams.map(t => <TeamCard key={`${t.isMe ? 'me' : 't'}-${t.name}`} team={t} hasClean={data.hasClean} />)}

      {!editing ? (
        <Pressable style={styles.outlineBtn} onPress={startEditing}>
          <Text style={styles.outlineBtnText}>
            {data.tracked.length > 0 ? 'Cambiar rivales' : 'Elegir rivales'} ({data.tracked.length}/{data.max})
          </Text>
        </Pressable>
      ) : (
        <View style={styles.block}>
          <Text style={styles.label}>Rivales a seguir · máx. {data.max}</Text>
          {data.candidates.length === 0 && (
            <Text style={styles.mutedLeft}>Todavía no hay a quién seguir.</Text>
          )}
          {data.candidates.map(c => {
            const on = selected.includes(c.name);
            const full = !on && selected.length >= data.max;
            return (
              <Pressable key={c.name} style={styles.checkRow} onPress={() => toggle(c.name)} disabled={full}>
                <Text style={[styles.check, on && styles.checkOn]}>{on ? '☑' : '☐'}</Text>
                {c.color && <View style={[styles.dot, { backgroundColor: c.color }]} />}
                <Text style={[styles.checkName, full && styles.dim]}>{c.name}</Text>
              </Pressable>
            );
          })}
          <View style={styles.btnRow}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setEditing(false)}>
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => void save(selected)} disabled={saving}>
              <Text style={styles.btnPrimaryText}>{saving ? 'Guardando…' : 'Guardar'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {data.local && (
        <Pressable style={styles.resetBtn} onPress={confirmReset}>
          <Text style={styles.resetBtnText}>Reiniciar datos</Text>
        </Pressable>
      )}

      <Modal visible={askPin != null} transparent animationType="fade" onRequestClose={() => setAskPin(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>PIN del equipo</Text>
            <Text style={styles.modalText}>
              {askPin?.wrong ? 'PIN incorrecto. ' : ''}Para cambiar la lista hace falta el PIN de 4 cifras
              de tu equipo (el de la hoja de PINs de la carrera).
            </Text>
            <TextInput
              style={styles.pinInput}
              value={pinText}
              onChangeText={t => setPinText(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              autoFocus
              secureTextEntry
            />
            <View style={styles.btnRow}>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => { setAskPin(null); setPinText(''); }}>
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                disabled={pinText.length !== 4 || saving}
                onPress={() => askPin && void save(askPin.names, pinText)}
              >
                <Text style={styles.btnPrimaryText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function TeamCard({ team, hasClean }: { team: TrackingTeam; hasClean: boolean }) {
  return (
    <View style={[styles.card, team.isMe && styles.cardMe]}>
      <View style={styles.cardHead}>
        {team.color && <View style={[styles.dot, { backgroundColor: team.color }]} />}
        <Text style={styles.cardName} numberOfLines={1}>{team.name}</Text>
        {team.isMe && <Text style={styles.meBadge}>Tú</Text>}
      </View>
      {team.lanes.length === 0 ? (
        <Text style={styles.mutedLeft}>Sin mangas terminadas todavía.</Text>
      ) : (
        <>
          <Row cells={['Carril', 'Vueltas', 'Rápida', 'Media', ...(hasClean ? ['Limpia'] : [])]} head />
          {team.lanes.map(l => <LaneRow key={l.lane} lane={l} hasClean={hasClean} />)}
          <Row
            cells={['Total', String(team.laps), fmt(team.bestMs), fmt(team.avgMs), ...(hasClean ? [fmt(team.avgCleanMs)] : [])]}
            total
          />
        </>
      )}
    </View>
  );
}

function LaneRow({ lane, hasClean }: { lane: TrackingLane; hasClean: boolean }) {
  return (
    <Row cells={[
      String(lane.lane), String(lane.laps), fmt(lane.bestMs), fmt(lane.avgMs),
      ...(hasClean ? [fmt(lane.avgCleanMs)] : []),
    ]} />
  );
}

function Row({ cells, head, total }: { cells: string[]; head?: boolean; total?: boolean }) {
  return (
    <View style={[styles.row, total && styles.rowTotal]}>
      {cells.map((c, i) => (
        <Text key={i} style={[styles.cell, i === 0 && styles.cellFirst, head && styles.cellHead, total && styles.cellTotal]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 12 },
  note: { color: '#7f8a97', fontSize: 13, marginTop: 6, lineHeight: 18 },
  muted: { color: '#9aa3ad', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  mutedLeft: { color: '#9aa3ad', fontSize: 14, marginTop: 8 },
  dim: { color: '#566170' },

  card: { marginTop: 14, padding: 14, backgroundColor: '#141923', borderRadius: 10 },
  cardMe: { borderWidth: 1, borderColor: '#f6c90e' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardName: { color: '#fff', fontSize: 18, fontWeight: '700', flexShrink: 1 },
  meBadge: {
    color: '#0a0d13', backgroundColor: '#f6c90e', fontSize: 12, fontWeight: '800',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  dot: { width: 12, height: 12, borderRadius: 6 },

  row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1f2633' },
  rowTotal: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: '#3a4350' },
  cell: { flex: 1, color: '#cfd5dc', fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
  cellFirst: { textAlign: 'left' },
  cellHead: { color: '#9aa3ad', fontSize: 11, textTransform: 'uppercase' },
  cellTotal: { color: '#fff', fontWeight: '700' },

  block: { marginTop: 18, padding: 16, backgroundColor: '#141923', borderRadius: 10 },
  label: { color: '#9aa3ad', fontSize: 12, textTransform: 'uppercase' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  check: { color: '#9aa3ad', fontSize: 20 },
  checkOn: { color: '#f6c90e' },
  checkName: { color: '#fff', fontSize: 16, flexShrink: 1 },

  outlineBtn: {
    marginTop: 18, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#f6c90e',
  },
  outlineBtnText: { color: '#f6c90e', fontSize: 15, fontWeight: '700' },
  resetBtn: { marginTop: 14, paddingVertical: 12, alignItems: 'center' },
  resetBtnText: { color: '#e07a7a', fontSize: 14, fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: '#3a4350' },
  btnGhostText: { color: '#cfd5dc', fontSize: 15, fontWeight: '600' },
  btnPrimary: { backgroundColor: '#f6c90e' },
  btnPrimaryText: { color: '#0a0d13', fontSize: 15, fontWeight: '700' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: '#141923', borderRadius: 12, padding: 20 },
  modalTitle: { color: '#f6c90e', fontSize: 20, fontWeight: '700' },
  modalText: { color: '#cfd5dc', fontSize: 14, marginTop: 8, lineHeight: 20 },
  pinInput: {
    marginTop: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#0a0d13',
    color: '#fff', fontSize: 28, textAlign: 'center', letterSpacing: 12,
    borderWidth: 1, borderColor: '#3a4350',
  },
});
