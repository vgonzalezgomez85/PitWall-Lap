import {
  aplicarFiltros, bandera, carreraAEvento, carrerasProximas, filtrarCarreras, idsYaAnadidas, lugarDe,
  mezclarCarreras, nombrePais, opcionesFiltros,
} from './carrerasWeb';

const manuales = {
  ocultar: ['inventada-2026-11-01'],
  carreras: [
    {
      fecha: '2026-10-23', fecha_fin: '2026-10-25', nombre: 'Resiscat 4h HY · Conferencia Centre',
      campeonato: 'Resiscat', club: 'Slot Súria', ciudad: 'Súria', pais: 'es', escala: '1/32',
      categoria: 'Hypercar (HY)', enlace: 'https://club.criccrac.com/r.pdf', notas: 'Prueba 13', tipo: 'resistencia',
    },
    { fecha: '2026-11-14', nombre: 'Mismo id que la IA', campeonato: 'Copa', ciudad: 'Vic' },
    { nombre: 'Sin fecha' },
  ],
};

const auto = {
  generado: '2026-10-11T22:00:41+00:00',
  carreras: [
    { fecha: '2026-09-11', fecha_fin: '2026-09-13', nombre: 'Eurosarja 3', pais: 'FI', id: 'eurosarja-2026-09-11' },
    { fecha: '2026-11-01', nombre: 'Inventada', id: 'inventada-2026-11-01' },
    { fecha: '2026-10-23', nombre: 'Resiscat duplicada por la IA', campeonato: 'Resiscat' },
    { fecha: '2026-11-14', nombre: 'Versión de la IA', campeonato: 'Copa', ciudad: 'Vic' },
    { fecha: '2026-12-05', nombre: 'GP Navidad', tipo: 'velocidad', enlace: 'javascript:alert(1)' },
    { fecha: '2026-02-30', nombre: 'Fecha imposible' },
  ],
};

describe('mezclarCarreras', () => {
  const todas = mezclarCarreras(manuales, auto);

  test('aplica las reglas de la web y ordena por fecha', () => {
    expect(todas.map(c => c.nombre)).toEqual([
      'Eurosarja 3',
      'Resiscat 4h HY · Conferencia Centre',
      'Mismo id que la IA',
      'GP Navidad',
    ]);
  });

  test('marca el origen y normaliza campos', () => {
    const r = todas[1]!;
    expect(r.verificada).toBe(true);
    expect(r.pais).toBe('ES');
    expect(r.fechaFin).toBe('2026-10-25');
    expect(r.id).toBe('resiscat-2026-10-23-suria');
    expect(todas[0]!.verificada).toBe(false);
    expect(todas[3]!.enlace).toBeUndefined();
  });

  test('aguanta ficheros que faltan o vienen rotos', () => {
    expect(mezclarCarreras(null, { carreras: 'x' })).toEqual([]);
    expect(mezclarCarreras(undefined, auto).length).toBeGreaterThan(0);
  });
});

test('carrerasProximas: el último día de una carrera de varios días aún cuenta', () => {
  const todas = mezclarCarreras(manuales, auto);
  const nombres = (d: Date) => carrerasProximas(todas, d).map(c => c.nombre);
  expect(nombres(new Date(2026, 9, 25, 20, 0))).toContain('Resiscat 4h HY · Conferencia Centre');
  expect(nombres(new Date(2026, 9, 26, 0, 1))).not.toContain('Resiscat 4h HY · Conferencia Centre');
  expect(nombres(new Date(2026, 9, 12))).not.toContain('Eurosarja 3');
});

test('filtrarCarreras: varias palabras, sin tildes ni mayúsculas', () => {
  const todas = mezclarCarreras(manuales, auto);
  expect(filtrarCarreras(todas, 'suria HYPERCAR').map(c => c.nombre)).toEqual(['Resiscat 4h HY · Conferencia Centre']);
  expect(filtrarCarreras(todas, 'sprint', c => (c.tipo === 'velocidad' ? 'Sprint' : '')).map(c => c.nombre))
    .toEqual(['GP Navidad']);
  expect(filtrarCarreras(todas, '  ')).toHaveLength(todas.length);
});

