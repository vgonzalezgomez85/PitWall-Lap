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
