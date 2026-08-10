// Almacén local de carreras pasadas. El servidor PitWall envía un
// snapshot completo (`race:stats-snapshot`) cuando termina una carrera;
// lo persistimos aquí para que el piloto pueda revisar resultados
// aunque el servidor esté apagado.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RaceStatsSnapshot } from './types';

const INDEX_KEY = '@pitwall/history/index/v1';
const ENTRY_KEY = (id: string | number) => `@pitwall/history/entry/${id}`;

export interface HistoryEntryMeta {
  raceId: number | string;
  name: string;
  format: 'team' | 'individual';
  finishedAt: string;
  savedAt: string;
}

// ── Listado de entradas (ordenadas por fecha desc) ──────────────────────

export async function listHistory(): Promise<HistoryEntryMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const list: HistoryEntryMeta[] = JSON.parse(raw);
    return list.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
  } catch {
    return [];
  }
}

// ── Lectura de una entrada ──────────────────────────────────────────────

export async function getSnapshot(raceId: number | string): Promise<RaceStatsSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTRY_KEY(raceId));
    return raw ? JSON.parse(raw) as RaceStatsSnapshot : null;
  } catch {
    return null;
  }
}

// ── Guardar / actualizar ─────────────────────────────────────────────────

export async function saveSnapshot(snapshot: RaceStatsSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(ENTRY_KEY(snapshot.raceId), JSON.stringify(snapshot));
    // Actualizar índice (upsert by raceId).
    const list = await listHistory();
    const filtered = list.filter(e => String(e.raceId) !== String(snapshot.raceId));
    filtered.unshift({
      raceId:     snapshot.raceId,
      name:       snapshot.name,
      format:     snapshot.format,
      finishedAt: snapshot.finishedAt,
      savedAt:    new Date().toISOString(),
    });
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[history] saveSnapshot failed:', e);
  }
}

// ── Actualizar campos sueltos de un snapshot (sin tocar el índice) ──────────

export async function updateSnapshot(
  raceId: number | string,
  patch: Partial<RaceStatsSnapshot>,
): Promise<void> {
  try {
    const snap = await getSnapshot(raceId);
    if (!snap) return;
    await AsyncStorage.setItem(ENTRY_KEY(raceId), JSON.stringify({ ...snap, ...patch }));
  } catch (e) {
    console.warn('[history] updateSnapshot failed:', e);
  }
}

// ── Borrar una entrada ───────────────────────────────────────────────────

export async function deleteSnapshot(raceId: number | string): Promise<void> {
  try {
    await AsyncStorage.removeItem(ENTRY_KEY(raceId));
    const list = await listHistory();
    await AsyncStorage.setItem(
      INDEX_KEY,
      JSON.stringify(list.filter(e => String(e.raceId) !== String(raceId))),
    );
  } catch (e) {
    console.warn('[history] deleteSnapshot failed:', e);
  }
}
