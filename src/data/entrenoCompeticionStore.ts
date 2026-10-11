// Almacén local de los entrenos de competición descargados (AsyncStorage), para
// consultarlos sin conexión. El índice lleva solo el resumen; cada sesión
// completa va en su propia clave.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { EntrenoCompeticion } from './entrenoCompeticion';

const INDEX_KEY = '@pitwall/entreno-competicion/index/v1';
const ENTRY_KEY = (id: string) => `@pitwall/entreno-competicion/entry/${id}`;

/** Lo que va en el índice: lo justo para pintar la lista. */
export interface EntrenoCompeticionMeta {
  id: string;
  startedAt: string | null;
  descargadoEn: string;
  heats: number;
  participantes: number;
  vueltas: number;
  mejorMs: number | null;
}

function metaDe(e: EntrenoCompeticion): EntrenoCompeticionMeta {
  const mejores = e.standings.map(s => s.bestLapMs).filter((x): x is number => x != null);
  return {
    id: e.id,
    startedAt: e.startedAt,
    descargadoEn: e.descargadoEn,
    heats: e.heats.length,
    participantes: e.standings.length,
    vueltas: e.standings.reduce((a, s) => a + s.laps, 0),
    mejorMs: mejores.length > 0 ? Math.min(...mejores) : null,
  };
}

/** Descargados, el más reciente primero (por fecha de la sesión). */
export async function listEntrenosCompeticion(): Promise<EntrenoCompeticionMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const lista: EntrenoCompeticionMeta[] = raw ? JSON.parse(raw) : [];
    return lista.sort((a, b) =>
      (b.startedAt ?? b.descargadoEn).localeCompare(a.startedAt ?? a.descargadoEn));
  } catch {
    return [];
  }
}

export async function getEntrenoCompeticion(id: string): Promise<EntrenoCompeticion | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTRY_KEY(id));
    return raw ? (JSON.parse(raw) as EntrenoCompeticion) : null;
  } catch {
    return null;
  }
}

/** Guarda la sesión; si ya estaba, la reemplaza. */
export async function saveEntrenoCompeticion(e: EntrenoCompeticion): Promise<void> {
  await AsyncStorage.setItem(ENTRY_KEY(e.id), JSON.stringify(e));
  const lista = (await listEntrenosCompeticion()).filter(m => m.id !== e.id);
  lista.push(metaDe(e));
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(lista));
}

export async function deleteEntrenoCompeticion(id: string): Promise<void> {
  await AsyncStorage.removeItem(ENTRY_KEY(id));
  const lista = (await listEntrenosCompeticion()).filter(m => m.id !== id);
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(lista));
}
