// Seguimiento de rivales con TicTac: acumulado por piloto y carril calculado
// en el móvil (el TicTac no lo manda). Con PitWall los datos salen del
// servidor; esto solo se usa con las dos versiones del TicTac.
//
// Solo cuentan las mangas TERMINADAS: lo de la manga en curso va aparte
// (`open`) y no entra en `stats()` hasta que se cierra. Hay dos cierres:
//   • firme (`closeManga`): CONFIG de manga nueva o rotación de carriles →
//     la manga abierta pasa al acumulado y empieza otra vacía;
//   • provisional (`softClose`): fin del reloj de manga o silencio largo →
//     la manga abierta cuenta ya en `stats()`, pero si vuelven las vueltas
//     sin manga nueva (era una pausa) se reabre (`addCrossing`).
// Funciones puras, sin red ni almacenamiento: la persistencia la hace
// trackingStore.ts con `toJSON` / `fromJSON`.

import { normName } from './infolapRace';
import type { TrackingData, TrackingTeam } from './types';

export interface LaneAcc {
  /** Cruces de meta (incluido el de salida si se conoce). */
  laps: number;
  /** Vueltas con tiempo: base de la media y la rápida. */
  nTimed: number;
  sumMs: number;
  bestMs: number | null;
}

/** Por piloto (nombre normalizado): nombre visible y carril → acumulado. */
export type PilotLanes = Record<string, { name: string; lanes: Record<string, LaneAcc> }>;

export interface LaneTrackerJSON {
  v: 1;
  closed: PilotLanes;
  open: PilotLanes;
  /** La manga abierta ya cuenta (cierre provisional). */
  openCounted: boolean;
  /** Date.now() de la última vuelta vista (0 = ninguna). */
  lastLapAt: number;
}

export interface LaneStatsRow {
  lane: number;
  laps: number;
  bestMs: number | null;
  avgMs: number | null;
}

export interface PilotLaneStats {
  name: string;
  laps: number;
  bestMs: number | null;
  avgMs: number | null;
  lanes: LaneStatsRow[];
}

/** Máximo de rivales seguidos (igual que en PitWall / Lap web). */
export const MAX_TRACKED = 5;

/** Sin vueltas durante este tiempo la manga se da por terminada (provisional). */
export const SILENCE_CLOSE_MS = 90_000;

function emptyAcc(): LaneAcc {
  return { laps: 0, nTimed: 0, sumMs: 0, bestMs: null };
}

function addInto(dst: LaneAcc, src: LaneAcc): void {
  dst.laps += src.laps;
  dst.nTimed += src.nTimed;
  dst.sumMs += src.sumMs;
  if (src.bestMs != null) dst.bestMs = dst.bestMs == null ? src.bestMs : Math.min(dst.bestMs, src.bestMs);
}

function mergeInto(dst: PilotLanes, src: PilotLanes): void {
  for (const [key, p] of Object.entries(src)) {
    const d = dst[key] ?? (dst[key] = { name: p.name, lanes: {} });
    d.name = p.name;
    for (const [lane, acc] of Object.entries(p.lanes)) {
      addInto(d.lanes[lane] ?? (d.lanes[lane] = emptyAcc()), acc);
    }
  }
}

export class LaneTracker {
  private closed: PilotLanes = {};
  private open: PilotLanes = {};
  private openCounted = false;
  private lastLapAt = 0;

  /** Un cruce de meta de `name` por `lane`. `lapMs` null = cruce sin tiempo
   *  (salida): cuenta como vuelta pero no para media ni rápida. Si la manga
   *  estaba cerrada provisionalmente, se reabre. */
  addCrossing(name: string, lane: number, lapMs: number | null, now = Date.now()): void {
    const key = normName(name);
    if (!key) return;
    this.openCounted = false;
    this.lastLapAt = now;
    const p = this.open[key] ?? (this.open[key] = { name, lanes: {} });
    p.name = name;
    const acc = p.lanes[String(lane)] ?? (p.lanes[String(lane)] = emptyAcc());
    acc.laps += 1;
    if (lapMs != null) {
      acc.nTimed += 1;
      acc.sumMs += lapMs;
      acc.bestMs = acc.bestMs == null ? lapMs : Math.min(acc.bestMs, lapMs);
    }
  }

  /** ¿Hay algo en la manga abierta? */
  hasOpen(): boolean {
    return Object.keys(this.open).length > 0;
  }

