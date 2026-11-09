import { anadirVuelta, iniciarGrabacion, type GrabacionStint } from './grabacionStint';

// Simula el historial `pace` del servidor: todas las vueltas del carril hasta `n`.
const tiempos = Array.from({ length: 30 }, (_, i) => 7000 + i * 10);
const hasta = (n: number) => tiempos.slice(0, n);
const vuelta = (n: number) => ({ lapTimeMs: tiempos[n - 1]!, lapCount: n, historialMs: hasta(n) });

describe('grabación de stints', () => {
  it('sin cortes guarda cada vuelta una vez', () => {
    let g = iniciarGrabacion(0);
    for (let n = 1; n <= 5; n++) g = anadirVuelta(g, vuelta(n));
    expect(g.vueltas).toEqual(hasta(5));
  });

  it('recupera del historial las vueltas perdidas durante un corte', () => {
    let g = iniciarGrabacion(0);
    for (let n = 1; n <= 4; n++) g = anadirVuelta(g, vuelta(n));
    // Pantalla apagada: las vueltas 5..19 no llegan.
    g = anadirVuelta(g, vuelta(20));
    expect(g.vueltas).toEqual(hasta(20));
  });

  it('empieza a contar desde el GO, sin las vueltas previas del carril', () => {
    let g = iniciarGrabacion(10);
    g = anadirVuelta(g, vuelta(11));
    g = anadirVuelta(g, vuelta(14));
    expect(g.vueltas).toEqual(tiempos.slice(10, 14));
  });

  it('ignora la misma vuelta repetida', () => {
    let g = iniciarGrabacion(0);
    g = anadirVuelta(g, vuelta(1));
    g = anadirVuelta(g, vuelta(1));
    expect(g.vueltas).toEqual(hasta(1));
  });

  it('si el servidor reinicia la tanda, sigue sumando desde la nueva', () => {
    let g: GrabacionStint = iniciarGrabacion(0);
    for (let n = 1; n <= 6; n++) g = anadirVuelta(g, vuelta(n));
    // Nuevo GO: el contador vuelve a 1 y se pierden la 1 y la 2.
    g = anadirVuelta(g, vuelta(3));
    expect(g.vueltas).toEqual([...hasta(6), ...hasta(3)]);
  });

  it('recupera solo lo que haya en el historial si el corte es más largo', () => {
    let g = iniciarGrabacion(0);
    g = anadirVuelta(g, vuelta(1));
    g = anadirVuelta(g, { lapTimeMs: tiempos[19]!, lapCount: 20, historialMs: tiempos.slice(14, 20) });
    expect(g.vueltas).toEqual([tiempos[0], ...tiempos.slice(14, 20)]);
  });

  it('sin historial (otras fuentes) añade la vuelta tal cual', () => {
    let g = iniciarGrabacion(null);
    g = anadirVuelta(g, { lapTimeMs: 8000, lapCount: 1 });
    g = anadirVuelta(g, { lapTimeMs: 8100, lapCount: 5 });
    expect(g.vueltas).toEqual([8000, 8100]);
  });
});
