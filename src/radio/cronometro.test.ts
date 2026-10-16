import { crearCronometro } from './cronometro';

describe('cronómetro del asistente', () => {
  // Reloj simulado: empieza en 0 y avanza según lo indiquemos.
  function reloj() {
    let t = 0;
    return {
      now: () => t,
      adelantar: (ms: number) => {
        t += ms;
      },
    };
  }

  it('la primera pulsación es el inicio, sin tiempo de vuelta', () => {
    const r = reloj();
    const c = crearCronometro(r.now);
    expect(c.pulsar()).toBeNull();
    expect(c.total()).toBe(0);
  });

  it('mide la vuelta como diferencia entre pulsaciones', () => {
    const r = reloj();
    const c = crearCronometro(r.now);
    c.pulsar(); // inicio
    r.adelantar(7846);
    expect(c.pulsar()).toEqual({ n: 1, ms: 7846, ts: 7846 });
    r.adelantar(8100);
    expect(c.pulsar()).toEqual({ n: 2, ms: 8100, ts: 15_946 });
    expect(c.total()).toBe(2);
  });

  it('calcula la mejor vuelta', () => {
    const r = reloj();
    const c = crearCronometro(r.now);
    c.pulsar();
    r.adelantar(9000);
    c.pulsar();
    r.adelantar(7000);
    c.pulsar();
    r.adelantar(8000);
    c.pulsar();
    expect(c.mejor()).toEqual({ n: 2, ms: 7000, ts: 16_000 });
  });

  it('deshacer borra la última vuelta y restaura la referencia', () => {
    const r = reloj();
    const c = crearCronometro(r.now);
    c.pulsar(); // inicio
    r.adelantar(9000);
    c.pulsar(); // vuelta 1
    r.adelantar(7000);
    c.pulsar(); // vuelta 2
    expect(c.deshacer()).toEqual({ n: 2, ms: 7000, ts: 16_000 });
    // Tras deshacer, la referencia vuelve a ser el cruce de la vuelta 1
    // (t=9000); la siguiente pulsación mide desde ahí (21000 − 9000).
    r.adelantar(5000);
    expect(c.pulsar()).toEqual({ n: 2, ms: 12_000, ts: 21_000 });
  });

  it('deshacer sin vueltas devuelve null y limpia el inicio', () => {
    const r = reloj();
    const c = crearCronometro(r.now);
    c.pulsar(); // inicio
    expect(c.deshacer()).toBeNull();
    // Al quitar el inicio, la siguiente pulsación vuelve a ser arranque.
    expect(c.pulsar()).toBeNull();
  });

  it('reiniciar borra las vueltas y la marca de inicio', () => {
    const r = reloj();
    const c = crearCronometro(r.now);
    c.pulsar();
    r.adelantar(9000);
    c.pulsar();
    c.reiniciar();
    expect(c.total()).toBe(0);
    expect(c.mejor()).toBeNull();
    expect(c.pulsar()).toBeNull();
  });
});
