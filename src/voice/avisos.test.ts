import { cuentaParaMedia, locutaAvisosDeClasificacion, mediaAnunciable } from './avisos';

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
