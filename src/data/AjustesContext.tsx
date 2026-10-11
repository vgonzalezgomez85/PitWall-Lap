// Ajustes generales persistentes (AsyncStorage), compartidos por la pantalla de
// Ajustes y por quien los consume (p. ej. la estrategia de neumáticos).

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';

import { AJUSTES_POR_DEFECTO, normalizarAjustes, type Ajustes } from './ajustes';

const STORAGE_KEY = '@pitwall/ajustes/v1';

interface AjustesCtx {
  ajustes: Ajustes;
  /** false hasta que se ha leído lo guardado: así no se arranca con un valor por defecto que luego cambia. */
  listo: boolean;
  actualizar: (parche: Partial<Ajustes>) => void;
}

const Ctx = createContext<AjustesCtx | null>(null);

export function AjustesProvider({ children }: { children: ReactNode }) {
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_POR_DEFECTO);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => { if (raw) setAjustes(normalizarAjustes(JSON.parse(raw))); })
      .catch(() => {})
      .finally(() => setListo(true));
  }, []);

  const actualizar = useCallback((parche: Partial<Ajustes>) => {
    setAjustes(prev => {
      const next = { ...prev, ...parche };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const valor = useMemo(() => ({ ajustes, listo, actualizar }), [ajustes, listo, actualizar]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAjustes(): AjustesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAjustes must be used within AjustesProvider');
  return ctx;
}
