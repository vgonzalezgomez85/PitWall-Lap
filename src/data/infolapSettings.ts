// Duración de manga para TicTac. El TicTac no la transmite, así que la
// configura el usuario (persistente). 0 = sin configurar → sin tiempo
// restante, avisos de fin, proyección ni media para subir.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = '@pitwall/infolap/manga-duration-min/v1';
export const MANGA_DURATION_MAX_MIN = 120;

export async function loadMangaDurationMin(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const n = raw != null ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? Math.min(n, MANGA_DURATION_MAX_MIN) : 0;
  } catch {
    return 0;
  }
}

export function useMangaDurationMin(): [number, (min: number) => void] {
  const [min, setMin] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadMangaDurationMin().then(v => { if (alive) setMin(v); });
    return () => { alive = false; };
  }, []);
  const update = useCallback((next: number) => {
    const v = Math.max(0, Math.min(MANGA_DURATION_MAX_MIN, Math.round(next)));
    setMin(v);
    void AsyncStorage.setItem(KEY, String(v)).catch(() => {});
  }, []);
  return [min, update];
}
