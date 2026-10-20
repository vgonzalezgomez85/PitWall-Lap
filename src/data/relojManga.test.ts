import { PAUSA_SIN_VUELTAS_MS, RelojManga } from './relojManga';

const MIN = 60_000;

describe('RelojManga', () => {
  it('sin duración o sin empezar no hay tiempo restante', () => {
    const r = new RelojManga();
    expect(r.restanteMs(0, 5 * MIN)).toBeNull();
    r.iniciar(0);
    expect(r.restanteMs(1000, null)).toBeNull();
  });

  it('CONFIG: cuenta desde el inicio', () => {
    const r = new RelojManga();
    r.iniciar(1_000);
    expect(r.restanteMs(61_000, 5 * MIN)).toBe(4 * MIN);
    expect(r.restanteMs(10 * MIN, 5 * MIN)).toBe(0);
  });

  it('TicTac antiguo: arranca con la primera vuelta, descontando lo que tardó', () => {
    const r = new RelojManga();
    r.vuelta(10_000, 4_000, true);
    expect(r.iniciado).toBe(true);
    expect(r.restanteMs(10_000, 5 * MIN)).toBe(5 * MIN - 4_000);
  });

  it('TicTac nuevo: una vuelta sin CONFIG no arranca el reloj', () => {
    const r = new RelojManga();
    r.vuelta(10_000, 4_000, false);
    expect(r.iniciado).toBe(false);
    expect(r.restanteMs(10_000, 5 * MIN)).toBeNull();
  });

  it('pausa: se congela desde la última vuelta y descuenta lo parado', () => {
    const r = new RelojManga();
    r.iniciar(0);
    r.vuelta(30_000, 4_000, false);
    expect(r.comprobarPausa(30_000 + PAUSA_SIN_VUELTAS_MS - 1, 5 * MIN)).toBe(false);
    expect(r.comprobarPausa(30_000 + PAUSA_SIN_VUELTAS_MS, 5 * MIN)).toBe(true);
    expect(r.enPausa).toBe(true);
    // Parado: el reloj se queda donde estaba en la última vuelta.
    expect(r.restanteMs(100_000, 5 * MIN)).toBe(5 * MIN - 30_000);
    // Se reanuda en 120 s; la primera vuelta (4 s) llega a 124 s.
    r.vuelta(124_000, 4_000, false);
    expect(r.enPausa).toBe(false);
    expect(r.restanteMs(124_000, 5 * MIN)).toBe(5 * MIN - 30_000 - 4_000);
  });

  it('con la manga acabada, el silencio no es una pausa', () => {
    const r = new RelojManga();
    r.iniciar(0);
    r.vuelta(MIN, 4_000, false);
    expect(r.comprobarPausa(MIN + PAUSA_SIN_VUELTAS_MS, MIN)).toBe(false);
  });

  it('reiniciar: espera a la primera vuelta de la manga nueva', () => {
    const r = new RelojManga();
    r.iniciar(0);
    r.vuelta(30_000, 4_000, false);
    r.reiniciar();
    expect(r.iniciado).toBe(false);
    expect(r.comprobarPausa(10 * MIN, 5 * MIN)).toBe(false);
  });
});
