// Transiciones del ciclo de vida de la manga (PitWall Manager) sobre el
// LiveState. Funciones puras para poder testearlas sin socket.

import { emptyLiveState, type LiveState } from './types';

type Siguiente = LiveState['nextMangaInfo'];

/** `manga:paused` / `manga:resumed`. No resucita una manga ya cerrada. */
export function marcarPausa(s: LiveState, pausada: boolean): LiveState {
  if (s.estadoManga === 'terminada' || s.estadoManga === 'cancelada') return s;
  return { ...s, estadoManga: pausada ? 'pausada' : 'en-curso' };
}

/** `manga:stopped` (fin normal). Conserva los datos finales de la manga para
 *  que se puedan consultar hasta que arranque la siguiente, y apunta cuál es
 *  la próxima manga del piloto (undefined = no le quedan). */
export function marcarTerminada(s: LiveState, siguiente: Siguiente): LiveState {
  return { ...s, estadoManga: 'terminada', remainingMs: 0, nextMangaInfo: siguiente };
}

/** `manga:cancelled` (STOP manual). El servidor borra las vueltas y la manga
 *  vuelve a pendiente para repetirse: vaciamos los datos de la manga y
 *  conservamos quién soy, dónde corro y el contexto de carrera. */
export function marcarCancelada(s: LiveState): LiveState {
  return {
    ...emptyLiveState(),
    status: s.status,
    myLane: s.myLane,
    selfName: s.selfName,
    currentMangaNum: s.currentMangaNum,
    nextMangaInfo: s.nextMangaInfo,
    isFinal: s.isFinal,
    tireControl: s.tireControl,
    estadoManga: 'cancelada',
  };
}
