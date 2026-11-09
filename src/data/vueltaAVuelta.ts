// Tabla vuelta a vuelta de uno o varios stints de entrenamiento (lógica pura).
//
// Una fila por número de vuelta y una celda por stint, lado a lado para
// comparar. Cada celda lleva el tiempo, la diferencia con la mejor de SU stint
// y su nivel (mejor, rápida, regular, lenta, muy lenta). Si un stint tiene
// menos vueltas, sus celdas sobrantes van vacías.

export type NivelVuelta = 'mejor' | 'rapida' | 'regular' | 'lenta' | 'muyLenta';

/**
 * Umbrales sobre la mejor vuelta del stint, en fracción. Calibrados con una
 * carrera real capturada (≈130 vueltas de ~16 s en 6 carriles): las vueltas
 * limpias quedan casi todas a menos de un 5 % de la mejor (mediana +0,5 % a
 * +3,6 % según el carril) y las salidas de pista se van a +15 % o más.
 */
export const UMBRAL_RAPIDA = 0.02;
export const UMBRAL_REGULAR = 0.05;
export const UMBRAL_LENTA = 0.10;

export const NIVELES: NivelVuelta[] = ['mejor', 'rapida', 'regular', 'lenta', 'muyLenta'];

export function nivelVuelta(ms: number, mejorMs: number): NivelVuelta {
  if (ms <= mejorMs) return 'mejor';
  const exceso = (ms - mejorMs) / mejorMs;
  if (exceso <= UMBRAL_RAPIDA) return 'rapida';
  if (exceso <= UMBRAL_REGULAR) return 'regular';
  if (exceso <= UMBRAL_LENTA) return 'lenta';
  return 'muyLenta';
}

export interface CeldaVuelta {
  ms: number;
  /** Diferencia con la mejor vuelta del stint (0 en la mejor). */
  difMejorMs: number;
  nivel: NivelVuelta;
}

export interface FilaVuelta {
  vuelta: number;   // 1, 2, 3…
  celdas: (CeldaVuelta | null)[];
}

export function tablaVueltaAVuelta(stints: number[][]): FilaVuelta[] {
  const mejores = stints.map(v => (v.length > 0 ? Math.min(...v) : null));
  const total = Math.max(0, ...stints.map(v => v.length));
  const filas: FilaVuelta[] = [];
  for (let i = 0; i < total; i++) {
    filas.push({
      vuelta: i + 1,
      celdas: stints.map((vueltas, j) => {
        const ms = vueltas[i];
        const mejor = mejores[j] ?? null;
        if (ms == null || mejor == null || mejor <= 0) return null;
        return { ms, difMejorMs: ms - mejor, nivel: nivelVuelta(ms, mejor) };
      }),
    });
  }
  return filas;
}
