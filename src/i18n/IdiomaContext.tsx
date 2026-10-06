// Idioma de la app: preferencia persistente ("auto" = el del móvil) y los
// textos ya resueltos. Al cambiar, también se cambia la voz del TTS.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';

import { fijarVoz } from '../voice/speak';
import { textosDe, type Textos } from '.';
import {
  esIdioma, idiomaDelSistema, localeFechas, resolverIdioma, vozDe,
  type Idioma, type PreferenciaIdioma,
} from './idiomas';

const STORAGE_KEY = '@pitwall/idioma/v1';

interface IdiomaCtx {
  idioma: Idioma;
  preferencia: PreferenciaIdioma;
  /** Idioma del móvil, para mostrarlo junto a la opción "Automático". */
  idiomaSistema: Idioma;
  setPreferencia: (p: PreferenciaIdioma) => void;
  t: Textos;
  /** Locale para toLocaleString de fechas. */
  locale: string;
}

const Ctx = createContext<IdiomaCtx | null>(null);

function codigosSistema(): string[] {
  try {
    return getLocales().map(l => l.languageTag ?? l.languageCode ?? '');
  } catch {
    return [];
  }
}

export function IdiomaProvider({ children }: { children: ReactNode }) {
  const [preferencia, setPref] = useState<PreferenciaIdioma>('auto');
  // Se lee una vez: si el usuario cambia el idioma del móvil, iOS/Android
  // reinician la app de todos modos.
  const [sistema] = useState(codigosSistema);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => { if (v === 'auto' || esIdioma(v)) setPref(v); })
      .catch(() => {});
  }, []);

  const setPreferencia = useCallback((p: PreferenciaIdioma) => {
    setPref(p);
    void AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const idioma = resolverIdioma(preferencia, sistema);

  useEffect(() => { fijarVoz(vozDe(idioma)); }, [idioma]);

  const value = useMemo<IdiomaCtx>(() => ({
    idioma,
    preferencia,
    idiomaSistema: idiomaDelSistema(sistema),
    setPreferencia,
    t: textosDe(idioma),
    locale: localeFechas(idioma),
  }), [idioma, preferencia, sistema, setPreferencia]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIdioma(): IdiomaCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useIdioma must be used within IdiomaProvider');
  return ctx;
}
