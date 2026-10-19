// Entrada manual a una sala por IP, para cuando el descubrimiento mDNS no la
// encuentra (pasa a menudo: el anuncio Bonjour se pierde sin dar error). El
// asistente ve su IP en la pantalla de la sala y el participante la teclea
// junto con el código. Puro, para poder testearlo.

import { codigoValido, formatearCodigo } from './codigo';
import type { SalaDescubierta } from './red';

/** ¿Es una IPv4 numérica válida (cuatro números de 0 a 255)? */
export function ipValida(ip: string): boolean {
  const partes = ip.trim().split('.');
  if (partes.length !== 4) return false;
  return partes.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Construye la sala a la que conectarse a partir de lo tecleado, o `null` si
 *  la IP o el código no son válidos. */
export function salaManual(ip: string, codigo: string, puerto: number): SalaDescubierta | null {
  if (!ipValida(ip) || !codigoValido(codigo)) return null;
  const c = formatearCodigo(codigo);
  return { host: ip.trim(), puerto, codigo: c, nombre: `Radio ${c}` };
}

/** Sala por internet: solo hace falta el código (el relé hace de punto de
 *  encuentro). `null` si el código no es válido. */
export function salaInternet(codigo: string): SalaDescubierta | null {
  if (!codigoValido(codigo)) return null;
  const c = formatearCodigo(codigo);
  return { host: 'internet', puerto: 0, codigo: c, nombre: `Radio ${c}`, modo: 'internet' };
}
