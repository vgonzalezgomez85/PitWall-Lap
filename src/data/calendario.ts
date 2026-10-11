// Lógica pura del calendario de carreras: eventos, avisos y reparto entre
// próximos y pasados. Sin React ni módulos nativos, para poder testearla.

export type AvisoId = 'hora' | '30min' | '1h' | '1d' | '1sem';

/** Avisos disponibles, de menor a mayor antelación. `ms` = antelación. */
export const AVISOS: { id: AvisoId; ms: number }[] = [
  { id: 'hora',  ms: 0 },
  { id: '30min', ms: 30 * 60_000 },
  { id: '1h',    ms: 60 * 60_000 },
  { id: '1d',    ms: 24 * 60 * 60_000 },
  { id: '1sem',  ms: 7 * 24 * 60 * 60_000 },
];

/** Avisos que lleva una carrera nueva. */
export const AVISOS_POR_DEFECTO: AvisoId[] = ['1d', '1h'];

export interface Evento {
  id: string;
  nombre: string;
  lugar?: string;
  notas?: string;
  inicio: string;               // ISO
  avisos: AvisoId[];
  notificaciones: string[];     // ids de las notificaciones programadas
}

export function fechaAviso(inicioIso: string, aviso: AvisoId): Date {
  const ms = AVISOS.find(a => a.id === aviso)?.ms ?? 0;
  return new Date(new Date(inicioIso).getTime() - ms);
}

/** Avisos cuya hora todavía no ha pasado, con la fecha en que saltan. */
export function avisosPendientes(
  inicioIso: string,
  avisos: AvisoId[],
  ahora: Date,
): { aviso: AvisoId; fecha: Date }[] {
  if (Number.isNaN(new Date(inicioIso).getTime())) return [];
  return avisos
    .map(aviso => ({ aviso, fecha: fechaAviso(inicioIso, aviso) }))
    .filter(a => a.fecha.getTime() > ahora.getTime());
}

/**
 * Reparte los eventos: próximos (los que no han empezado, el más cercano
 * primero) y pasados (el más reciente primero). Un evento cuenta como pasado
 * en cuanto llega su hora de inicio.
 */
export function separarEventos(
  eventos: Evento[],
  ahora: Date,
): { proximos: Evento[]; pasados: Evento[] } {
  const t = (e: Evento) => new Date(e.inicio).getTime();
  const proximos = eventos.filter(e => t(e) > ahora.getTime()).sort((a, b) => t(a) - t(b));
  const pasados = eventos.filter(e => t(e) <= ahora.getTime()).sort((a, b) => t(b) - t(a));
  return { proximos, pasados };
}

/** Une una fecha (día) y una hora en un único instante. */
export function combinarFechaHora(dia: Date, hora: Date): Date {
  return new Date(
    dia.getFullYear(), dia.getMonth(), dia.getDate(),
    hora.getHours(), hora.getMinutes(), 0, 0,
  );
}

export function nuevoIdEvento(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
