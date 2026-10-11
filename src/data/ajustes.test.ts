import { AJUSTES_POR_DEFECTO, normalizarAjustes } from './ajustes';

describe('normalizarAjustes', () => {
  it('sin nada guardado, valores por defecto (estrategia activada)', () => {
    expect(normalizarAjustes(null)).toEqual(AJUSTES_POR_DEFECTO);
    expect(normalizarAjustes(undefined)).toEqual(AJUSTES_POR_DEFECTO);
    expect(AJUSTES_POR_DEFECTO.estrategiaNeumaticos).toBe(true);
  });

  it('respeta lo guardado', () => {
    expect(normalizarAjustes({ estrategiaNeumaticos: false }).estrategiaNeumaticos).toBe(false);
    expect(normalizarAjustes({ estrategiaNeumaticos: true }).estrategiaNeumaticos).toBe(true);
  });

  it('descarta valores que no son booleanos', () => {
    expect(normalizarAjustes({ estrategiaNeumaticos: 'no' })).toEqual(AJUSTES_POR_DEFECTO);
    expect(normalizarAjustes('basura')).toEqual(AJUSTES_POR_DEFECTO);
    expect(normalizarAjustes([])).toEqual(AJUSTES_POR_DEFECTO);
  });
});
