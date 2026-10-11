import {
  aliasCon, clave, leerAvisos, leerCarreras, leerFecha, leerHora, prepararImportacion, type Celda,
} from './calendarioImport';

const alias = aliasCon();

// Serie de Excel de una fecha: días desde 1899-12-30.
const serie = (y: number, m: number, d: number) =>
  Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);

describe('leerFecha', () => {
  it('serie de Excel', () => {
    expect(leerFecha(serie(2026, 11, 14))).toEqual({ y: 2026, m: 11, d: 14 });
    expect(leerFecha(serie(2026, 11, 14) + 0.75)).toEqual({ y: 2026, m: 11, d: 14 });
  });

  it('textos habituales, con día primero', () => {
    expect(leerFecha('14/11/2026')).toEqual({ y: 2026, m: 11, d: 14 });
    expect(leerFecha('4-1-2027')).toEqual({ y: 2027, m: 1, d: 4 });
    expect(leerFecha('14.11.26')).toEqual({ y: 2026, m: 11, d: 14 });
    expect(leerFecha('2026-11-14')).toEqual({ y: 2026, m: 11, d: 14 });
    expect(leerFecha(' 2026-11-14 18:30 ')).toEqual({ y: 2026, m: 11, d: 14 });
  });

  it('rechaza lo que no es una fecha', () => {
    expect(leerFecha('31/02/2026')).toBeNull();
    expect(leerFecha('mañana')).toBeNull();
    expect(leerFecha('')).toBeNull();
    expect(leerFecha(null)).toBeNull();
    expect(leerFecha(0)).toBeNull();
    expect(leerFecha(true)).toBeNull();
  });
});

describe('leerHora', () => {
  it('fracción de día de Excel', () => {
    expect(leerHora(0.5)).toBe(12 * 60);
    expect(leerHora(10 / 24 + 30 / 1440)).toBe(10 * 60 + 30);
    expect(leerHora(serie(2026, 11, 14) + 0.75)).toBe(18 * 60);
  });

  it('texto hh:mm y variantes', () => {
    expect(leerHora('9:05')).toBe(9 * 60 + 5);
    expect(leerHora('18:30')).toBe(18 * 60 + 30);
    expect(leerHora('18.30')).toBe(18 * 60 + 30);
    expect(leerHora('18h30')).toBe(18 * 60 + 30);
    expect(leerHora('18:30:00')).toBe(18 * 60 + 30);
  });

  it('rechaza horas imposibles', () => {
    expect(leerHora('25:00')).toBeNull();
    expect(leerHora('10:75')).toBeNull();
    expect(leerHora('tarde')).toBeNull();
    expect(leerHora(null)).toBeNull();
  });
});

describe('leerAvisos', () => {
  it('vacío = avisos por defecto (1 día y 1 hora)', () => {
    expect(leerAvisos('').avisos).toEqual(['1h', '1d']);
    expect(leerAvisos(undefined).avisos).toEqual(['1h', '1d']);
  });

  it('códigos y palabras, en orden de antelación, sin repetir', () => {
    expect(leerAvisos('1sem, 1d, 1h, 30min, hora').avisos).toEqual(['hora', '30min', '1h', '1d', '1sem']);
    expect(leerAvisos('1 día; 1 hora; 1d').avisos).toEqual(['1h', '1d']);
    expect(leerAvisos('A la hora').avisos).toEqual(['hora']);
    expect(leerAvisos('1 semana').avisos).toEqual(['1sem']);
  });

  it('señala lo que no entiende y sigue con el resto', () => {
    const r = leerAvisos('1d, pronto, 2 semanas');
    expect(r.avisos).toEqual(['1d']);
    expect(r.ignorados).toEqual(['pronto', '2 semanas']);
  });
});

