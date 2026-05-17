// Ajustes de voz persistentes. Cada flag se activa/desactiva con un botón en
// la pantalla MyTurn; los cambios se guardan en AsyncStorage para que la
// próxima carrera mantenga las preferencias.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = '@slotime/voice-settings/v1';

export interface VoiceSettings {
  /** Master mute. Si es false, no se dice nada. */
  enabled: boolean;

  // Básico
  sayLaps: boolean;             // tiempo de cada vuelta
  sayPositionChange: boolean;   // "has subido a 2º" / "te han adelantado"
  sayLastMinute: boolean;       // aviso 60s antes del fin
  sayLast30s: boolean;          // aviso 30s antes del fin

  // Avanzado
  sayAveragesEveryMin: number;  // 0 = off; entero ≥1 = cada N minutos
  sayGapsEveryMin: number;      // 0 = off; entero ≥1 = cada N minutos
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: true,
  sayLaps: true,
  sayPositionChange: true,
  sayLastMinute: true,
  sayLast30s: true,
  sayAveragesEveryMin: 0,
  sayGapsEveryMin: 0,
};

async function load(): Promise<VoiceSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function save(settings: VoiceSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* best-effort */ }
}

/** Hook: settings persistentes + setter inmediato. */
export function useVoiceSettings(): {
  settings: VoiceSettings;
  update: (patch: Partial<VoiceSettings>) => void;
  toggle: (key: keyof VoiceSettings) => void;
  ready: boolean;
} {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    load().then(s => { setSettings(s); setReady(true); });
  }, []);

  const update = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      void save(next);
      return next;
    });
  }, []);

  const toggle = useCallback((key: keyof VoiceSettings) => {
    setSettings(prev => {
      const cur = prev[key];
      if (typeof cur !== 'boolean') return prev;
      const next = { ...prev, [key]: !cur };
      void save(next);
      return next;
    });
  }, []);

  return { settings, update, toggle, ready };
}
