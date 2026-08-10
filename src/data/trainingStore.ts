// Almacén local de "stints" de entrenamiento.
//
// Un stint es una tanda de práctica que el piloto delimita él mismo con
// el botón "Entreno GO": al activarlo empezamos a capturar cada vuelta;
// al detenerlo guardamos aquí el array completo de tiempos. Todo es
// 100 % local del móvil (AsyncStorage) — no interviene el servidor.

import AsyncStorage from '@react-native-async-storage/async-storage';

const INDEX_KEY = '@pitwall/training/index/v1';
const ENTRY_KEY = (id: string) => `@pitwall/training/entry/${id}`;

/** Datos opcionales del coche/setup para poder comparar stints. */
export interface StintSetup {
  carModel?: string;   // modelo de coche
  motor?: string;      // motor
  tire?: string;       // neumático
  rim?: string;        // medida de llanta
  crown?: string;      // corona
  pinion?: string;     // piñón
}

/** Metadatos de un stint (lo que va en el índice y en la lista). */
export interface StintMeta {
  id: string;
  savedAt: string;            // ISO
  lane: number | null;
  lapCount: number;
  bestMs: number | null;
  avgMs: number | null;
  setup: StintSetup;
}

/** Stint completo con todos los tiempos de vuelta. */
export interface Stint extends StintMeta {
  lapTimes: number[];         // ms, en orden
}

function summarize(lapTimes: number[]): { lapCount: number; bestMs: number | null; avgMs: number | null } {
  if (lapTimes.length === 0) return { lapCount: 0, bestMs: null, avgMs: null };
  const best = Math.min(...lapTimes);
  const avg = lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length;
  return { lapCount: lapTimes.length, bestMs: best, avgMs: Math.round(avg) };
}

// ── Listado ──────────────────────────────────────────────────────────────

export async function listStints(): Promise<StintMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const list: StintMeta[] = JSON.parse(raw);
    return list.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
  } catch {
    return [];
  }
}

// ── Lectura ──────────────────────────────────────────────────────────────

export async function getStint(id: string): Promise<Stint | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTRY_KEY(id));
    return raw ? (JSON.parse(raw) as Stint) : null;
  } catch {
    return null;
  }
}

// ── Guardar un stint nuevo ───────────────────────────────────────────────

export async function saveStint(
  lapTimes: number[],
  lane: number | null,
  setup: StintSetup,
): Promise<string> {
  const id = `${Date.now()}`;
  const stint: Stint = {
    id,
    savedAt: new Date().toISOString(),
    lane,
    setup,
    lapTimes,
    ...summarize(lapTimes),
  };
  try {
    await AsyncStorage.setItem(ENTRY_KEY(id), JSON.stringify(stint));
    const list = await listStints();
    const { lapTimes: _omit, ...meta } = stint;
    void _omit;
    list.unshift(meta);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[training] saveStint failed:', e);
  }
  return id;
}

// ── Actualizar el setup de un stint existente ────────────────────────────

export async function updateStintSetup(id: string, setup: StintSetup): Promise<void> {
  try {
    const stint = await getStint(id);
    if (!stint) return;
    stint.setup = setup;
    await AsyncStorage.setItem(ENTRY_KEY(id), JSON.stringify(stint));
    const list = await listStints();
    const next = list.map(m => (m.id === id ? { ...m, setup } : m));
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('[training] updateStintSetup failed:', e);
  }
}

// ── Borrar ───────────────────────────────────────────────────────────────

export async function deleteStint(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(ENTRY_KEY(id));
    const list = await listStints();
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list.filter(m => m.id !== id)));
  } catch (e) {
    console.warn('[training] deleteStint failed:', e);
  }
}

/** Etiqueta corta legible a partir del setup (para listas y leyendas). */
export function stintSetupLabel(setup: StintSetup): string {
  const parts = [
    setup.carModel, setup.motor, setup.tire, setup.rim, setup.crown, setup.pinion,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.join(' · ');
}