test('opcionesFiltros: solo lo que aparece, tipos en orden fijo y países por nombre', () => {
  const todas = mezclarCarreras(manuales, auto);
  const nombres: Record<string, string> = { ES: 'España', FI: 'Finlandia' };
  expect(opcionesFiltros(todas, p => nombres[p] ?? p)).toEqual({
    paises: ['ES', 'FI'],
    tipos: ['resistencia', 'velocidad'],
    campeonatos: ['Copa', 'Resiscat'],
  });
  // Ordena por el nombre, no por el código.
  expect(opcionesFiltros(todas, p => (p === 'ES' ? 'Zz' : 'Aa')).paises).toEqual(['FI', 'ES']);
});

test('aplicarFiltros: combina país, tipo y campeonato; vacío no filtra', () => {
  const todas = mezclarCarreras(manuales, auto);
  expect(aplicarFiltros(todas, {})).toHaveLength(todas.length);
  expect(aplicarFiltros(todas, { pais: 'ES' }).map(c => c.nombre)).toEqual(['Resiscat 4h HY · Conferencia Centre']);
  expect(aplicarFiltros(todas, { tipo: 'velocidad' }).map(c => c.nombre)).toEqual(['GP Navidad']);
  expect(aplicarFiltros(todas, { campeonato: 'Copa' }).map(c => c.nombre)).toEqual(['Mismo id que la IA']);
  expect(aplicarFiltros(todas, { pais: 'ES', tipo: 'velocidad' })).toEqual([]);
});

test('nombrePais: nunca falla, como mucho devuelve el código', () => {
  expect(nombrePais('ES', 'es')).toMatch(/^(España|ES)$/);
  expect(nombrePais('ES', 'no-es-un-locale!!')).toBeTruthy();
});

test('carreraAEvento: 9:00 del primer día, lugar, notas y webId', () => {
  const c = mezclarCarreras(manuales, auto)[1]!;
  const ev = carreraAEvento(
    c,
    { campeonato: 'Campeonato', categoria: 'Categoría', hasta: d => `Hasta el ${d}`, web: 'Web' },
    d => `${d.getDate()}/${d.getMonth() + 1}`,
  );
  expect(ev.inicio).toEqual(new Date(2026, 9, 23, 9, 0));
  expect(ev.lugar).toBe('Slot Súria · Súria · ES');
  expect(ev.webId).toBe(c.id);
  expect(ev.avisos).toEqual(['1d', '1h']);
  expect(ev.notas).toBe([
    'Campeonato: Resiscat',
    'Categoría: Hypercar (HY) · 1/32',
    'Hasta el 25/10',
    'Prueba 13',
    'Web: https://club.criccrac.com/r.pdf',
  ].join('\n'));
});

test('idsYaAnadidas: por webId o por mismo nombre a la misma hora', () => {
  const todas = mezclarCarreras(manuales, auto);
  const ya = idsYaAnadidas(todas, [
    { nombre: 'x', inicio: new Date().toISOString(), webId: 'eurosarja-2026-09-11' },
    { nombre: 'gp  navidad', inicio: new Date(2026, 11, 5, 9, 0).toISOString() },
    { nombre: 'Mismo id que la IA', inicio: new Date(2026, 10, 14, 18, 0).toISOString() },
  ]);
  expect([...ya].sort()).toEqual(['eurosarja-2026-09-11', todas[3]!.id].sort());
});

test('bandera y lugar', () => {
  expect(bandera('ES')).toBe('🇪🇸');
  expect(bandera(undefined)).toBe('');
  expect(lugarDe({ id: 'a', fecha: '2026-01-01', nombre: 'n', verificada: true })).toBeUndefined();
});
