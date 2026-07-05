// Estrategia de neumáticos — proveedor de contexto (Fase 1 + Fase 2).
//
// Va montado a nivel de app (dentro de SourceProvider) para que la
// acumulación de vueltas corra SIEMPRE durante la carrera, esté el piloto en
// la pantalla que esté. La pantalla "Estrategia" consume `useTireStrategy()`.
//
// Fase 1: stint del piloto seguido → recomendación de cambio + capa de posición.
// Fase 2: modela la goma del rival de delante/detrás (auto-detección + manual)
//   para corregir su proyección y afinar el consejo de adelantar/defender.
//   Observamos los tiempos de TODAS las entidades (barato), pero solo
//   modelamos/avisamos de los dos rivales relevantes.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

import { useDataSource, useSourceEvent } from '../data/sourceContext';
import { computeTireStrategy, type StrategyResult } from './computeTireStrategy';
import { buildRivalModel, detectTireChange, type RivalModel } from './rivalTireModel';
import type { ProjectionRow } from '../data/types';

const CONFIG_KEY = '@pitwall/strategy/config/v1';
const stintKey = (raceId: number, entity: string) =>
  `@pitwall/strategy/stint/${raceId}/${entity}`;

export interface StrategyConfig {
  pitCostSec: number;
  setsTotal: number;
  /** Cambios de goma que obliga el reglamento (Mejora 2). Por defecto 0. */
  mandatoryChanges: number;
}

const DEFAULT_CONFIG: StrategyConfig = { pitCostSec: 25, setsTotal: 4, mandatoryChanges: 0 };

interface StintState {
  stintLaps: number[];
  /** Referencia de ritmo del carril en cada vuelta del stint (Mejora 1). Paralela
   *  a stintLaps; null donde no había datos de carril al cerrar la vuelta. */
  stintRefs: (number | null)[];
  changesMade: number;
}

const EMPTY_STINT: StintState = { stintLaps: [], stintRefs: [], changesMade: 0 };

/** Mínimo de vueltas de campo en un carril/manga para fiarnos de su mediana. */
const LANE_REF_MIN = 3;
function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export type RivalSide = 'ahead' | 'behind';

export interface PendingRivalChange {
  name: string;
  side: RivalSide;
  atIdx: number;
}

export interface RivalView {
  name: string;
  side: RivalSide;
  tireAgeLaps: number;
  ageKnown: boolean;
  degradationMsPerLap: number | null;
  confidence: 'none' | 'low' | 'ok';
}

export interface TireStrategy {
  available: boolean;
  config: StrategyConfig;
  setConfig: (patch: Partial<StrategyConfig>) => void;
  changeTires: () => void;
  result: StrategyResult | null;
  followedName: string | null;
  ready: boolean;
  // Fase 2
  pending: PendingRivalChange[];
  pendingCount: number;
  confirmRivalChange: (name: string) => void;
  dismissRivalChange: (name: string) => void;
  markRivalChange: (side: RivalSide) => void;
  rivals: { ahead: RivalView | null; behind: RivalView | null };
}

const Context = createContext<TireStrategy | null>(null);

