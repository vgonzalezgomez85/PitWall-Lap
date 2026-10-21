// Reglas puras de cuándo merece la pena un aviso de voz.

/** Vueltas válidas mínimas en la manga antes de anunciar una media: con una
 *  sola, la "media" es esa misma vuelta y repetirla no aporta nada. */
export const MIN_VUELTAS_MEDIA = 2;

/** Vuelta que entra en la media: con tiempo, sin salida y sin ser el primer
 *  paso por meta (el tramo de salida no es una vuelta completa). */
export function cuentaParaMedia(e: {
  lapTimeMs: number | null;
  isExit?: boolean;
  isFirstCrossing?: boolean;
}): boolean {
  return e.lapTimeMs != null && !e.isExit && !e.isFirstCrossing;
}

export function mediaAnunciable(vueltasValidas: number): boolean {
  return vueltasValidas >= MIN_VUELTAS_MEDIA;
}

/** Media de carrera, gaps y media para subir. Con el TicTac antiguo no se
 *  locutan: sale de una clasificación que reconstruye el móvil, no del
 *  cronómetro. Vueltas, posición, vuelta rápida, media de carril y avisos de
 *  tiempo sí. */
export function locutaAvisosDeClasificacion(
  raceInfo: { source: string; protocoloTicTac?: 'antiguo' | 'nuevo' } | null | undefined,
  /** El protocolo de ahora (LiveState): manda sobre el de la conexión. */
  enVivo?: 'antiguo' | 'nuevo',
): boolean {
  const protocolo = enVivo ?? raceInfo?.protocoloTicTac;
  return !(raceInfo?.source === 'infolap' && protocolo === 'antiguo');
}

/** Silencio sin cambios de posición antes de anunciarla: con el TicTac llega
 *  una clasificación por cada cruce, y si te pasan cuatro seguidos se oiría
 *  «tercero, cuarto, quinto, sexto». */
export const ESPERA_POSICION_MS = 3_000;
/** Tope de espera desde el primer cambio, por si la posición no para quieta. */
export const ESPERA_POSICION_MAX_MS = 6_000;

export interface AgrupadorPosicion {
  cambio(desde: number, hasta: number): void;
  cancelar(): void;
}

/** Agrupa una racha de cambios de posición en un solo aviso con la última.
 *  Si la racha acaba donde empezó (2 → 3 → 2), no se anuncia nada. */
export function crearAgrupadorPosicion(anunciar: (posicion: number) => void): AgrupadorPosicion {
  let origen: number | null = null;
  let ultima: number | null = null;
  let inicio = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cerrar = () => {
    timer = null;
    const desde = origen, hasta = ultima;
    origen = ultima = null;
    if (desde != null && hasta != null && hasta !== desde) anunciar(hasta);
  };

  return {
    cambio(desde, hasta) {
      if (origen == null) { origen = desde; inicio = Date.now(); }
      ultima = hasta;
      if (timer) clearTimeout(timer);
      const restante = ESPERA_POSICION_MAX_MS - (Date.now() - inicio);
      timer = setTimeout(cerrar, Math.max(0, Math.min(ESPERA_POSICION_MS, restante)));
    },
    cancelar() {
      if (timer) clearTimeout(timer);
      timer = null;
      origen = ultima = null;
    },
  };
}
