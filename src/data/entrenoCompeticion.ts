// Entrenos de competición descargados del servidor PitWall: tipos y lógica
// pura (validar lo que llega, repartir lo pendiente de descargar). Sin React ni
// módulos nativos, para poder testearla.

/** Una fila de la clasificación de la sesión. */
export interface Clasificado {
  pos: number;
  name: string;
  heats: number;
  laps: number;
  bestLapMs: number | null;
  avgLapMs: number | null;
}

/** Lo que hizo un carril en un heat. */
export interface CarrilHeat {
  lane: number;
  name: string;
  bestLapMs: number | null;
  avgLapMs: number | null;
  laps: number;
}

export interface Heat {
  heat: number;
  lanes: CarrilHeat[];
}

/** Sesión completa, tal como se guarda en el móvil. */
export interface EntrenoCompeticion {
  id: string;
  startedAt: string | null;     // ISO (UTC)
  descargadoEn: string;         // ISO
  standings: Clasificado[];
  heats: Heat[];
}

/** Resumen de una sesión en la lista del servidor. */
export interface SesionServidor {
  id: string;
  startedAt: string | null;
  heats: number;
  participants: number;
  laps: number;
  bestLapMs: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Lista del servidor: descarta lo que no tenga forma de sesión. */
export function sesionesDeServidor(raw: unknown): SesionServidor[] {
  const lista = (raw as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(lista)) return [];
  const out: SesionServidor[] = [];
  for (const s of lista as Record<string, unknown>[]) {
    if (!s || typeof s.id !== 'string') continue;
    out.push({
      id: s.id,
      startedAt: typeof s.startedAt === 'string' ? s.startedAt : null,
      heats: num(s.heats) ?? 0,
      participants: num(s.participants) ?? 0,
      laps: num(s.laps) ?? 0,
      bestLapMs: num(s.bestLapMs),
    });
  }
  return out;
}

/** Detalle del servidor → sesión para guardar. null si no es válido. */
export function entrenoDesdeServidor(raw: unknown, ahora: Date): EntrenoCompeticion | null {
  const d = raw as Record<string, unknown> | null;
  if (!d || typeof d.id !== 'string' || !Array.isArray(d.heats) || !Array.isArray(d.standings)) {
    return null;
  }
  const standings: Clasificado[] = (d.standings as Record<string, unknown>[]).map((s, i) => ({
    pos: num(s.pos) ?? i + 1,
    name: String(s.name ?? ''),
    heats: num(s.heats) ?? 0,
    laps: num(s.laps) ?? 0,
    bestLapMs: num(s.bestLapMs),
    avgLapMs: num(s.avgLapMs),
  }));
  const heats: Heat[] = (d.heats as Record<string, unknown>[]).map(h => ({
    heat: num(h.heat) ?? 0,
    lanes: (Array.isArray(h.lanes) ? (h.lanes as Record<string, unknown>[]) : []).map(l => ({
      lane: num(l.lane) ?? 0,
      name: String(l.name ?? ''),
      bestLapMs: num(l.bestLapMs),
      avgLapMs: num(l.avgLapMs),
      laps: num(l.laps) ?? 0,
    })),
  }));
  return {
    id: d.id,
    startedAt: typeof d.startedAt === 'string' ? d.startedAt : null,
    descargadoEn: ahora.toISOString(),
    standings,
    heats,
  };
}

/** Sesiones del servidor que aún no están en el móvil. */
export function pendientesDeDescargar(
  servidor: SesionServidor[],
  idsLocales: Iterable<string>,
): SesionServidor[] {
  const locales = new Set(idsLocales);
  return servidor.filter(s => !locales.has(s.id));
}
