import { aliasCon, leerCarreras } from './calendarioImport';
import { crearPlantilla, leerHojas, type TextosPlantilla } from './plantillaCalendario';

const txt: TextosPlantilla = {
  columnas: { nombre: 'Nombre', fecha: 'Fecha', hora: 'Hora', lugar: 'Lugar', notas: 'Notas', avisos: 'Avisos' },
  hojaCarreras: 'Carreras',
  hojaAyuda: 'Instrucciones',
  ayuda: ['Una carrera por fila.', 'Avisos: hora, 30min, 1h, 1d, 1sem.'],
  ejemplos: [
    { nombre: 'Ejemplo: regional, ronda 1', lugar: 'Circuit Nocturn', notas: 'Llevar goma nueva' },
    { nombre: 'Ejemplo: regional, ronda 2', lugar: '', notas: '' },
  ],
};

describe('plantilla del calendario', () => {
  const hoy = new Date(2026, 9, 11);   // 11-oct-2026
  const hojas = leerHojas(crearPlantilla(txt, hoy));

  it('lleva la hoja de carreras y la de instrucciones', () => {
    expect(hojas).toHaveLength(2);
    expect(hojas[0]![0]).toEqual(['Nombre', 'Fecha', 'Hora', 'Lugar', 'Notas', 'Avisos']);
    expect(hojas[1]!.map(f => f[0])).toEqual(txt.ayuda);
  });

  it('el importador lee sus propios ejemplos, con fecha y hora correctas', () => {
    const r = leerCarreras(hojas[0]!, aliasCon());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.errores).toEqual([]);
    expect(r.carreras.map(c => c.nombre)).toEqual(['Ejemplo: regional, ronda 1', 'Ejemplo: regional, ronda 2']);
    expect(r.carreras[0]!.inicio).toEqual(new Date(2026, 9, 25, 10, 0));
    expect(r.carreras[1]!.inicio).toEqual(new Date(2026, 10, 8, 16, 30));
    expect(r.carreras[0]).toMatchObject({ lugar: 'Circuit Nocturn', notas: 'Llevar goma nueva', avisos: ['1h', '1d'] });
    expect(r.carreras[1]!.avisos).toEqual(['1h', '1d', '1sem']);
    expect(r.carreras[1]!.lugar).toBeUndefined();
  });

  it('la hoja de instrucciones no se toma por una hoja de carreras', () => {
    expect(leerCarreras(hojas[1]!, aliasCon())).toEqual({ ok: false, motivo: 'sinCabecera' });
  });
});
