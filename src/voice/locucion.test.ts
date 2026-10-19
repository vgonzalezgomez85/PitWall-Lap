import { estaLocutando, notificarLocucion, onLocucion } from './locucion';

describe('locucion', () => {
  afterEach(() => notificarLocucion(false));

  it('avisa a los suscritos solo cuando cambia el estado', () => {
    const vistos: boolean[] = [];
    const off = onLocucion(v => vistos.push(v));
    notificarLocucion(true);
    notificarLocucion(true);
    notificarLocucion(false);
    off();
    notificarLocucion(true);
    expect(vistos).toEqual([true, false]);
    expect(estaLocutando()).toBe(true);
  });

  it('si el fin no llega, se da por terminada a los 10 s', () => {
    jest.useFakeTimers();
    const vistos: boolean[] = [];
    const off = onLocucion(v => vistos.push(v));
    notificarLocucion(true);
    jest.advanceTimersByTime(9_999);
    expect(estaLocutando()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(estaLocutando()).toBe(false);
    expect(vistos).toEqual([true, false]);
    off();
    jest.useRealTimers();
  });
});
