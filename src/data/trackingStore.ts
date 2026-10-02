// Persistencia local del seguimiento de rivales (AsyncStorage):
//   • TicTac: el acumulado por carril (laneTracking.ts) y la lista de
//     seguidos, ambos solo en este móvil;
//   • PitWall: el PIN del equipo para cambiar la lista (la lista y los datos
//     viven en el servidor).

import AsyncStorage from '@react-native-async-storage/async-storage';

import { LaneTracker } from './laneTracking';

const TRACKER_KEY = '@pitwall/tracking/infolap/data/v1';
const RIVALS_KEY = '@pitwall/tracking/infolap/rivals/v1';
const PIN_KEY = (raceId: number, team: string) => `@pitwall/tracking/pin/${raceId}/${team}`;

/** El acumulado guardado solo se recupera si hubo vueltas hace menos de esto
 *  (la app se cerró a mitad de carrera); si no, es de otra carrera. */
export const TRACKER_RESTORE_MS = 60 * 60_000;

export async function loadTracker(now = Date.now()): Promise<LaneTracker | null> {
  try {
    const raw = await AsyncStorage.getItem(TRACKER_KEY);
    if (!raw) return null;
    const t = LaneTracker.fromJSON(JSON.parse(raw));
    if (!t || t.lastActivityAt === 0 || now - t.lastActivityAt > TRACKER_RESTORE_MS) return null;
    return t;
  } catch {
    return null;
  }
}

export async function saveTracker(t: LaneTracker): Promise<void> {
  try {
    await AsyncStorage.setItem(TRACKER_KEY, JSON.stringify(t.toJSON()));
  } catch { /* sin almacenamiento: se pierde al cerrar la app */ }
}

export async function loadLocalRivals(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RIVALS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveLocalRivals(names: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RIVALS_KEY, JSON.stringify(names));
  } catch { /* ignore */ }
}

export async function loadTeamPin(raceId: number, team: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PIN_KEY(raceId, team));
  } catch {
    return null;
  }
}

export async function saveTeamPin(raceId: number, team: string, pin: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PIN_KEY(raceId, team), pin);
  } catch { /* ignore */ }
}
