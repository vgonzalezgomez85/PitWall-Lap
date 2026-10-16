// Estado y reglas de una sala de Radio. Puro (sin React ni nativos) para poder
// testearlo. La red (TCP/mDNS) y la UI usan esto como fuente de verdad de
// quién hay en la sala y si alguien puede entrar.
//
// Reglas (del diseño, §3): un solo piloto y un solo asistente por sala; los
// seguidores, los que quepan en la zona WiFi. El código corto evita que se
// cuele alguien que esté en la misma red.

import { codigosIguales } from './codigo';
import type { MotivoRechazo, Participante, Rol } from './mensajes';

/** Límite de seguidores: la zona WiFi de un iPhone aguanta ~5 conectados. */
export const MAX_SEGUIDORES = 6;

export interface EstadoSala {
  /** Código corto (p. ej. `K7M-4QX`), ya normalizado. */
  codigo: string;
  /** Participantes conectados (asistente, piloto y seguidores). */
  participantes: Participante[];
}

export function crearSala(codigo: string): EstadoSala {
  return { codigo, participantes: [] };
}

/** ¿Ese rol ya está ocupado en la sala? (solo uno de piloto/asistente). */
export function rolOcupado(sala: EstadoSala, rol: Rol): boolean {
  // El asistente es siempre el móvil que crea la sala (el servidor): ningún
  // participante remoto puede entrar con ese papel.
  if (rol === 'asistente') return true;
  if (rol === 'seguidor') return false; // los seguidores no tienen cupo por rol
  return sala.participantes.some(p => p.rol === rol);
}

/** ¿La sala está llena? (solo limita a los seguidores). */
export function salaLlena(sala: EstadoSala, rol: Rol): boolean {
  if (rol !== 'seguidor') return false;
  return sala.participantes.filter(p => p.rol === 'seguidor').length >= MAX_SEGUIDORES;
}

export interface PeticionUnion {
  id: string;
  nombre: string;
  rol: Rol;
  codigo: string;
}

export type ResultadoUnion =
  | { ok: true; participante: Participante }
  | { ok: false; motivo: MotivoRechazo };

/**
 * Decide si una petición de unirse entra en la sala. Valida el código y, para
 * piloto/asistente, que el rol no esté ocupado; para seguidores, que quepan.
 * No muta la sala: `registrarParticipante` la actualiza.
 */
export function decidirUnion(sala: EstadoSala, p: PeticionUnion): ResultadoUnion {
  if (!codigosIguales(sala.codigo, p.codigo)) return { ok: false, motivo: 'codigo' };
  if (rolOcupado(sala, p.rol)) return { ok: false, motivo: 'rol-ocupado' };
  if (salaLlena(sala, p.rol)) return { ok: false, motivo: 'sala-llena' };
  return { ok: true, participante: { id: p.id, nombre: p.nombre, rol: p.rol } };
}

/** Añade un participante ya aceptado. Devuelve la sala actualizada. */
export function registrarParticipante(sala: EstadoSala, p: Participante): EstadoSala {
  return { ...sala, participantes: [...sala.participantes, p] };
}

/** Quita un participante por id (se fue o lo expulsó el asistente). */
export function eliminarParticipante(sala: EstadoSala, id: string): EstadoSala {
  return {
    ...sala,
    participantes: sala.participantes.filter(p => p.id !== id),
  };
}

/** Lista de participantes para el mensaje `participantes` (orden estable). */
export function listaDeParticipantes(sala: EstadoSala): Participante[] {
  return sala.participantes.slice();
}
