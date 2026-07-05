// Estrategia de neumáticos en vivo — cálculo puro y testeable.
//
// Modelo: la goma se degrada de forma aproximadamente lineal, así que los
// tiempos del stint cumplen  T ≈ T0 + d·k  (k = nº de vuelta del stint, en
// ms/vuelta). Con eso estimamos el momento óptimo de parar y, sobre todo,
// decidimos por POSICIÓN comparando nuestra proyección final (con dos
// escenarios: parar ahora / no parar) contra la del rival de delante y detrás.
//
// Fase 2: la proyección del rival ya no es plana; se le pasa corregida por su
// propia goma (aheadProjected / behindProjected). Si no hay modelo, se cae a
// la proyección plana del servidor.

import type { ProjectionRow } from '../data/types';

/** Vueltas limpias mínimas del stint para fiarnos de la pendiente. */
export const MIN_CONFIDENCE_LAPS = 8;

export interface StrategyInputs {
  /** Tiempos de vuelta LIMPIOS del stint (ms), en orden. */
  stintLaps: number[];
  /** Referencia de ritmo del carril de CADA vuelta del stint (ms) = mediana del
   *  lapTime de ese carril en esa manga. Se usa para normalizar la degradación
   *  por carril (un stint cruza varias mangas/carriles). null en una vuelta sin
   *  datos de carril; si falta cobertura se cae al ajuste bruto (Mejora 1). */
  stintRefs?: (number | null)[];
  /** Coste de una parada (ms). */
  pitCostMs: number;
  /** Juegos de neumáticos totales disponibles para la carrera. */
  setsTotal: number;
  /** Veces que se ha pulsado "Cambié gomas" en esta carrera. */
  changesMade: number;
  /** Cambios de goma que OBLIGA el reglamento (por defecto 0). Sin degradación
   *  medible solo se recomienda cumplir este mínimo, lo más tarde posible. */
  mandatoryChanges?: number;
  /** Mi fila en la proyección general. */
  followed: ProjectionRow | null;
  /** Rival de delante / detrás en la proyección (posición ±1). */
  ahead: ProjectionRow | null;
  behind: ProjectionRow | null;
  /** Fase 2: proyección final del rival corregida por su goma. Si es null se
   *  usa la proyección plana del servidor (ahead/behind.projectedTotal). */
  aheadProjected?: number | null;
  behindProjected?: number | null;
}

/** Sobre qué se apoya la recomendación de cambio:
 *  - 'degradation': hay pendiente medible (T sube con las vueltas), el óptimo
 *    sale de √(2·P/d).
 *  - 'scheduled': NO hay degradación por laptime (lo normal en slot de
 *    resistencia), así que repartimos los juegos disponibles sobre las vueltas
 *    que quedan. El cambio es pautado, no reactivo al ritmo. */
export type RecommendationBasis = 'degradation' | 'scheduled';

export type Recommendation =
  | { kind: 'insufficient-data' }
  | { kind: 'no-degradation' }
  | { kind: 'hold-to-end' }
  | { kind: 'window-open'; basis: RecommendationBasis }
  | { kind: 'change-in'; laps: number; basis: RecommendationBasis };

export interface PositionAdvice {
  action: 'change' | 'hold' | 'neutral';
  text: string;
}

export interface StrategyResult {
  confidence: 'none' | 'low' | 'ok';
  stintLap: number;
  degradationMsPerLap: number | null;
  remainingLaps: number | null;
  changesRemaining: number;
  setsAvailable: number;
  recommendation: Recommendation;
  position: PositionAdvice | null;
}

export interface DegradationFit {
  /** Pendiente de degradación (ms/vuelta). null si no se puede ajustar. */
  d: number | null;
  /** Intercepto T0 (ms). */
  t0: number | null;
  /** Media de vuelta del stint (ms), tras rechazo de outliers. */
  currentAvgMs: number | null;
  confidence: 'none' | 'low' | 'ok';
  /** Vueltas limpias usadas (tras rechazo de outliers). */
  cleanCount: number;
  /** true si la pendiente se ajustó sobre tiempos NORMALIZADOS por carril
   *  (Mejora 1); false si se cayó al ajuste bruto por falta de datos de carril. */
  normalized: boolean;
}

