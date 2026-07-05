// Modelo de neumático de un rival (Fase 2).
//
// Observamos las vueltas de un rival (vienen por socket de todas las
// entidades) y, cuando marca un cambio de gomas (auto-detectado + confirmado,
// o manual), modelamos su degradación y proyectamos su final corregido por la
// goma — en vez de la proyección plana del servidor.

import { fitDegradation, remainingRaceMs } from './computeTireStrategy';
import type { ProjectionRow } from '../data/types';

/** Detección: para evitar re-disparos, no volvemos a avisar del mismo cambio. */
const SPIKE_FACTOR = 1.5;     // vuelta de pit = > 1.5× la mediana reciente
const DROP_FACTOR  = 0.97;    // tras el cambio, ritmo < 0.97× la mediana previa
const RECENT_WINDOW = 6;      // vueltas previas para la mediana de referencia
const MIN_POST = 2;           // vueltas tras el pico para confirmar la caída
const MAX_SPIKE_AGE = 4;      // el pico debe estar en las últimas N vueltas

/**
 * Detecta el patrón "vuelta larga (pit) + caída de ritmo" al final del buffer.
 * Devuelve el índice ABSOLUTO de la 1ª vuelta del stint nuevo (justo tras el
 * pico) o null. Solo mira a partir de `fromIdx` (último cambio conocido).
 */
export function detectTireChange(laps: number[], fromIdx: number): number | null {
  const n = laps.length;
  // Necesitamos algo de histórico previo al pico + vueltas posteriores.
  for (let spike = Math.max(fromIdx + RECENT_WINDOW, RECENT_WINDOW); spike < n - MIN_POST; spike++) {
    if (spike < n - MAX_SPIKE_AGE) continue; // solo picos recientes
    const prev = laps.slice(Math.max(fromIdx, spike - RECENT_WINDOW), spike);
    if (prev.length < 3) continue;
    const prevMed = median(prev);
    if (laps[spike]! <= prevMed * SPIKE_FACTOR) continue; // no es vuelta de pit
    const post = laps.slice(spike + 1, spike + 1 + MIN_POST);
    if (post.length < MIN_POST) continue;
    const postAvg = post.reduce((a, b) => a + b, 0) / post.length;
    if (postAvg < prevMed * DROP_FACTOR) return spike + 1; // calzó goma nueva
  }
  return null;
}

export interface RivalModel {
  degradationMsPerLap: number | null;
  t0Ms: number | null;
  confidence: 'none' | 'low' | 'ok';
  /** Vueltas desde el último cambio conocido (edad de goma). */
  tireAgeLaps: number;
  /** true si hemos observado/confirmado un cambio (edad fiable). */
  ageKnown: boolean;
  /** Proyección final corregida por su goma (o la plana si no se puede). */
  projectedTotal: number | null;
}

/**
 * Construye el modelo de un rival a partir de su buffer completo de vueltas y
 * el índice donde empezó su stint actual (null = nunca observamos un cambio).
 */
export function buildRivalModel(
  allLaps: number[],
  stintStartIdx: number | null,
  row: ProjectionRow | null,
  allRefs?: (number | null)[],
): RivalModel {
  const stintLaps = stintStartIdx != null ? allLaps.slice(stintStartIdx) : allLaps;
  // Refs de carril paralelas al stint (Mejora 1). Solo si cuadra la longitud.
  const refs = allRefs && allRefs.length === allLaps.length
    ? (stintStartIdx != null ? allRefs.slice(stintStartIdx) : allRefs)
    : undefined;
  const ageKnown = stintStartIdx != null;
  const tireAgeLaps = stintLaps.length;
  const fit = fitDegradation(stintLaps, refs);

  // Proyección corregida por goma SOLO si conocemos la edad real (hemos
  // observado/confirmado un cambio). Sin edad fiable no extrapolamos —
  // usaríamos un "tireAgeLaps" = todo el buffer y subestimaríamos al rival;
  // mejor caer a la proyección plana del servidor.
  let projectedTotal: number | null = row?.projectedTotal ?? null;
  const remMs = remainingRaceMs(row);
  if (ageKnown && row && remMs != null && fit.d != null && fit.d > 0 && fit.t0 != null) {
    const currentAvg = fit.currentAvgMs ?? row.avgLapMs;
    if (currentAvg && currentAvg > 0) {
      const R = remMs / currentAvg;
      // Asume que sigue con esta goma hasta meta (no modelamos sus paradas
      // futuras): degrada desde su edad actual sobre las vueltas que le quedan.
      const avgRest = fit.t0 + fit.d * (tireAgeLaps + R / 2);
      if (avgRest > 0) projectedTotal = row.total + remMs / avgRest;
    }
  }

  return {
    degradationMsPerLap: fit.d,
    t0Ms: fit.t0,
    confidence: fit.confidence,
    tireAgeLaps,
    ageKnown,
    projectedTotal,
  };
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
