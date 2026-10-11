import {
  avisosPendientes, combinarFechaHora, fechaAviso, separarEventos, type Evento,
} from './calendario';

const ev = (id: string, inicio: string): Evento => ({
  id, nombre: id, inicio, avisos: [], notificaciones: [],
});

describe('fechaAviso', () => {
  it('resta la antelación al inicio', () => {
    const inicio = '2026-11-14T10:00:00.000Z';
    expect(fechaAviso(inicio, 'hora').toISOString()).toBe('2026-11-14T10:00:00.000Z');
    expect(fechaAviso(inicio, '30min').toISOString()).toBe('2026-11-14T09:30:00.000Z');
    expect(fechaAviso(inicio, '1h').toISOString()).toBe('2026-11-14T09:00:00.000Z');
    expect(fechaAviso(inicio, '1d').toISOString()).toBe('2026-11-13T10:00:00.000Z');
    expect(fechaAviso(inicio, '1sem').toISOString()).toBe('2026-11-07T10:00:00.000Z');
  });
});

describe('avisosPendientes', () => {
  const inicio = '2026-11-14T10:00:00.000Z';

  it('descarta los avisos cuya hora ya pasó', () => {
    const ahora = new Date('2026-11-13T12:00:00.000Z');
    const r = avisosPendientes(inicio, ['1sem', '1d', '1h', 'hora'], ahora);
    expect(r.map(a => a.aviso)).toEqual(['1h', 'hora']);
  });

  it('un evento pasado no tiene avisos pendientes', () => {
    const ahora = new Date('2026-11-15T00:00:00.000Z');
    expect(avisosPendientes(inicio, ['hora', '1h'], ahora)).toEqual([]);
  });

  it('una fecha inválida no programa nada', () => {
    expect(avisosPendientes('no-es-fecha', ['1h'], new Date())).toEqual([]);
  });
});

describe('separarEventos', () => {
  it('próximos por cercanía y pasados del más reciente al más antiguo', () => {
    const ahora = new Date('2026-11-10T00:00:00.000Z');
    const { proximos, pasados } = separarEventos([
      ev('lejos', '2026-12-20T10:00:00.000Z'),
      ev('viejo', '2026-09-01T10:00:00.000Z'),
      ev('cerca', '2026-11-12T10:00:00.000Z'),
      ev('reciente', '2026-11-01T10:00:00.000Z'),
    ], ahora);
    expect(proximos.map(e => e.id)).toEqual(['cerca', 'lejos']);
    expect(pasados.map(e => e.id)).toEqual(['reciente', 'viejo']);
  });

  it('el evento que empieza justo ahora cuenta como pasado', () => {
    const ahora = new Date('2026-11-10T10:00:00.000Z');
    const { proximos, pasados } = separarEventos([ev('ya', '2026-11-10T10:00:00.000Z')], ahora);
    expect(proximos).toEqual([]);
    expect(pasados.map(e => e.id)).toEqual(['ya']);
  });
});

describe('combinarFechaHora', () => {
  it('toma el día de uno y la hora del otro, sin segundos', () => {
    const r = combinarFechaHora(new Date(2026, 10, 14, 3, 7, 9), new Date(2000, 0, 1, 18, 45, 30));
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(10);
    expect(r.getDate()).toBe(14);
    expect(r.getHours()).toBe(18);
    expect(r.getMinutes()).toBe(45);
    expect(r.getSeconds()).toBe(0);
  });
});
