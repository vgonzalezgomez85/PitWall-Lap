// Context global con la fuente de datos activa (SlotTime o Infolap).
//
// El proveedor expone:
//   • source            — DataSource activo (o null antes de descubrir / si falla)
//   • raceInfo          — info estática devuelta por connect()
//   • state             — snapshot vivo (LiveState) actualizado por suscripción
//   • setSource()       — la pantalla de Discovery lo llama tras connect()
//   • clearSource()     — desconecta y limpia (e.g. al volver al inicio)
//
// Las pantallas individuales (Select, MyTurn, Rest, History) leen del context.
// Para suscribirse a eventos discretos usa `useSourceEvent(handler)`.

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

import type {
  DataSource, LiveState, RaceInfo, RaceStatsSnapshot, SourceEvent,
} from './types';
import { emptyLiveState } from './types';

interface SourceContextValue {
  source: DataSource | null;
  raceInfo: RaceInfo | null;
  state: LiveState;
  setSource: (source: DataSource, raceInfo: RaceInfo) => void;
  clearSource: () => void;
  subscribeEvent: (cb: (e: SourceEvent) => void) => () => void;
  subscribeSnapshot: (cb: (s: RaceStatsSnapshot) => void) => () => void;
}

const Context = createContext<SourceContextValue | null>(null);

export function SourceProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<DataSource | null>(null);
  const [raceInfo, setRaceInfo]  = useState<RaceInfo | null>(null);
  const [state, setState]        = useState<LiveState>(emptyLiveState());

  // Listeners externos a eventos: cada hook que llame subscribeEvent se
  // registra aquí; cuando llega un SourceEvent lo despachamos a todos.
  const eventListeners = useRef<Set<(e: SourceEvent) => void>>(new Set());
  const snapshotListeners = useRef<Set<(s: RaceStatsSnapshot) => void>>(new Set());

  // Suscripciones al source actual. Se renuevan al cambiar de source.
  useEffect(() => {
    if (!source) {
      setState(emptyLiveState());
      return;
    }
    const unsubState = source.onStateChange(s => setState(s));
    const unsubEvent = source.onEvent(e => {
      for (const cb of eventListeners.current) cb(e);
    });
    const unsubSnap = source.onRaceStatsSnapshot(s => {
      for (const cb of snapshotListeners.current) cb(s);
    });
    return () => {
      unsubState();
      unsubEvent();
      unsubSnap();
    };
  }, [source]);

  // Cleanup defensivo: si el SourceProvider se desmonta (cierre de la app,
  // recarga JS), desconectamos cualquier fuente viva para que no quede un
  // socket abierto. En force-close iOS mata el proceso y el server lo
  // detecta solo, pero esto cubre los demás casos (recarga, etc).
  const sourceForUnmountRef = useRef<DataSource | null>(null);
  sourceForUnmountRef.current = source;
  useEffect(() => {
    return () => {
      if (sourceForUnmountRef.current) {
        try { sourceForUnmountRef.current.disconnect(); } catch { /* ignore */ }
      }
    };
  }, []);

  const setSource = useCallback((src: DataSource, info: RaceInfo) => {
    // Si ya había una fuente activa, la desconectamos para que no quede
    // un socket fantasma empujando ticks en paralelo.
    setSourceState(prev => {
      if (prev && prev !== src) {
        try { prev.disconnect(); } catch { /* ignore */ }
      }
      return src;
    });
    setRaceInfo(info);
  }, []);

  const clearSource = useCallback(() => {
    if (source) {
      try { source.disconnect(); } catch { /* ignore */ }
    }
    setSourceState(null);
    setRaceInfo(null);
    setState(emptyLiveState());
  }, [source]);

  const subscribeEvent = useCallback((cb: (e: SourceEvent) => void) => {
    eventListeners.current.add(cb);
    return () => { eventListeners.current.delete(cb); };
  }, []);

  const subscribeSnapshot = useCallback((cb: (s: RaceStatsSnapshot) => void) => {
    snapshotListeners.current.add(cb);
    return () => { snapshotListeners.current.delete(cb); };
  }, []);

  const value = useMemo<SourceContextValue>(() => ({
    source, raceInfo, state, setSource, clearSource, subscribeEvent, subscribeSnapshot,
  }), [source, raceInfo, state, setSource, clearSource, subscribeEvent, subscribeSnapshot]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDataSource(): SourceContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useDataSource must be used within SourceProvider');
  return ctx;
}

/** Helper para reaccionar a un evento concreto del source. */
export function useSourceEvent(handler: (e: SourceEvent) => void): void {
  const { subscribeEvent } = useDataSource();
  // Mantenemos handler estable via ref para no resuscribir en cada render.
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    return subscribeEvent(e => ref.current(e));
  }, [subscribeEvent]);
}
