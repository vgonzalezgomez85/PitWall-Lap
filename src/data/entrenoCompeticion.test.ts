import {
  entrenoDesdeServidor, pendientesDeDescargar, sesionesDeServidor,
} from './entrenoCompeticion';

describe('sesionesDeServidor', () => {
  it('lee la lista y descarta lo que no es una sesión', () => {
    const r = sesionesDeServidor({
      sessions: [
        { id: 'ct-1', startedAt: '2026-10-11T09:00:00Z', heats: 4, participants: 8, laps: 120, bestLapMs: 7900 },
        { heats: 1 },
        null,
        { id: 'ct-2', heats: 'x' },
      ],
    });
    expect(r.map(s => s.id)).toEqual(['ct-1', 'ct-2']);
    expect(r[0]).toEqual({
      id: 'ct-1', startedAt: '2026-10-11T09:00:00Z', heats: 4, participants: 8, laps: 120, bestLapMs: 7900,
    });
    expect(r[1]).toEqual({ id: 'ct-2', startedAt: null, heats: 0, participants: 0, laps: 0, bestLapMs: null });
  });

  it('una respuesta rara es una lista vacía', () => {
    expect(sesionesDeServidor(null)).toEqual([]);
    expect(sesionesDeServidor({})).toEqual([]);
    expect(sesionesDeServidor({ sessions: 'no' })).toEqual([]);
  });
});

describe('entrenoDesdeServidor', () => {
  const ahora = new Date('2026-10-11T12:00:00.000Z');
  const valido = {
    id: 'ct-1',
    startedAt: '2026-10-11T09:00:00Z',
    standings: [
      { pos: 1, name: 'Luis', heats: 2, laps: 20, bestLapMs: 7950, avgLapMs: 8050 },
      { name: 'Ana', heats: 2, laps: 18, bestLapMs: 7900, avgLapMs: null },
    ],
    heats: [
      { heat: 1, lanes: [{ lane: 1, name: 'Ana', bestLapMs: 7900, avgLapMs: 8000, laps: 10 }] },
      { heat: 2, lanes: [] },
    ],
  };

  it('convierte una sesión válida y anota cuándo se descargó', () => {
    const e = entrenoDesdeServidor(valido, ahora)!;
    expect(e.id).toBe('ct-1');
    expect(e.descargadoEn).toBe('2026-10-11T12:00:00.000Z');
    expect(e.standings.map(s => [s.pos, s.name, s.laps])).toEqual([[1, 'Luis', 20], [2, 'Ana', 18]]);
    expect(e.standings[1]!.avgLapMs).toBeNull();
    expect(e.heats[0]!.lanes[0]).toEqual({ lane: 1, name: 'Ana', bestLapMs: 7900, avgLapMs: 8000, laps: 10 });
    expect(e.heats[1]!.lanes).toEqual([]);
  });

  it('rechaza lo que no tiene forma de sesión', () => {
    expect(entrenoDesdeServidor(null, ahora)).toBeNull();
    expect(entrenoDesdeServidor({ id: 'x' }, ahora)).toBeNull();
    expect(entrenoDesdeServidor({ ...valido, heats: 'no' }, ahora)).toBeNull();
    expect(entrenoDesdeServidor({ ...valido, id: 5 }, ahora)).toBeNull();
  });
});

describe('pendientesDeDescargar', () => {
  it('deja solo las que no están ya en el móvil, en el mismo orden', () => {
    const mk = (id: string) => ({ id, startedAt: null, heats: 1, participants: 1, laps: 1, bestLapMs: null });
    const r = pendientesDeDescargar([mk('c'), mk('b'), mk('a')], ['b']);
    expect(r.map(s => s.id)).toEqual(['c', 'a']);
  });
});
