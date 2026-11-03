// Estado y reglas de una sala de Radio. Puro (sin React ni nativos) para poder
// testearlo. La red (TCP/mDNS) y la UI usan esto como fuente de verdad de
// quién hay en la sala y si alguien puede entrar.
//
// Reglas (del diseño, §3): un solo piloto y un solo asistente por sala; los
// seguidores, los que quepan en la zona WiFi. El código corto evita que se
// cuele alguien que esté en la misma red.
//
// En una sala de entrenos no hay perfiles: todos entran como `libre` (hablan y
// escuchan) y solo se limita cuántos caben.

import { codigosIguales } from './codigo';
import type { MotivoRechazo, Participante, Rol, TipoSala } from './mensajes';

/** Límite de seguidores: la zona WiFi de un iPhone aguanta ~5 conectados. */
export const MAX_SEGUIDORES = 6;

/** Límite de una sala de entrenos (contando a quien la crea). Todos hablan y
 *  cada móvil manda su voz a cada uno de los demás: con 6 son 5 envíos. */
export const MAX_ENTRENOS = 6;

/** Id estable del hub (el móvil que crea la sala) dentro de la lista de
 *  participantes. En señalización WebRTC `de: 'asistente'` ya se usaba como
 *  identidad del hub; aquí queda como participante más, con rol cambiable. */
export const ID_ASISTENTE = 'asistente';

export interface EstadoSala {
  /** Código corto (p. ej. `K7M-4QX`), ya normalizado. */
  codigo: string;
  /** Participantes conectados (asistente, piloto y seguidores). */
  participantes: Participante[];
  /** Se fija al crearla y no cambia. */
  tipo: TipoSala;
}

export function crearSala(codigo: string, tipo: TipoSala = 'carrera'): EstadoSala {
  return { codigo, participantes: [], tipo };
}

/** Papel con el que entra quien pide `rol`: en entrenos, siempre `libre`; en
 *  carrera, `libre` no existe y se entra como seguidor. */
export function rolEfectivo(sala: EstadoSala, rol: Rol): Rol {
  if (sala.tipo === 'entrenos') return 'libre';
  return rol === 'libre' ? 'seguidor' : rol;
}

/** ¿Ese rol ya está ocupado en la sala? (solo uno de piloto/asistente). */
export function rolOcupado(sala: EstadoSala, rol: Rol): boolean {
  // Los seguidores no tienen cupo por rol (los limita `salaLlena`).
  if (rol === 'seguidor' || rol === 'libre') return false;
  return sala.participantes.some(p => p.rol === rol);
}

/** ¿La sala está llena? (en carrera solo limita a los seguidores). */
export function salaLlena(sala: EstadoSala, rol: Rol): boolean {
  if (sala.tipo === 'entrenos') return sala.participantes.length >= MAX_ENTRENOS;
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
  const rol = rolEfectivo(sala, p.rol);
  if (rolOcupado(sala, rol)) return { ok: false, motivo: 'rol-ocupado' };
  if (salaLlena(sala, rol)) return { ok: false, motivo: 'sala-llena' };
  return { ok: true, participante: { id: p.id, nombre: p.nombre, rol } };
}

/**
 * Reconexión: si entra alguien con el mismo nombre y papel (piloto/asistente)
 * que un participante remoto que sigue en la sala, es él mismo volviendo tras
 * perder la conexión y el asistente aún no se ha enterado de que se cayó. Se
 * devuelve el id de esa conexión vieja para descartarla; si no, `null`.
 */
export function participanteObsoleto(sala: EstadoSala, nombre: string, rolPedido: Rol): string | null {
  const rol = rolEfectivo(sala, rolPedido);
  if (rol === 'seguidor') return null;
  const viejo = sala.participantes.find(
    p => p.id !== ID_ASISTENTE && p.rol === rol && p.nombre === nombre,
  );
  return viejo?.id ?? null;
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

export type ResultadoCambioRol =
  | { ok: true; sala: EstadoSala }
  | { ok: false; motivo: MotivoRechazo };

/**
 * Cambia el rol de un participante (el hub o un remoto) respetando los cupos:
 * un solo piloto y un solo asistente; los seguidores se limitan por
 * `MAX_SEGUIDORES`. No muta la sala.
 */
export function cambiarRolSala(sala: EstadoSala, id: string, rol: Rol): ResultadoCambioRol {
  const participante = sala.participantes.find(p => p.id === id);
  if (!participante) return { ok: false, motivo: 'codigo' };
  // En entrenos no hay papeles que cambiar; en carrera, `libre` no existe.
  if (sala.tipo === 'entrenos' || rol === 'libre') return { ok: false, motivo: 'rol-ocupado' };
  if (participante.rol === rol) return { ok: true, sala };

  if (rol !== 'seguidor') {
    const ocupado = sala.participantes.some(p => p.id !== id && p.rol === rol);
    if (ocupado) return { ok: false, motivo: 'rol-ocupado' };
  } else {
    const seguidores = sala.participantes.filter(p => p.id !== id && p.rol === 'seguidor').length;
    if (seguidores >= MAX_SEGUIDORES) return { ok: false, motivo: 'sala-llena' };
  }

  return {
    ok: true,
    sala: {
      ...sala,
      participantes: sala.participantes.map(p => (p.id === id ? { ...p, rol } : p)),
    },
  };
}

/** Lista de participantes para el mensaje `participantes` (orden estable). */
export function listaDeParticipantes(sala: EstadoSala): Participante[] {
  return sala.participantes.slice();
}
