// Por dónde sale el sonido de Radio, según el papel (fase B: evitar acoples).
// El acople aparece cuando lo que sale por el altavoz vuelve a entrar por un
// micro abierto. Puro, para poder testearlo.
//
//   • Micro abierto (piloto, o asistente en modo abierto): nunca altavoz. Sin
//     cascos sale por el auricular del móvil y se avisa de ponérselos.
//   • Asistente en walkie: altavoz opcional. Mientras habla, se silencia lo
//     que llega (semidúplex) para que su micro no capte el altavoz.
//   • Seguidor: sin micro, sin acople posible: altavoz por defecto.

import type { Rol } from './mensajes';
import type { ModoMicroAsistente } from './useVozRadio';

export interface DecisionSalida {
  /** ¿Se fuerza el altavoz? (con cascos el sistema los prefiere igual). */
  altavoz: boolean;
  /** ¿Puede el usuario elegir altavoz en este papel? */
  permiteAltavoz: boolean;
  /** Micro abierto sin cascos: hay que avisar de ponérselos. */
  avisoCascos: boolean;
  /** Mientras se habla (walkie) con altavoz, silenciar lo que llega. */
  semiduplex: boolean;
}

export function decidirSalida(opciones: {
  rol: Rol | null;
  modoAsistente: ModoMicroAsistente;
  cascos: boolean;
  /** Preferencia guardada de altavoz; `null` = la de serie del papel. */
  altavozPedido: boolean | null;
}): DecisionSalida {
  const { rol, modoAsistente, cascos, altavozPedido } = opciones;
  const microAbierto = rol === 'piloto' || (rol === 'asistente' && modoAsistente === 'abierto');
  if (microAbierto) {
    return { altavoz: false, permiteAltavoz: false, avisoCascos: !cascos, semiduplex: false };
  }
  if (rol === 'asistente') {
    const altavoz = altavozPedido ?? false;
    return { altavoz, permiteAltavoz: true, avisoCascos: false, semiduplex: altavoz && !cascos };
  }
  // Seguidor (o aún sin papel): solo escucha.
  return { altavoz: altavozPedido ?? true, permiteAltavoz: true, avisoCascos: false, semiduplex: false };
}
