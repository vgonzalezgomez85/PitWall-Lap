import { esFuentePista } from './types';

describe('esFuentePista', () => {
  it('reconoce pitwall e infolap', () => {
    expect(esFuentePista('pitwall')).toBe(true);
    expect(esFuentePista('infolap')).toBe(true);
  });

  it('no considera la fuente asistente ni valores vacíos', () => {
    expect(esFuentePista('asistente')).toBe(false);
    expect(esFuentePista(null)).toBe(false);
    expect(esFuentePista(undefined)).toBe(false);
  });
});