/** Regresión lineal por mínimos cuadrados sobre (x, y). */
function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!; sy += ys[i]!; sxx += xs[i]! * xs[i]!; sxy += xs[i]! * ys[i]!;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Ajusta la degradación de un stint a partir de sus tiempos de vuelta.
 *
 * Mejora 1 — normalización por carril: en resistencia con rotación un stint de
 * goma cruza VARIAS mangas, y cada manga es un carril a distinto ritmo. Sobre
 * tiempos brutos la pendiente `d` mezcla el efecto-carril con el desgaste (puede
 * inventar o esconder degradación). Si se pasan las referencias de carril
 * (`refs[i]` = mediana del carril de esa vuelta en esa manga), se ajusta sobre
 * la serie normalizada `t − ref + baseRef`: quita el escalón de carril dejando
 * `d` = desgaste puro y `t0` en escala absoluta (baseline neutro `baseRef`).
 *
 * Sin refs (o con poca cobertura) cae con elegancia al ajuste bruto de siempre.
 * Rechaza outliers (pits/incidentes) y salta la out-lap para la regresión.
 */
export function fitDegradation(stintLaps: number[], refs?: (number | null)[]): DegradationFit {
  const stintLap = stintLaps.length;
  const confidence: DegradationFit['confidence'] =
    stintLap >= MIN_CONFIDENCE_LAPS ? 'ok' : stintLap >= 3 ? 'low' : 'none';

  // ¿Hay cobertura de carril suficiente para normalizar?
  const known = refs && refs.length === stintLaps.length
    ? refs.filter((r): r is number => r != null && r > 0)
    : [];
  const canNorm = known.length >= Math.max(4, Math.ceil(stintLaps.length * 0.6));

  let series: number[];      // serie sobre la que ajustar (bruta o normalizada)
  let clean: number[];       // vueltas limpias (misma escala que `series`)
  if (canNorm) {
    const baseRef = median(known);
    // Empareja cada vuelta con su referencia (baseRef donde falte).
    const pairs = stintLaps.map((t, i) => {
      const r = refs![i];
      return { t, ref: r != null && r > 0 ? r : baseRef };
    });
    // Outlier = vuelta > 1.25× su propia referencia de carril (pit/incidente).
    const kept = pairs.length >= 4 ? pairs.filter(p => p.t <= p.ref * 1.25) : pairs;
    clean = kept.map(p => p.t - p.ref + baseRef); // absoluta, sin escalón de carril
    series = clean;
  } else {
    let c = stintLaps;
    if (stintLaps.length >= 4) {
      const med = median(stintLaps);
      c = stintLaps.filter(t => t <= med * 1.25);
    }
    clean = c;
    series = c;
  }

  const fitLaps = series.slice(1); // salta la out-lap
  const currentAvgMs = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
  const fit = fitLaps.length >= 2 ? linearFit(fitLaps.map((_, i) => i + 1), fitLaps) : null;
  return {
    d: fit ? fit.slope : null,
    t0: fit ? fit.intercept : null,
    currentAvgMs,
    confidence,
    cleanCount: clean.length,
    normalized: canNorm,
  };
}

/** Tiempo de carrera que le queda a una entidad, derivado de su proyección:
 *  remMs ≈ (projectedTotal − total) × avgLapMs. Evita la duración placeholder. */
export function remainingRaceMs(row: ProjectionRow | null): number | null {
  if (!row || row.projectedTotal == null || row.avgLapMs == null) return null;
  return Math.max(0, (row.projectedTotal - row.total) * row.avgLapMs);
}

