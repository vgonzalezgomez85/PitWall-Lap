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
});
