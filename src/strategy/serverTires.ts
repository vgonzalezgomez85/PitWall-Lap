// Puente entre el control de neumáticos del servidor (PitWall Manager) y la
// estrategia de goma. Cuando la carrera lleva control (dotación > 0) y el piloto
// seguido casa por NOMBRE con un equipo, los datos de dotación y cambios mandan
// sobre la configuración manual de la app.
//
// Nota sobre el mapeo a computeTireStrategy: el servidor cuenta `available =
// allowance − used` (cada cambio gasta un juego; el juego de salida no cuenta).
// La estrategia usa `changesRemaining = (setsTotal − 1) − changesMade`. Para
// reproducir EXACTAMENTE el `available` que muestra el Manager, mapeamos
// `setsTotal = allowance + 1` y `changesMade = used`, de modo que
// `changesRemaining = allowance − used = available`. Así el piloto y el operador
// ven el mismo número.

import type { TireControlState, TireTeamState, TireChangeRecord } from '../data/types';

export interface OwnTireInfo {
  /** Pares suministrados por equipo (dotación de la carrera). */
  allowance: number;
  /** Juegos ya entregados (nº de cambios registrados). */
  used: number;
  /** Juegos que quedan = allowance − used (puede ser negativo si se excede). */
  available: number;
  /** Último cambio registrado, o null si aún no ha cambiado. */
  lastChange: TireChangeRecord | null;
}

/** ¿La carrera lleva control de neumáticos activo? (dotación > 0). */
export function hasTireControl(tc: TireControlState | null | undefined): boolean {
  return !!tc && tc.allowance > 0;
}

/** Equipo (por nombre) dentro del control de neumáticos, o null. Los nombres
 *  son únicos por carrera, así que casar por nombre es inequívoco y esquiva el
 *  id canónico del servidor. */
export function findTeam(
  tc: TireControlState | null | undefined,
  name: string | null | undefined,
): TireTeamState | null {
  if (!tc || !name) return null;
  return tc.teams.find(t => t.name === name) ?? null;
}

/** Info de neumáticos del piloto seguido, si hay control y casa por nombre. */
export function ownTireInfo(
  tc: TireControlState | null | undefined,
  name: string | null | undefined,
): OwnTireInfo | null {
  if (!hasTireControl(tc)) return null;
  const team = findTeam(tc, name);
  if (!team) return null;
  return {
    allowance:  tc!.allowance,
    used:       team.used,
    available:  team.available,
    lastChange: team.changes.length ? team.changes[team.changes.length - 1]! : null,
  };
}

export interface ResolvedTireInputs {
  /** true si mandan los datos del servidor (control activo y equipo casado). */
  serverDriven: boolean;
  /** setsTotal para computeTireStrategy (ver nota de cabecera). */
  setsTotal: number;
  /** changesMade para computeTireStrategy. */
  changesMade: number;
}

/** Resuelve las entradas de dotación/cambios: servidor si hay control y casa el
 *  equipo, si no los valores manuales de la app. */
export function resolveTireInputs(
  tc: TireControlState | null | undefined,
  name: string | null | undefined,
  fallbackSetsTotal: number,
  fallbackChangesMade: number,
): ResolvedTireInputs {
  const own = ownTireInfo(tc, name);
  if (!own) {
    return { serverDriven: false, setsTotal: fallbackSetsTotal, changesMade: fallbackChangesMade };
  }
  return {
    serverDriven: true,
    setsTotal:    own.allowance + 1,   // reproduce el `available` del servidor
    changesMade:  own.used,
  };
}