export function computeTireStrategy(input: StrategyInputs): StrategyResult {
  const { stintLaps, pitCostMs, setsTotal, changesMade, followed, ahead, behind } = input;

  const changesRemaining = Math.max(0, (setsTotal - 1) - changesMade);
  const setsAvailable = changesRemaining;
  const stintLap = stintLaps.length;
  // Cambios que aún exige el reglamento (Mejora 2). No puede superar los juegos.
  const mandatory = Math.max(0, input.mandatoryChanges ?? 0);
  const mandatoryLeft = Math.min(changesRemaining, Math.max(0, mandatory - changesMade));

  const fit = fitDegradation(stintLaps, input.stintRefs);
  const d = fit.d, t0 = fit.t0;

  const remMs = remainingRaceMs(followed);
  const remainingLaps = remMs != null && fit.currentAvgMs ? remMs / fit.currentAvgMs : null;

  // ── Recomendación temporal ───────────────────────────────────────────────
  // Validado contra datos reales (24h Modena): en slot de resistencia la goma
  // NO se traduce en pérdida de tiempo por vuelta (d ≤ 0 en la práctica), así
  // que el aviso reactivo por laptime casi nunca dispara. Por eso, cuando no hay
  // degradación medible pero quedan juegos y sabemos las vueltas restantes,
  // caemos a un plan PAUTADO: repartir los juegos sobre lo que queda de carrera.
  let recommendation: Recommendation;
  if (changesRemaining <= 0) {
    recommendation = { kind: 'hold-to-end' };
  } else if (fit.confidence !== 'ok') {
    recommendation = { kind: 'insufficient-data' };
  } else if (d != null && d > 0) {
    // Degradación medible → óptimo por √(2·P/d), acotado por el reparto de los
    // stints que quedan (cambios obligatorios + los que hagas por ritmo).
    const stintsRemaining = Math.max(1, mandatoryLeft) + 1;
    const lStar = Math.sqrt((2 * pitCostMs) / d);
    const perStint = remainingLaps != null ? remainingLaps / stintsRemaining : lStar;
    const optimalStintLen = Math.max(lStar, perStint);
    const changeIn = Math.round(optimalStintLen - stintLap);
    recommendation = changeIn <= 0
      ? { kind: 'window-open', basis: 'degradation' }
      : { kind: 'change-in', laps: changeIn, basis: 'degradation' };
  } else if (mandatoryLeft <= 0) {
    // Sin degradación medible y sin cambios obligatorios pendientes → NO cambies:
    // parar cuesta ~pitCost sin ritmo que recuperar (validado en Modena).
    recommendation = { kind: 'hold-to-end' };
  } else if (remainingLaps != null) {
    // Sin degradación pero el reglamento obliga: cumple el mínimo lo más TARDE
    // posible, dejando una vuelta de margen por cada cambio pendiente.
    const changeIn = Math.round(remainingLaps - mandatoryLeft);
    recommendation = changeIn <= 0
      ? { kind: 'window-open', basis: 'scheduled' }
      : { kind: 'change-in', laps: changeIn, basis: 'scheduled' };
  } else {
    // Obliga a cambiar pero no sabemos cuánto queda: no podemos pautarlo.
    recommendation = { kind: 'no-degradation' };
  }

  // ── Capa de posición ─────────────────────────────────────────────────────
  let position: PositionAdvice | null = null;
  if (
    fit.confidence === 'ok' && d != null && d > 0 && t0 != null &&
    remMs != null && remMs > 0 && remainingLaps != null &&
    followed && changesRemaining > 0
  ) {
    const total = followed.total;
    const R = remainingLaps;
    const avgNoStop = t0 + d * (stintLap + R / 2);
    const avgStop   = t0 + d * (R / 2);
    const projNoStop = total + remMs / avgNoStop;
    const projStop   = total + (remMs - pitCostMs) / avgStop;

    // Proyección del rival: corregida por su goma (Fase 2) si la hay, si no
    // la plana del servidor.
    const aheadProj  = input.aheadProjected  ?? ahead?.projectedTotal  ?? null;
    const behindProj = input.behindProjected ?? behind?.projectedTotal ?? null;

    if (aheadProj != null && projStop > aheadProj && projNoStop <= aheadProj) {
      position = { action: 'change', text: `Cambia → adelantas a ${ahead!.name}` };
    } else if (behindProj != null && projNoStop > behindProj && projStop <= behindProj) {
      position = { action: 'hold', text: `Aguanta → si paras te adelanta ${behind!.name}` };
    } else if (behindProj != null && projStop > behindProj && projNoStop <= behindProj) {
      position = { action: 'change', text: `Cambia → defiendes de ${behind!.name}` };
    } else {
      position = { action: 'neutral', text: 'Sin cambio de posición previsto' };
    }
  }

  return {
    confidence: fit.confidence,
    stintLap,
    degradationMsPerLap: d,
    remainingLaps,
    changesRemaining,
    setsAvailable,
    recommendation,
    position,
  };
}
