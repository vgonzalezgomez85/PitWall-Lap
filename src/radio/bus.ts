// Bus de mensajes de Radio entrantes, a nivel de módulo (sin React). Permite
// desacoplar el `RadioContext` (que recibe los mensajes por el canal de datos)
// de los consumidores: la fuente `AsistenteSource` y la coordinación de voz.
//
// Solo hay una sala activa a la vez, así que un bus global es suficiente.

import type { MensajeRadio } from './mensajes';

type Oyente = (m: MensajeRadio) => void;

const oyentes = new Set<Oyente>();

/** Publica un mensaje recibido por el canal de datos a todos los oyentes. */
export function emitirMensajeRadio(m: MensajeRadio): void {
  for (const cb of oyentes) {
    try {
      cb(m);
    } catch {
      // Un oyente que lanza no debe tumbar a los demás ni al canal de datos.
    }
  }
}

/** Se suscribe al bus. Devuelve la función de cancelación. */
export function onMensajeRadio(cb: Oyente): () => void {
  oyentes.add(cb);
  return () => {
    oyentes.delete(cb);
  };
}

/** Nº de oyentes (útil en tests). */
export function oyentesRadio(): number {
  return oyentes.size;
}
