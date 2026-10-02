// Cálculos de carrera para el TicTac nuevo que PitWall hace en el servidor y
// el TicTac NO transmite: proyección de vueltas, "media para subir" y el
// dossier final para el histórico. Funciones puras (sin red) para testear.
//
// Lo que sí manda el TicTac (ver infolapWss.ts): clasificación oficial con
// gap en TIEMPO al líder y `vme` (tiempo total / vueltas) de cada piloto.
// La duración de la manga no la manda: la configura el usuario en la app.

import type { ProjectionRow, RaceStatsSnapshot } from './types';
import type { InfolapRival } from './infolapWss';

/** Acumulado de un piloto en toda la carrera (todas las mangas vistas). */
export interface PilotStats {
  name: string;
  laps: number;
  sumMs: number;
  bestMs: number | null;
  /** Mangas en las que ha dado alguna vuelta. */
  mangas: Set<number>;
}

export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function statsAvgMs(s: PilotStats | undefined): number | null {
  return s && s.laps > 0 ? s.sumMs / s.laps : null;
}

/** Gap en tiempo → vueltas (redondeado, como el gapV de PitWall). */
export function gapMsToLaps(gapMs: number | null, paceMs: number | null): number | null {
  if (gapMs == null || paceMs == null || paceMs <= 0) return null;
  return Math.round(gapMs / paceMs);
}

/**
 * Ritmo (ms/vuelta) que necesito durante lo que queda de manga para alcanzar
 * al de delante al final. Si el de delante sigue corriendo a su ritmo `pa`,
 * en `R` ms él da R/pa vueltas y yo debo dar esas más el gap (gap/pa
 * vueltas): p = pa·R / (R + gap). Si no corre esta manga, basta con cubrir
 * el gap: p = R / (gap / miRitmo).
 *
 * null = no aplica (sin datos, manga acabada) o inalcanzable (haría falta ir
 * más rápido que mi mejor vuelta).
 */
export function catchUpPaceMs(o: {
  remainingMs: number | null;
  gapMs: number | null;
  aheadPaceMs: number | null;
  aheadRacing: boolean;
  myPaceMs: number | null;
  myBestMs: number | null;
}): number | null {
  const R = o.remainingMs;
  if (R == null || R <= 0 || o.gapMs == null || o.gapMs <= 0) return null;
  let p: number | null = null;
  if (o.aheadRacing) {
    if (o.aheadPaceMs != null && o.aheadPaceMs > 0) p = (o.aheadPaceMs * R) / (R + o.gapMs);
  } else if (o.myPaceMs != null && o.myPaceMs > 0) {
    p = R / (o.gapMs / o.myPaceMs);
  }
  if (p == null || !Number.isFinite(p)) return null;
  if (o.myBestMs != null && p < o.myBestMs) return null;
  return Math.round(p);
}

/**
 * Proyección a final de manga, en el orden de la clasificación oficial del
 * TicTac. `total` son las vueltas contadas en la app desde que se conectó
 * (exactas si se conectó antes de empezar). Ritmo: media propia o, si aún
 * no hay, el `vme` del TicTac.
 */
export function buildProjection(
  rivals: InfolapRival[],
  stats: Map<string, PilotStats>,
  racing: Set<string>,
  remainingMs: number,
): ProjectionRow[] {
  const rows: ProjectionRow[] = rivals.map((r, i) => {
    const s = stats.get(normName(r.name));
    const total = s?.laps ?? 0;
    const pace = statsAvgMs(s) ?? r.vmeMs;
    const runs = r.isRacing && racing.has(normName(r.name));
    const projectedTotal = runs && pace ? total + remainingMs / pace : total;
    return {
      position: r.position,
      entityId: i + 1,
      entityType: 'driver',
      name: r.name,
      total,
      projectedTotal: Math.round(projectedTotal * 10) / 10,
      gapV: null,
      avgToCatch: null,
      avgLapMs: pace != null ? Math.round(pace) : null,
    };
  });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!.projectedTotal, b = rows[i]!.projectedTotal;
    rows[i]!.gapV = a != null && b != null ? Math.round((a - b) * 10) / 10 : null;
  }
  return rows;
}

/** Piloto para la clasificación calculada en el móvil (TicTac antiguo). */
export interface PilotoLocal {
  name: string;
  /** Carril en la manga en curso; null si no corre ahora. */
  laneId: number | null;
  /** Tiempo acumulado tras cada vuelta (ms), de toda la carrera vista. */
  cumMs: number[];
}

/**
 * Clasificación calculada en el móvil para el TicTac antiguo, que no la
 * manda: con el mismo formato que el `RIVALS_UPDATE` del nuevo, para que
 * posición, gaps, proyección e histórico salgan por el mismo camino.
 *
 * Orden: más vueltas primero; a igualdad, menos tiempo acumulado. `gap` =
 * cuánto tardó cada uno en llegar a su vuelta respecto a cuando la cerró el
 * líder (el "gap en meta" clásico). El tramo de salida no está cronometrado,
 * así que no cuenta. Solo entran pilotos con alguna vuelta.
 */
export function clasificacionLocal(pilotos: PilotoLocal[]): InfolapRival[] {
  const conVueltas = pilotos.filter(p => p.cumMs.length > 0);
  const total = (p: PilotoLocal) => p.cumMs[p.cumMs.length - 1]!;
  conVueltas.sort((a, b) => b.cumMs.length - a.cumMs.length || total(a) - total(b));
  const lider = conVueltas[0];
  return conVueltas.map((p, i) => {
    const n = p.cumMs.length;
    const liderEnMiVuelta = lider?.cumMs[n - 1];
    return {
      position: i + 1,
      laneId: p.laneId ?? 0,
      name: p.name,
      gapMs: liderEnMiVuelta != null ? Math.max(0, total(p) - liderEnMiVuelta) : null,
      vmeMs: Math.round(total(p) / n),
      isRacing: p.laneId != null,
    };
  });
}

/** Dossier final para el histórico local (como el `race:stats-snapshot` de PitWall). */
export function buildSnapshot(o: {
  raceId: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  stats: Map<string, PilotStats>;
  rivals: InfolapRival[];
}): RaceStatsSnapshot | null {
  const pilots = [...o.stats.values()].filter(s => s.laps > 0);
  if (pilots.length === 0) return null;
  const officialPos = new Map(o.rivals.map(r => [normName(r.name), r.position]));
  pilots.sort((a, b) => {
    const pa = officialPos.get(normName(a.name)), pb = officialPos.get(normName(b.name));
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return b.laps - a.laps || a.sumMs - b.sumMs;
  });
  return {
    raceId: o.raceId,
    name: o.name,
    format: 'individual',
    startedAt: o.startedAt,
    finishedAt: o.finishedAt,
    standings: pilots.map((s, i) => ({
      position: i + 1,
      entityId: s.name,
      entityType: 'driver',
      name: s.name,
      totalLaps: s.laps,
      bestLapMs: s.bestMs,
      avgLapMs: Math.round(s.sumMs / s.laps),
      totalTimeMs: s.sumMs,
      mangasRaced: s.mangas.size,
    })),
  };
}
