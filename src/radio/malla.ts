// Voz en malla: cada pareja de participantes tiene su propia conexión WebRTC
// si al menos uno de los dos habla (piloto o asistente). Así cualquiera que
// tenga micro llega a todos, esté en el móvil que esté (antes todo pasaba por
// el hub y, por ejemplo, la voz de un asistente remoto no llegaba al piloto,
// ni la del piloto a los seguidores). El hub solo reenvía la señalización.
// Puro, para poder testearlo.

import type { Participante, Rol } from './mensajes';

/** ¿Este papel habla? (los seguidores solo escuchan). */
export function tieneMicro(rol: Rol | null | undefined): boolean {
  return rol === 'piloto' || rol === 'asistente';
}

/** En cada pareja ofrece el de id menor; el otro espera la oferta y responde.
 *  Así nunca se cruzan dos ofertas. */
export function soyOferente(yo: string, otro: string): boolean {
  return yo < otro;
}

/** Firma de una conexión: qué lados envían audio. Si cambia (alguien pasa a
 *  tener o dejar de tener micro), la conexión se rehace. */
export function firmaPar(miRol: Rol | null, suRol: Rol | null): string {
  return `${tieneMicro(miRol) ? 'm' : '-'}${tieneMicro(suRol) ? 'm' : '-'}`;
}

export interface PlanMalla {
  /** Conexiones a cerrar (el otro ya no está, ya no hace falta o cambió su firma). */
  cerrar: string[];
  /** Conexiones nuevas en las que nos toca ofrecer. */
  ofrecer: string[];
}

/**
 * Compara las conexiones que hay (id → firma) con las que debería haber según
 * la lista de participantes. Donde nos toca responder no se crea nada: la
 * conexión nace al llegar la oferta del otro.
 */
export function planificarMalla(
  yo: string,
  participantes: Participante[],
  actuales: Map<string, string>,
): PlanMalla {
  const miRol = participantes.find(p => p.id === yo)?.rol ?? null;
  const cerrar: string[] = [];
  const ofrecer: string[] = [];
  const presentes = new Set<string>();

  for (const p of participantes) {
    if (p.id === yo) continue;
    presentes.add(p.id);
    const hace = tieneMicro(miRol) || tieneMicro(p.rol);
    const firma = firmaPar(miRol, p.rol);
    const actual = actuales.get(p.id);
    if (!hace) {
      if (actual !== undefined) cerrar.push(p.id);
      continue;
    }
    if (actual === firma) continue;
    if (actual !== undefined) cerrar.push(p.id);
    if (soyOferente(yo, p.id)) ofrecer.push(p.id);
  }
  for (const id of actuales.keys()) {
    if (!presentes.has(id)) cerrar.push(id);
  }
  return { cerrar, ofrecer };
}