export function TireStrategyProvider({ children }: { children: ReactNode }) {
  const { state, raceInfo } = useDataSource();
  const [config, setConfigState] = useState<StrategyConfig>(DEFAULT_CONFIG);
  const [stint, setStint] = useState<StintState>(EMPTY_STINT);
  const [ready, setReady] = useState(false);

  const raceId = raceInfo?.raceId ?? null;
  const entity = state.selfName ?? null;
  const available = raceInfo?.source === 'slottime' && raceId != null && !!entity;
  const key = available ? stintKey(raceId!, entity!) : null;

  const keyRef = useRef<string | null>(key);
  keyRef.current = key;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  // ── Referencia de carril (Mejora 1): mediana del lapTime de cada carril en la
  // manga EN CURSO, alimentada por las vueltas de todas las entidades. Se resetea
  // al cambiar de manga (cada manga es un carril nuevo). Aísla goma de carril.
  const laneLapsRef = useRef<Map<number, number[]>>(new Map());
  const myLaneRef = useRef<number | null>(state.myLane);
  myLaneRef.current = state.myLane;
  const laneRefOf = (lane: number | null): number | null => {
    if (lane == null) return null;
    const laps = laneLapsRef.current.get(lane);
    return laps && laps.length >= LANE_REF_MIN ? median(laps) : null;
  };

  // ── Estado de rivales (Fase 2), en refs para no re-renderizar por vuelta ──
  const rivalBuffersRef = useRef<Map<string, number[]>>(new Map());
  const rivalRefsRef = useRef<Map<string, (number | null)[]>>(new Map()); // paralelo al buffer
  const rivalChangeRef = useRef<Map<string, number>>(new Map()); // name → stintStartIdx
  const detectedRef = useRef<Map<string, number>>(new Map());    // name → último idx detectado
  const aheadNameRef = useRef<string | null>(null);
  const behindNameRef = useRef<string | null>(null);
  const entityRef = useRef<string | null>(entity);
  entityRef.current = entity;
  const [pending, setPending] = useState<PendingRivalChange[]>([]);
  const [rivalVersion, setRivalVersion] = useState(0);

  // Config global (una vez).
  useEffect(() => {
    AsyncStorage.getItem(CONFIG_KEY)
      .then(raw => { if (raw) setConfigState({ ...DEFAULT_CONFIG, ...JSON.parse(raw) }); })
      .catch(() => {});
  }, []);

  // Estado del stint propio: se carga al cambiar de carrera/piloto.
  useEffect(() => {
    if (!key) { setStint(EMPTY_STINT); setReady(true); return; }
    let cancelled = false;
    setReady(false);
    AsyncStorage.getItem(key)
      .then(raw => {
        if (cancelled) return;
        setStint(raw ? { ...EMPTY_STINT, ...JSON.parse(raw) } : EMPTY_STINT);
        setReady(true);
      })
      .catch(() => { if (!cancelled) { setStint(EMPTY_STINT); setReady(true); } });
    return () => { cancelled = true; };
  }, [key]);

  // Al cambiar de carrera, olvidamos los modelos de rivales (no se persisten).
  useEffect(() => {
    rivalBuffersRef.current = new Map();
    rivalRefsRef.current = new Map();
    rivalChangeRef.current = new Map();
    detectedRef.current = new Map();
    laneLapsRef.current = new Map();
    setPending([]);
  }, [raceId]);

  const persist = useCallback((next: StintState) => {
    const k = keyRef.current;
    if (k) void AsyncStorage.setItem(k, JSON.stringify(next)).catch(() => {});
  }, []);

  // ── Vueltas: piloto propio (lap-completed) y rivales (entity-lap) ─────────
  useSourceEvent(e => {
    // Cambio de manga → carril nuevo: reinicia las medianas de carril (Mejora 1).
    if (e.type === 'manga-changed') {
      laneLapsRef.current = new Map();
      return;
    }

    // Piloto propio: stint persistente, excluye salidas/out-lap/fuera de turno.
    if (e.type === 'lap-completed') {
      if (!keyRef.current || statusRef.current !== 'my-turn') return;
      if (e.isExit || e.isFirstCrossing) return;
      if (e.lapTimeMs == null || e.lapTimeMs <= 0) return;
      const ref = laneRefOf(myLaneRef.current); // referencia de mi carril ahora
      setStint(prev => {
        const next = {
          ...prev,
          stintLaps: [...prev.stintLaps, e.lapTimeMs!],
          stintRefs: [...prev.stintRefs, ref],
        };
        persist(next);
        return next;
      });
      return;
    }

    // Rivales: observamos a todos (incluida la out-lap/pit, que la detección
    // necesita); el modelo limpia outliers. No nos observamos a nosotros.
    if (e.type === 'entity-lap') {
      if (!keyRef.current) return;
      if (e.lapTimeMs == null || e.lapTimeMs <= 0) return;
      // Alimenta la mediana de ESTE carril con las vueltas de campo (sin
      // salidas/out-laps, que la sesgan). Vale para propio y rivales.
      if (!e.isExit && !e.isFirstCrossing) {
        const ll = laneLapsRef.current.get(e.lane) ?? [];
        ll.push(e.lapTimeMs);
        laneLapsRef.current.set(e.lane, ll);
      }
      if (e.name === entityRef.current) return;
      const buf = rivalBuffersRef.current.get(e.name) ?? [];
      buf.push(e.lapTimeMs);
      rivalBuffersRef.current.set(e.name, buf);
      // Ref de carril del rival en esta vuelta (paralelo al buffer, Mejora 1).
      const refs = rivalRefsRef.current.get(e.name) ?? [];
      refs.push(laneRefOf(e.lane));
      rivalRefsRef.current.set(e.name, refs);

      // Auto-detección solo para el rival de delante/detrás actual.
      const side: RivalSide | null =
        e.name === aheadNameRef.current ? 'ahead'
        : e.name === behindNameRef.current ? 'behind' : null;
      if (!side) return;
      const startIdx = rivalChangeRef.current.get(e.name) ?? 0;
      const det = detectTireChange(buf, startIdx);
      if (det != null && detectedRef.current.get(e.name) !== det) {
        detectedRef.current.set(e.name, det);
        setPending(prev => prev.some(p => p.name === e.name)
          ? prev
          : [...prev, { name: e.name, side, atIdx: det }]);
      }
    }
  });

  const setConfig = useCallback((patch: Partial<StrategyConfig>) => {
    setConfigState(prev => {
      const next = { ...prev, ...patch };
      void AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const changeTires = useCallback(() => {
    setStint(prev => {
      const next: StintState = { stintLaps: [], stintRefs: [], changesMade: prev.changesMade + 1 };
      persist(next);
      return next;
    });
  }, [persist]);

  // Confirmar un cambio auto-detectado → resetea la edad de goma del rival.
  const confirmRivalChange = useCallback((name: string) => {
    setPending(prev => {
      const entry = prev.find(p => p.name === name);
      if (entry) rivalChangeRef.current.set(name, entry.atIdx);
      return prev.filter(p => p.name !== name);
    });
    setRivalVersion(v => v + 1);
  }, []);

  const dismissRivalChange = useCallback((name: string) => {
    setPending(prev => prev.filter(p => p.name !== name));
  }, []);

  // Marcar/corregir manualmente: el rival acaba de calzar goma ahora.
  const markRivalChange = useCallback((side: RivalSide) => {
    const name = side === 'ahead' ? aheadNameRef.current : behindNameRef.current;
    if (!name) return;
    const len = (rivalBuffersRef.current.get(name) ?? []).length;
    rivalChangeRef.current.set(name, len);
    detectedRef.current.set(name, len);
    setPending(prev => prev.filter(p => p.name !== name));
    setRivalVersion(v => v + 1);
  }, []);

  // Localizar mi fila en la proyección y mis vecinos (delante/detrás).
  const { followed, ahead, behind } = useMemo(() => {
    const proj = state.projection;
    if (!proj || !entity) {
      return { followed: null as ProjectionRow | null, ahead: null as ProjectionRow | null, behind: null as ProjectionRow | null };
    }
    const i = proj.findIndex(p => p.name === entity);
    if (i < 0) return { followed: null as ProjectionRow | null, ahead: null as ProjectionRow | null, behind: null as ProjectionRow | null };
    return {
      followed: proj[i] ?? null,
      ahead: i > 0 ? proj[i - 1]! : null,
      behind: i < proj.length - 1 ? proj[i + 1]! : null,
    };
  }, [state.projection, entity]);

  // Mantener refs de nombres de vecinos para el handler de eventos.
  aheadNameRef.current = ahead?.name ?? null;
  behindNameRef.current = behind?.name ?? null;

  // Cálculo: modelos de rival → overrides de proyección → estrategia.
  const { result, rivals } = useMemo(() => {
    if (!available) {
      return {
        result: null as StrategyResult | null,
        rivals: { ahead: null as RivalView | null, behind: null as RivalView | null },
      };
    }
    const aheadModel: RivalModel | null = ahead
      ? buildRivalModel(rivalBuffersRef.current.get(ahead.name) ?? [], rivalChangeRef.current.get(ahead.name) ?? null, ahead, rivalRefsRef.current.get(ahead.name))
      : null;
    const behindModel: RivalModel | null = behind
      ? buildRivalModel(rivalBuffersRef.current.get(behind.name) ?? [], rivalChangeRef.current.get(behind.name) ?? null, behind, rivalRefsRef.current.get(behind.name))
      : null;

    const res = computeTireStrategy({
      stintLaps: stint.stintLaps,
      stintRefs: stint.stintRefs,
      pitCostMs: config.pitCostSec * 1000,
      setsTotal: config.setsTotal,
      changesMade: stint.changesMade,
      mandatoryChanges: config.mandatoryChanges,
      followed, ahead, behind,
      aheadProjected: aheadModel?.projectedTotal ?? null,
      behindProjected: behindModel?.projectedTotal ?? null,
    });

    const toView = (row: ProjectionRow | null, m: RivalModel | null, side: RivalSide): RivalView | null =>
      row && m ? {
        name: row.name, side,
        tireAgeLaps: m.tireAgeLaps, ageKnown: m.ageKnown,
        degradationMsPerLap: m.degradationMsPerLap, confidence: m.confidence,
      } : null;

    return {
      result: res,
      rivals: { ahead: toView(ahead, aheadModel, 'ahead'), behind: toView(behind, behindModel, 'behind') },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, stint.stintLaps, stint.stintRefs, stint.changesMade, config.pitCostSec, config.setsTotal, config.mandatoryChanges, followed, ahead, behind, rivalVersion]);

  const value = useMemo<TireStrategy>(() => ({
    available, config, setConfig, changeTires, result, followedName: entity, ready,
    pending, pendingCount: pending.length,
    confirmRivalChange, dismissRivalChange, markRivalChange, rivals,
  }), [available, config, setConfig, changeTires, result, entity, ready, pending,
       confirmRivalChange, dismissRivalChange, markRivalChange, rivals]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTireStrategy(): TireStrategy {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useTireStrategy must be used within TireStrategyProvider');
  return ctx;
}
