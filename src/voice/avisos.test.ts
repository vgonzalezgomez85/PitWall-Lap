import { cuentaParaMedia, mediaAnunciable } from './avisos';

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
