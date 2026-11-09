// Acumulación de vueltas de un stint de entrenamiento, a prueba de huecos.
//
// El grabador solo ve las vueltas que le llegan en vivo por el socket. Si la
// conexión se corta un rato (Android apaga la pantalla y duerme la app o el
// WiFi), esas vueltas no llegan nunca y el stint se quedaba corto: el
// servidor decía 20 vueltas y la app guardaba 4.
//
// PitWall Manager manda en cada `training:lap` el contador del carril y el
// historial reciente de tiempos (hasta 120). Con eso, cuando llega una vuelta
// y el contador salta más de uno, se recuperan las que faltan del historial.

export interface GrabacionStint {
  vueltas: number[];
  /** Contador del carril en la última vuelta vista (o al pulsar GO). */
  ultimoContador: number | null;
}

export interface VueltaRecibida {
  lapTimeMs: number;
  lapCount: number;
  /** Tiempos del carril en orden cronológico, el último puede ser esta vuelta. */
  historialMs?: number[] | null;
}

/** Estado al pulsar «Entreno GO»; `contadorActual` = vueltas que ya llevaba el carril. */
export function iniciarGrabacion(contadorActual: number | null): GrabacionStint {
  return { vueltas: [], ultimoContador: contadorActual ?? null };
}

export function anadirVuelta(g: GrabacionStint, v: VueltaRecibida): GrabacionStint {
  const historial = v.historialMs;
  // Sin historial (TicTac, asistente…) no hay nada que recuperar: se añade tal cual.
  if (!historial || historial.length === 0) {
    return { vueltas: [...g.vueltas, v.lapTimeMs], ultimoContador: v.lapCount };
  }

  // La misma vuelta otra vez (reenvío tras reconectar): se ignora.
  if (g.ultimoContador != null && v.lapCount === g.ultimoContador) return g;

  // Vueltas que no nos han llegado entre la anterior y esta. Si el contador
  // baja, el servidor reinició la tanda (nuevo GO o heat): faltan las de antes
  // de esta dentro de la tanda nueva.
  let faltan = 0;
  if (g.ultimoContador != null) {
    faltan = v.lapCount > g.ultimoContador
      ? v.lapCount - g.ultimoContador - 1
      : v.lapCount - 1;
  }

  // El historial del servidor incluye la vuelta actual al final.
  const anteriores = historial[historial.length - 1] === v.lapTimeMs
    ? historial.slice(0, -1)
    : historial;
  const tomar = Math.max(0, Math.min(faltan, anteriores.length));
  const recuperadas = tomar > 0 ? anteriores.slice(anteriores.length - tomar) : [];

  return {
    vueltas: [...g.vueltas, ...recuperadas, v.lapTimeMs],
    ultimoContador: v.lapCount,
  };
}
