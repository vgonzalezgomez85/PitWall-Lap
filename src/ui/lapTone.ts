// Clasificación visual de la última vuelta frente a la mejor propia, al estilo
// de los cronos de F1: morado = mejor vuelta, verde = cerca de la mejor,
// ámbar = claramente más lenta. Lógica pura (sin React) para poder testearla.

export type LapTone = 'best' | 'good' | 'slow' | 'neutral';

/** Margen sobre la mejor (en fracción) que todavía cuenta como "buena". */
export const MARGEN_BUENA = 0.02;

export function lapTone(lastMs: number | null, bestMs: number | null): LapTone {
  if (lastMs == null || bestMs == null || bestMs <= 0) return 'neutral';
  if (lastMs <= bestMs) return 'best';
  if (lastMs - bestMs <= bestMs * MARGEN_BUENA) return 'good';
  return 'slow';
}

/** Diferencia con signo en segundos y centésimas: "+0.23", "−0.05", "0.00". */
export function fmtDelta(ms: number): string {
  const cs = Math.round(Math.abs(ms) / 10);
  const txt = `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
  if (cs === 0) return txt;
  return (ms > 0 ? '+' : '−') + txt;
}

/** Texto bajo la última vuelta: "Mejor vuelta" o el delta frente a la mejor. */
export function lapDeltaLabel(lastMs: number | null, bestMs: number | null): string | null {
  const tone = lapTone(lastMs, bestMs);
  if (tone === 'neutral' || lastMs == null || bestMs == null) return null;
  if (tone === 'best') return 'Mejor vuelta';
  return `${fmtDelta(lastMs - bestMs)} vs mejor`;
}
