// Colores de carril. PitWall Manager manda los del circuito en el payload de
// carrera (`race.laneColors`); si el servidor es antiguo y no los manda, se usa
// la misma paleta de fábrica que el servidor (`LaneColors.DEFAULT_LANE_COLORS`).

import type { ParticipantPlan } from './types';

export const COLORES_CARRIL_FABRICA: readonly string[] = [
  '#e63946', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4',
  '#ff5722', '#607d8b', '#795548', '#e91e63', '#3f51b5', '#009688',
  '#cddc39', '#ffc107', '#f44336', '#673ab7', '#03a9f4', '#8bc34a',
  '#ff6f00', '#880e4f', '#1a237e', '#b71c1c', '#004d40', '#f57f17',
  '#311b92', '#0d47a1', '#1b5e20', '#33691e', '#bf360c', '#4a148c',
  '#006064', '#827717',
];

/** Color del carril `lane` (1-based), del servidor o de la paleta de fábrica. */
export function colorDeCarril(lane: number, delServidor?: readonly string[]): string {
  const i = lane - 1;
  const paleta = delServidor && delServidor.length > 0 ? delServidor : COLORES_CARRIL_FABRICA;
  return paleta[i] ?? COLORES_CARRIL_FABRICA[i % COLORES_CARRIL_FABRICA.length] ?? '#8b949e';
}

/**
 * Carril en el que corre el participante dentro de la tanda: el de la manga
 * en curso si es de esa tanda, si no el de su primera manga (sin descanso).
 * null si no corre en ella.
 */
export function carrilEnTanda(
  plan: ParticipantPlan,
  tandaNum: number,
  mangaActual: number | null,
): number | null {
  const enTanda = plan.mangas.filter(m => m.tandaNum === tandaNum && !m.isRest);
  const actual = mangaActual != null ? enTanda.find(m => m.mangaNum === mangaActual) : undefined;
  return (actual ?? enTanda[0])?.lane ?? null;
}
