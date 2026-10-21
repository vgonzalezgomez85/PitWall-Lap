import {
  ESPERA_POSICION_MAX_MS, ESPERA_POSICION_MS, crearAgrupadorPosicion,
  cuentaParaMedia, locutaAvisosDeClasificacion, mediaAnunciable,
} from './avisos';

describe('avisos de clasificación (media de carrera, gaps, para subir)', () => {
  it('se callan solo con el TicTac antiguo', () => {
    expect(locutaAvisosDeClasificacion({ source: 'infolap', protocoloTicTac: 'antiguo' })).toBe(false);
    expect(locutaAvisosDeClasificacion({ source: 'infolap', protocoloTicTac: 'nuevo' })).toBe(true);
    expect(locutaAvisosDeClasificacion({ source: 'pitwall' })).toBe(true);
    expect(locutaAvisosDeClasificacion(null)).toBe(true);
  });
});

describe('avisos de media', () => {
  it('solo cuentan las vueltas con tiempo, sin salida ni primer paso', () => {
    expect(cuentaParaMedia({ lapTimeMs: 10_000 })).toBe(true);
    expect(cuentaParaMedia({ lapTimeMs: null })).toBe(false);
    expect(cuentaParaMedia({ lapTimeMs: 14_000, isExit: true })).toBe(false);
    expect(cuentaParaMedia({ lapTimeMs: 4_000, isFirstCrossing: true })).toBe(false);
  });

  it('la media no se anuncia con una sola vuelta válida', () => {
    expect(mediaAnunciable(0)).toBe(false);
    expect(mediaAnunciable(1)).toBe(false);
    expect(mediaAnunciable(2)).toBe(true);
  });
});

describe('agrupador de cambios de posición', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('una racha 2 → 6 se anuncia una sola vez, con la última', () => {
    const dichas: number[] = [];
    const a = crearAgrupadorPosicion(p => dichas.push(p));
    a.cambio(2, 3);
    jest.advanceTimersByTime(800);
    a.cambio(3, 4);
    jest.advanceTimersByTime(800);
    a.cambio(4, 5);
    jest.advanceTimersByTime(800);
    a.cambio(5, 6);
    expect(dichas).toEqual([]);
    jest.advanceTimersByTime(ESPERA_POSICION_MS);
    expect(dichas).toEqual([6]);
  });

  it('si vuelve a la posición de partida, no dice nada', () => {
    const dichas: number[] = [];
    const a = crearAgrupadorPosicion(p => dichas.push(p));
    a.cambio(2, 3);
    a.cambio(3, 2);
    jest.advanceTimersByTime(ESPERA_POSICION_MS);
    expect(dichas).toEqual([]);
  });

  it('no espera más del tope aunque la posición no pare', () => {
    const dichas: number[] = [];
    const a = crearAgrupadorPosicion(p => dichas.push(p));
    for (let pos = 2; pos < 12; pos++) {
      a.cambio(pos, pos + 1);
      jest.advanceTimersByTime(1_000);
    }
    expect(dichas.length).toBeGreaterThan(0);
    expect(dichas[0]).toBeLessThan(12);
  });

  it('cancelar descarta la racha pendiente', () => {
    const dichas: number[] = [];
    const a = crearAgrupadorPosicion(p => dichas.push(p));
    a.cambio(2, 5);
    a.cancelar();
    jest.advanceTimersByTime(ESPERA_POSICION_MAX_MS);
    expect(dichas).toEqual([]);
  });
});
