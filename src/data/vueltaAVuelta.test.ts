import { nivelVuelta, tablaVueltaAVuelta } from './vueltaAVuelta';

describe('nivel de cada vuelta', () => {
  const mejor = 10000;
  it.each([
    [10000, 'mejor'],
    [10200, 'rapida'],     // +2 %
    [10201, 'regular'],
    [10500, 'regular'],    // +5 %
    [10501, 'lenta'],
    [11000, 'lenta'],      // +10 %
    [11001, 'muyLenta'],
    [15000, 'muyLenta'],   // salida de pista
  ])('%i ms → %s', (ms, nivel) => {
    expect(nivelVuelta(ms, mejor)).toBe(nivel);
  });
});

describe('tabla vuelta a vuelta', () => {
  it('una fila por vuelta, con la diferencia con la mejor y su nivel', () => {
    const filas = tablaVueltaAVuelta([[7420, 7110, 7180, 7600, 8500]]);
    expect(filas.map(f => f.vuelta)).toEqual([1, 2, 3, 4, 5]);
    expect(filas.map(f => f.celdas[0]?.difMejorMs)).toEqual([310, 0, 70, 490, 1390]);
    expect(filas.map(f => f.celdas[0]?.nivel))
      .toEqual(['regular', 'mejor', 'rapida', 'lenta', 'muyLenta']);
  });

  it('compara stints lado a lado, cada uno contra su propia mejor', () => {
    const filas = tablaVueltaAVuelta([[7200, 7100], [8000, 8100, 7900]]);
    expect(filas).toHaveLength(3);
    expect(filas[0]!.celdas.map(c => c?.difMejorMs)).toEqual([100, 100]);
    // 8100 frente a 7900 es +2,5 % → regular.
    expect(filas[1]!.celdas.map(c => c?.nivel)).toEqual(['mejor', 'regular']);
    // El primer stint solo tiene 2 vueltas: la tercera va vacía.
    expect(filas[2]!.celdas[0]).toBeNull();
    expect(filas[2]!.celdas[1]?.nivel).toBe('mejor');
  });

  it('sin vueltas no hay filas', () => {
    expect(tablaVueltaAVuelta([[]])).toEqual([]);
    expect(tablaVueltaAVuelta([])).toEqual([]);
  });
});
