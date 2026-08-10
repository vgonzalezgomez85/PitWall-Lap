// Migración única de las claves AsyncStorage legadas (@slotime/, @voltrace/)
// a la familia @pitwall/. Se ejecuta una vez al arrancar la app (ver
// App.tsx) para que quien ya tenía la app instalada no pierda su
// historial, sus stints de entreno ni sus ajustes de voz.

import AsyncStorage from '@react-native-async-storage/async-storage';

const DONE_KEY = '@pitwall/migrated-legacy-storage/v1';

async function migrateKey(oldKey: string, newKey: string): Promise<void> {
  try {
    const already = await AsyncStorage.getItem(newKey);
    if (already != null) return;
    const legacy = await AsyncStorage.getItem(oldKey);
    if (legacy == null) return;
    await AsyncStorage.setItem(newKey, legacy);
    await AsyncStorage.removeItem(oldKey);
  } catch (e) {
    console.warn('[migrateStorage] fallo migrando', oldKey, e);
  }
}

/** Copia el índice de una lista (historial/entrenos) y devuelve los ids para migrar sus entradas. */
async function readIds(indexKey: string, idField: string): Promise<Array<string | number>> {
  try {
    const raw = await AsyncStorage.getItem(indexKey);
    if (!raw) return [];
    const list = JSON.parse(raw) as Array<Record<string, unknown>>;
    return list.map(e => e[idField] as string | number).filter(id => id != null);
  } catch {
    return [];
  }
}

export async function migrateLegacyStorage(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(DONE_KEY)) return;

    await migrateKey('@slotime/last-host/slottime', '@pitwall/last-host/pitwall');
    await migrateKey('@slotime/last-host/infolap', '@pitwall/last-host/infolap');
    await migrateKey('@slotime/voice-settings/v1', '@pitwall/voice-settings/v1');

    await migrateKey('@slotime/history/index/v1', '@pitwall/history/index/v1');
    const historyIds = await readIds('@pitwall/history/index/v1', 'raceId');
    for (const id of historyIds) {
      await migrateKey(`@slotime/history/entry/${id}`, `@pitwall/history/entry/${id}`);
    }

    await migrateKey('@voltrace/training/index/v1', '@pitwall/training/index/v1');
    const trainingIds = await readIds('@pitwall/training/index/v1', 'id');
    for (const id of trainingIds) {
      await migrateKey(`@voltrace/training/entry/${id}`, `@pitwall/training/entry/${id}`);
    }

    await AsyncStorage.setItem(DONE_KEY, '1');
  } catch (e) {
    console.warn('[migrateStorage] fallo general:', e);
  }
}
