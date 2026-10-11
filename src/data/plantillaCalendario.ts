// Plantilla Excel del calendario y lectura de libros de Excel. Es la única
// parte del importador que depende de SheetJS; el análisis de las filas está
// en `calendarioImport.ts`.

import * as XLSX from 'xlsx';

import type { Celda, Columna } from './calendarioImport';

/** Textos de la plantilla, en el idioma de la app. */
export interface TextosPlantilla {
  columnas: Record<Columna, string>;
  hojaCarreras: string;
  hojaAyuda: string;
  ayuda: string[];
  /** Dos filas de ejemplo. */
  ejemplos: { nombre: string; lugar?: string; notas?: string }[];
}

const ORDEN: Columna[] = ['nombre', 'fecha', 'hora', 'lugar', 'notas', 'avisos'];

/** Serie de Excel de una fecha local (días desde 1899-12-30). */
function serieDeFecha(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/**
 * Libro .xlsx con la hoja de carreras (cabecera y dos ejemplos con fechas
 * futuras) y una hoja de instrucciones. `desde` fija las fechas de los ejemplos.
 */
export function crearPlantilla(txt: TextosPlantilla, desde: Date): Uint8Array {
  const dia = (n: number) => { const d = new Date(desde); d.setDate(d.getDate() + n); return serieDeFecha(d); };
  const hora = (h: number, m: number) => (h * 60 + m) / 1440;

  const e = txt.ejemplos;
  const filas: Celda[][] = [
    ORDEN.map(c => txt.columnas[c]),
    [e[0]?.nombre ?? '', dia(14), hora(10, 0), e[0]?.lugar ?? '', e[0]?.notas ?? '', '1d, 1h'],
    [e[1]?.nombre ?? '', dia(28), hora(16, 30), e[1]?.lugar ?? '', e[1]?.notas ?? '', '1sem, 1d, 1h'],
  ];
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  // Fecha y hora como números de Excel con su formato, para que se vean bien al abrirlas.
  for (const r of [2, 3]) {
    const f = hoja[`B${r}`]; if (f) f.z = 'dd/mm/yyyy';
    const h = hoja[`C${r}`]; if (h) h.z = 'hh:mm';
  }
  hoja['!cols'] = [{ wch: 36 }, { wch: 13 }, { wch: 8 }, { wch: 26 }, { wch: 32 }, { wch: 18 }];

  const ayuda = XLSX.utils.aoa_to_sheet(txt.ayuda.map(l => [l]));
  ayuda['!cols'] = [{ wch: 110 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, txt.hojaCarreras);
  XLSX.utils.book_append_sheet(libro, ayuda, txt.hojaAyuda);
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }));
}

/** Filas de todas las hojas de un libro (Excel .xlsx/.xls), con fechas y horas como números. */
export function leerHojas(bytes: Uint8Array): Celda[][][] {
  const libro = XLSX.read(bytes, { type: 'array', cellDates: false });
  return libro.SheetNames.map(nombre => {
    const hoja = libro.Sheets[nombre];
    if (!hoja) return [];
    return XLSX.utils.sheet_to_json<Celda[]>(hoja, { header: 1, raw: true, defval: null, blankrows: true });
  });
}
