import {
  compararVersiones, debeComprobar, estaAtascada, hayVersionNueva, INTERVALO_COMPROBACION_MS, leerManifiesto,
  LIMITE_DESCARGA_MS, LIMITE_SIN_AVANCE_MS, porcentaje, urlDelApk,
} from './actualizacion';

describe('compararVersiones', () => {
  it('compara número a número, no como texto', () => {
    expect(compararVersiones('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compararVersiones('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compararVersiones('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compararVersiones('1.8.0', '1.8.0')).toBe(0);
  });

  it('tolera versiones incompletas o con sufijo', () => {
    expect(compararVersiones('1.8', '1.8.0')).toBe(0);
    expect(compararVersiones('1.8.1-beta', '1.8.0')).toBeGreaterThan(0);
  });
});

describe('leerManifiesto', () => {
  it('lee un manifiesto completo', () => {
    expect(leerManifiesto({ version: '1.9.0', apk: 'PitWallLap.apk', bytes: 76385971, notas: ' Calendario ' }))
      .toEqual({ version: '1.9.0', apk: 'PitWallLap.apk', bytes: 76385971, notas: 'Calendario' });
  });

  it('rellena lo que falte con valores razonables', () => {
    expect(leerManifiesto({ version: '1.9.0' }))
      .toEqual({ version: '1.9.0', apk: 'PitWallLap.apk', bytes: null, notas: null });
  });

  it('rechaza lo que no es un manifiesto', () => {
    expect(leerManifiesto(null)).toBeNull();
    expect(leerManifiesto({})).toBeNull();
    expect(leerManifiesto({ version: 'nueva' })).toBeNull();
    expect(leerManifiesto({ version: 190 })).toBeNull();
    expect(leerManifiesto('<html>404</html>')).toBeNull();
  });
});

describe('hayVersionNueva', () => {
  const m = (version: string) => leerManifiesto({ version });
  it('solo si la de la web es posterior a la instalada', () => {
    expect(hayVersionNueva('1.8.0', m('1.9.0'))).toBe(true);
    expect(hayVersionNueva('1.9.0', m('1.9.0'))).toBe(false);
    expect(hayVersionNueva('1.10.0', m('1.9.0'))).toBe(false);
    expect(hayVersionNueva('1.8.0', null)).toBe(false);
  });
});

describe('urlDelApk', () => {
  const carpeta = 'https://www.pitwall.es/software/pitwall-lap/';
  it('cuelga la ruta relativa de la carpeta del manifiesto y añade la versión', () => {
    expect(urlDelApk(carpeta, leerManifiesto({ version: '1.9.0', apk: 'PitWallLap.apk' })!))
      .toBe('https://www.pitwall.es/software/pitwall-lap/PitWallLap.apk?v=1.9.0');
  });

  it('respeta una URL absoluta', () => {
    expect(urlDelApk(carpeta, leerManifiesto({ version: '1.9.0', apk: 'https://otro.es/a.apk' })!))
      .toBe('https://otro.es/a.apk');
  });
});

describe('debeComprobar', () => {
  const h = 60 * 60 * 1000;
  it('la primera vez, siempre', () => {
    expect(debeComprobar(null, 1_000_000)).toBe(true);
  });

  it('no antes de 6 horas; a partir de ahí, sí', () => {
    const t0 = 1_000_000_000;
    expect(INTERVALO_COMPROBACION_MS).toBe(6 * h);
    expect(debeComprobar(t0, t0 + 5 * h)).toBe(false);
    expect(debeComprobar(t0, t0 + 6 * h)).toBe(true);
    expect(debeComprobar(t0, t0 + 30 * h)).toBe(true);
  });

  it('si el reloj del móvil retrocedió, comprueba', () => {
    expect(debeComprobar(2_000_000, 1_000_000)).toBe(true);
  });
});

describe('descarga: atasco y porcentaje', () => {
  it('se da por atascada tras 30 s sin avances, no antes', () => {
    expect(LIMITE_SIN_AVANCE_MS).toBe(30_000);
    expect(LIMITE_DESCARGA_MS).toBe(600_000);
    expect(estaAtascada(1_000, 1_000 + 29_999)).toBe(false);
    expect(estaAtascada(1_000, 1_000 + 30_000)).toBe(true);
  });

  it('porcentaje entero, tope en 100 y null si no hay tamaño', () => {
    expect(porcentaje(0, 1000)).toBe(0);
    expect(porcentaje(425, 1000)).toBe(42);
    expect(porcentaje(1000, 1000)).toBe(100);
    expect(porcentaje(1200, 1000)).toBe(100);
    expect(porcentaje(500, -1)).toBeNull();
    expect(porcentaje(500, 0)).toBeNull();
  });
});