describe('leerCarreras', () => {
  const cabecera: Celda[] = ['Nombre', 'Fecha', 'Hora', 'Lugar', 'Notas', 'Avisos'];

  it('lee carreras con fecha y hora de Excel y con texto', () => {
    const r = leerCarreras([
      cabecera,
      ['Regional ronda 1', serie(2026, 11, 14), 10 / 24, 'Circuit Nocturn', 'Llevar goma nueva', '1d, 1h'],
      ['Regional ronda 2', '05/12/2026', '9:30', '', '', ''],
    ], alias);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.errores).toEqual([]);
    expect(r.carreras).toHaveLength(2);
    const [a, b] = r.carreras;
    expect(a).toMatchObject({ fila: 2, nombre: 'Regional ronda 1', lugar: 'Circuit Nocturn', notas: 'Llevar goma nueva', avisos: ['1h', '1d'] });
    expect(a!.inicio).toEqual(new Date(2026, 10, 14, 10, 0));
    expect(b).toMatchObject({ fila: 3, nombre: 'Regional ronda 2', avisos: ['1h', '1d'] });
    expect(b!.lugar).toBeUndefined();
    expect(b!.inicio).toEqual(new Date(2026, 11, 5, 9, 30));
  });

  it('acepta las columnas en otro orden, con otros nombres y filas previas', () => {
    const r = leerCarreras([
      ['Calendario 2026', null, null],
      [],
      ['Date', 'Race', 'Time'],
      ['2026-11-14', 'Prueba', '18:00'],
    ], alias);
    expect(r.ok && r.carreras.map(c => [c.fila, c.nombre])).toEqual([[4, 'Prueba']]);
  });

  it('la hora puede ir dentro de la fecha (fecha y hora de Excel)', () => {
    const r = leerCarreras([['Nombre', 'Fecha'], ['Prueba', serie(2026, 11, 14) + 0.75]], alias);
    expect(r.ok && r.carreras[0]!.inicio).toEqual(new Date(2026, 10, 14, 18, 0));
  });

  it('salta las filas en blanco y señala las que fallan, con su número de fila', () => {
    const r = leerCarreras([
      cabecera,
      ['Buena', '14/11/2026', '10:00'],
      [],
      ['', '14/11/2026', '10:00'],
      ['Sin fecha', 'pronto', '10:00'],
      ['Sin hora', '14/11/2026', ''],
      ['Hora rara', '14/11/2026', '25:99'],
    ], alias);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.carreras.map(c => c.nombre)).toEqual(['Buena']);
    expect(r.errores).toEqual([
      { fila: 4, motivo: 'faltaNombre' },
      { fila: 5, motivo: 'fechaInvalida' },
      { fila: 6, motivo: 'horaInvalida' },
      { fila: 7, motivo: 'horaInvalida' },
    ]);
  });

  it('sin cabecera reconocible o sin filas, no importa nada', () => {
    expect(leerCarreras([['a', 'b'], ['c', 'd']], alias)).toEqual({ ok: false, motivo: 'sinCabecera' });
    expect(leerCarreras([], alias)).toEqual({ ok: false, motivo: 'sinCabecera' });
    expect(leerCarreras([cabecera, [], [null, null]], alias)).toEqual({ ok: false, motivo: 'sinFilas' });
  });

  it('usa los nombres de columna extra que se le pasen (p. ej. otro idioma)', () => {
    const r = leerCarreras(
      [['Rennen', 'Datum', 'Uhrzeit'], ['Test', '14/11/2026', '10:00']],
      aliasCon({ nombre: ['Rennen'], fecha: ['Datum'], hora: ['Uhrzeit'] }),
    );
    expect(r.ok && r.carreras).toHaveLength(1);
  });
});

describe('clave', () => {
  it('ignora mayúsculas, tildes y espacios del nombre', () => {
    const t = new Date(2026, 10, 14, 10, 0);
    expect(clave('  Regional   Ronda 1 ', t)).toBe(clave('regional ronda 1', t.toISOString()));
    expect(clave('Regional', t)).not.toBe(clave('Regional', new Date(2026, 10, 14, 11, 0)));
  });
});

describe('prepararImportacion', () => {
  const cab: Celda[] = ['Nombre', 'Fecha', 'Hora'];

  it('descarta lo que ya está en el calendario y lo repetido en el archivo', () => {
    const r = prepararImportacion(
      [[cab,
        ['Ronda 1', '14/11/2026', '10:00'],
        ['ronda 2', '15/11/2026', '10:00'],
        ['Ronda 2', '15/11/2026', '10:00'],
        ['Ronda 3', '16/11/2026', '10:00'],
        ['Mala', 'xx', '10:00']]],
      [{ nombre: 'Ronda 1', inicio: new Date(2026, 10, 14, 10, 0).toISOString() }],
      alias,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nuevas.map(c => c.nombre)).toEqual(['ronda 2', 'Ronda 3']);
    expect(r.repetidas).toBe(2);
    expect(r.errores).toEqual([{ fila: 6, motivo: 'fechaInvalida' }]);
  });

  it('busca la hoja buena entre varias', () => {
    const r = prepararImportacion(
      [[['Instrucciones'], ['Una carrera por fila']], [cab, ['Ronda 1', '14/11/2026', '10:00']]],
      [],
      alias,
    );
    expect(r.ok && r.nuevas).toHaveLength(1);
  });

  it('sin cabecera en ninguna hoja, o con la hoja buena vacía, da su motivo', () => {
    expect(prepararImportacion([[['a']], [['b']]], [], alias)).toEqual({ ok: false, motivo: 'sinCabecera' });
    expect(prepararImportacion([[['x']], [cab, []]], [], alias)).toEqual({ ok: false, motivo: 'sinFilas' });
    expect(prepararImportacion([], [], alias)).toEqual({ ok: false, motivo: 'sinCabecera' });
  });
});
