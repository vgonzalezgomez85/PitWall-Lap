import { marcarCancelada, marcarPausa, marcarTerminada } from './cicloManga';
import { emptyLiveState, type LiveState } from './types';

function enCarrera(): LiveState {
  return {
    ...emptyLiveState(),
    status: 'my-turn',
    myLane: 3,
    selfName: 'Azul',
    currentMangaNum: 2,
    lapCount: 41,
    lastLapMs: 5_230,
    bestLapMs: 5_010,
    position: 2,
    remainingMs: 95_000,
    estadoManga: 'en-curso',
  };
}

describe('cicloManga', () => {
  it('pausa y reanuda sin tocar los datos', () => {
    const p = marcarPausa(enCarrera(), true);
    expect(p.estadoManga).toBe('pausada');
    expect(p.lapCount).toBe(41);
    expect(p.remainingMs).toBe(95_000);
    expect(marcarPausa(p, false).estadoManga).toBe('en-curso');
  });

  it('una pausa tardía no reabre una manga cerrada', () => {
    const t = marcarTerminada(enCarrera(), undefined);
    expect(marcarPausa(t, false)).toBe(t);
    const c = marcarCancelada(enCarrera());
    expect(marcarPausa(c, true)).toBe(c);
  });

  it('al terminar conserva los datos finales y apunta la siguiente', () => {
    const t = marcarTerminada(enCarrera(), { mangaNum: 3, lane: 1 });
    expect(t).toMatchObject({
      status: 'my-turn', estadoManga: 'terminada', remainingMs: 0,
      lapCount: 41, bestLapMs: 5_010, nextMangaInfo: { mangaNum: 3, lane: 1 },
    });
  });

  it('al cancelar vacía la manga pero conserva piloto y carril', () => {
    const c = marcarCancelada(enCarrera());
    expect(c).toMatchObject({
      status: 'my-turn', estadoManga: 'cancelada', myLane: 3, selfName: 'Azul',
      currentMangaNum: 2, lapCount: 0, lastLapMs: null, bestLapMs: null,
      position: null, remainingMs: null,
    });
  });
});