  /** Cierre firme: la manga abierta pasa al acumulado. Devuelve si cambió algo. */
  closeManga(): boolean {
    if (!this.hasOpen()) return false;
    mergeInto(this.closed, this.open);
    this.open = {};
    this.openCounted = false;
    return true;
  }

  /** Cierre provisional (fin del reloj o silencio). Devuelve si cambió algo. */
  softClose(): boolean {
    if (!this.hasOpen() || this.openCounted) return false;
    this.openCounted = true;
    return true;
  }

  /** Cierre provisional por silencio si toca. Devuelve si cambió algo. */
  checkSilence(now = Date.now()): boolean {
    if (this.lastLapAt === 0 || now - this.lastLapAt < SILENCE_CLOSE_MS) return false;
    return this.softClose();
  }

  reset(): void {
    this.closed = {};
    this.open = {};
    this.openCounted = false;
    this.lastLapAt = 0;
  }

  /** La manga abierta ya cuenta en `stats()` (cierre provisional). */
  get openIncluded(): boolean {
    return this.openCounted;
  }

  get lastActivityAt(): number {
    return this.lastLapAt;
  }

  /** Acumulado de las mangas terminadas, por piloto (clave normalizada). */
  stats(): Map<string, PilotLaneStats> {
    const all: PilotLanes = {};
    mergeInto(all, this.closed);
    if (this.openCounted) mergeInto(all, this.open);
    const out = new Map<string, PilotLaneStats>();
    for (const [key, p] of Object.entries(all)) {
      const total = emptyAcc();
      const lanes: LaneStatsRow[] = Object.entries(p.lanes)
        .map(([lane, acc]) => {
          addInto(total, acc);
          return { lane: Number(lane), laps: acc.laps, bestMs: acc.bestMs, avgMs: avgOf(acc) };
        })
        .sort((a, b) => a.lane - b.lane);
      out.set(key, { name: p.name, laps: total.laps, bestMs: total.bestMs, avgMs: avgOf(total), lanes });
    }
    return out;
  }

  toJSON(): LaneTrackerJSON {
    return { v: 1, closed: this.closed, open: this.open, openCounted: this.openCounted, lastLapAt: this.lastLapAt };
  }

  static fromJSON(j: unknown): LaneTracker | null {
    if (!j || typeof j !== 'object') return null;
    const o = j as Partial<LaneTrackerJSON>;
    if (o.v !== 1 || !o.closed || !o.open) return null;
    const t = new LaneTracker();
    t.closed = o.closed;
    t.open = o.open;
    t.openCounted = o.openCounted === true;
    t.lastLapAt = typeof o.lastLapAt === 'number' ? o.lastLapAt : 0;
    return t;
  }
}

function avgOf(acc: LaneAcc): number | null {
  return acc.nTimed > 0 ? Math.round(acc.sumMs / acc.nTimed) : null;
}

/**
 * Vista del seguimiento para TicTac: el propio piloto primero y luego los
 * seguidos en su orden. Candidatos: los pilotos del descubrimiento y los que
 * han dado vueltas, sin el propio.
 */
export function buildLocalTracking(o: {
  stats: Map<string, PilotLaneStats>;
  selfName: string | null;
  tracked: string[];
  participants: string[];
}): TrackingData {
  const self = o.selfName ? normName(o.selfName) : null;
  const seen = new Set<string>();
  const candidates: TrackingData['candidates'] = [];
  for (const name of [...o.participants, ...[...o.stats.values()].map(s => s.name)]) {
    const key = normName(name);
    if (!key || key === self || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ name, color: null });
  }
  const tracked = o.tracked.filter(n => normName(n) !== self).slice(0, MAX_TRACKED);
  const team = (name: string, isMe: boolean): TrackingTeam => {
    const s = o.stats.get(normName(name));
    return {
      name: s?.name ?? name,
      isMe,
      color: null,
      laps: s?.laps ?? 0,
      bestMs: s?.bestMs ?? null,
      avgMs: s?.avgMs ?? null,
      avgCleanMs: null,
      lanes: (s?.lanes ?? []).map(l => ({ ...l, avgCleanMs: null })),
    };
  };
  return {
    max: MAX_TRACKED,
    tracked,
    candidates,
    teams: [...(o.selfName ? [team(o.selfName, true)] : []), ...tracked.map(n => team(n, false))],
    hasClean: false,
    pinRequired: false,
    local: true,
  };
}
