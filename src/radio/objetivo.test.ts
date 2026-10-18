import { parsearObjetivo } from './objetivo';

describe('parsearObjetivo', () => {
  it('acepta coma o punto decimal', () => {
    expect(parsearObjetivo('7,85')).toBe(7850);
    expect(parsearObjetivo(' 7.851 ')).toBe(7851);
    expect(parsearObjetivo('12')).toBe(12000);
  });

  it('rechaza lo que no es un tiempo de vuelta', () => {
    expect(parsearObjetivo('')).toBeNull();
    expect(parsearObjetivo('0.5')).toBeNull();
    expect(parsearObjetivo('abc')).toBeNull();
    expect(parsearObjetivo('7:85')).toBeNull();
  });
});
