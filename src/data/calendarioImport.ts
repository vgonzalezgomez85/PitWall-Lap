// Importador del calendario desde una hoja de cálculo (Excel o CSV). Parte de
// las filas ya leídas (sin tipos de SheetJS) y devuelve las carreras válidas y
// los errores por fila. Lógica pura, sin React ni módulos nativos.

import { AVISOS, AVISOS_POR_DEFECTO, type AvisoId } from './calendario';

/** Una celda tal como sale de la hoja: texto, número (fecha/hora de Excel) o vacía. */
export type Celda = string | number | boolean | Date | null | undefined;

/** Columnas que entiende el importador. */
export type Columna = 'nombre' | 'fecha' | 'hora' | 'lugar' | 'notas' | 'avisos';

export interface CarreraImportada {
  /** Fila de la hoja (1 = cabecera), para señalar errores. */
  fila: number;
  nombre: string;
  lugar?: string;
  notas?: string;
  /** Fecha y hora locales, sin zona. */
  inicio: Date;
  avisos: AvisoId[];
  /** Avisos que no se reconocieron y se ignoraron. */
  avisosIgnorados: string[];
}

export type MotivoError = 'faltaNombre' | 'fechaInvalida' | 'horaInvalida';

export interface ErrorFila {
  fila: number;
  motivo: MotivoError;
}

export type ResultadoImportacion =
  | { ok: true; carreras: CarreraImportada[]; errores: ErrorFila[] }
  | { ok: false; motivo: 'sinCabecera' | 'sinFilas' };

/** Quita tildes, signos y espacios: «Fecha de inicio» → «fechadeinicio». */
export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Cómo puede llamarse cada columna (ya normalizado). Los nombres de la
 * plantilla en cada idioma de la app se añaden desde fuera (`extra`).
 */
const ALIAS_BASE: Record<Columna, string[]> = {
  nombre: ['nombre', 'carrera', 'evento', 'name', 'race', 'event', 'nom', 'course', 'gara', 'naam', 'izena'],
  fecha: ['fecha', 'dia', 'date', 'data', 'datum', 'dataprova', 'egun', 'jour'],
  hora: ['hora', 'horario', 'time', 'heure', 'ora', 'tijd', 'ordua', 'uur'],
  lugar: ['lugar', 'circuito', 'pista', 'place', 'location', 'venue', 'lloc', 'lieu', 'luogo', 'local', 'plaats', 'lekua'],
  notas: ['notas', 'observaciones', 'comentarios', 'notes', 'comments', 'oharrak', 'note', 'notities'],
  avisos: ['avisos', 'alertas', 'recordatorios', 'reminders', 'alerts', 'abisuak', 'rappels', 'promemoria', 'lembretes', 'herinneringen'],
};

export type Alias = Record<Columna, string[]>;

/** Alias base más los que aporte quien llama (p. ej. las cabeceras de cada idioma). */
export function aliasCon(extra: Partial<Record<Columna, string[]>> = {}): Alias {
  const out = {} as Alias;
  for (const c of Object.keys(ALIAS_BASE) as Columna[]) {
    out[c] = [...ALIAS_BASE[c], ...(extra[c] ?? []).map(normalizarTexto)];
  }
  return out;
}

// ── Fechas y horas ──────────────────────────────────────────────────────────

const MS_DIA = 86_400_000;
const EPOCA_EXCEL = Date.UTC(1899, 11, 30);   // día 0 de Excel (con el fallo del 1900 ya absorbido)

interface Dia { y: number; m: number; d: number }

function diaValido(y: number, m: number, d: number): Dia | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? { y, m, d } : null;
}

/** Fecha desde una celda: serie de Excel, Date o texto dd/mm/aaaa · aaaa-mm-dd. */
export function leerFecha(c: Celda): Dia | null {
  if (c instanceof Date) {
    return Number.isNaN(c.getTime()) ? null : diaValido(c.getFullYear(), c.getMonth() + 1, c.getDate());
  }
  if (typeof c === 'number') {
    if (!Number.isFinite(c) || c < 1) return null;
    const f = new Date(EPOCA_EXCEL + Math.floor(c) * MS_DIA);
    return diaValido(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return diaValido(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return diaValido(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** Minutos desde medianoche: fracción de día de Excel, Date o texto hh:mm. */
export function leerHora(c: Celda): number | null {
  if (c instanceof Date) {
    return Number.isNaN(c.getTime()) ? null : c.getHours() * 60 + c.getMinutes();
  }
  if (typeof c === 'number') {
    if (!Number.isFinite(c) || c < 0) return null;
    const frac = c - Math.floor(c);
    const min = Math.round(frac * 1440);
    return min >= 1440 ? 0 : min;
  }
  if (typeof c !== 'string') return null;
  const m = /^(\d{1,2})\s*[:.hH]\s*(\d{2})(?:\s*[:.]\s*\d{2})?\s*(h|hs|hrs)?$/.exec(c.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

// ── Avisos ──────────────────────────────────────────────────────────────────

const AVISO_POR_CODIGO: Record<string, AvisoId> = {
  hora: 'hora', '0': 'hora', ahora: 'hora', inicio: 'hora', alahora: 'hora', alainicio: 'hora', start: 'hora',
  '30min': '30min', '30m': '30min', '30minutos': '30min', '30minutes': '30min',
  '1h': '1h', '1hora': '1h', '60min': '1h', '1hour': '1h', '1hr': '1h',
  '1d': '1d', '1dia': '1d', '1day': '1d', '24h': '1d',
  '1sem': '1sem', '1semana': '1sem', '1w': '1sem', '1week': '1sem', '7d': '1sem', '7dias': '1sem',
};

/** Lista de avisos desde texto («1d, 1h»); vacío = los de por defecto. */
export function leerAvisos(c: Celda): { avisos: AvisoId[]; ignorados: string[] } {
  // Salen de menor a mayor antelación, como en el resto de la app.
  const orden = AVISOS.map(a => a.id);
  const porAntelacion = (l: AvisoId[]) => l.sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
  const texto = typeof c === 'string' ? c.trim() : typeof c === 'number' ? String(c) : '';
  if (!texto) return { avisos: porAntelacion([...AVISOS_POR_DEFECTO]), ignorados: [] };
  const avisos: AvisoId[] = [];
  const ignorados: string[] = [];
  for (const trozo of texto.split(/[,;/\n|]+/)) {
    const original = trozo.trim();
    if (!original) continue;
    const id = AVISO_POR_CODIGO[normalizarTexto(original)];
    if (id) {
      if (!avisos.includes(id)) avisos.push(id);
    } else {
      ignorados.push(original);
    }
  }
  return { avisos: porAntelacion(avisos), ignorados };
}

// ── Filas ───────────────────────────────────────────────────────────────────

const vacia = (c: Celda) => c == null || (typeof c === 'string' && c.trim() === '');
const texto = (c: Celda) => (vacia(c) ? '' : String(c).trim());

/**
 * Interpreta las filas de la hoja (la primera con cabecera: debe tener al menos
 * las columnas Nombre y Fecha). `alias` viene de `aliasCon`.
 */
export function leerCarreras(filas: Celda[][], alias: Alias): ResultadoImportacion {
  // Cabecera = primera fila donde se reconocen Nombre y Fecha.
  let cab = -1;
  let col: Partial<Record<Columna, number>> = {};
  for (let i = 0; i < filas.length && cab < 0; i++) {
    const encontrado: Partial<Record<Columna, number>> = {};
    (filas[i] ?? []).forEach((celda, j) => {
      const n = normalizarTexto(texto(celda));
      if (!n) return;
      for (const c of Object.keys(alias) as Columna[]) {
        if (encontrado[c] === undefined && alias[c].includes(n)) encontrado[c] = j;
      }
    });
    if (encontrado.nombre !== undefined && encontrado.fecha !== undefined) {
      cab = i;
      col = encontrado;
    }
  }
  if (cab < 0) return { ok: false, motivo: 'sinCabecera' };

  const carreras: CarreraImportada[] = [];
  const errores: ErrorFila[] = [];
  let hayFilas = false;

  for (let i = cab + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    const celda = (c: Columna): Celda => (col[c] === undefined ? undefined : f[col[c]!]);
    if (f.every(vacia)) continue;           // fila en blanco
    hayFilas = true;
    const fila = i + 1;

    const nombre = texto(celda('nombre'));
    if (!nombre) { errores.push({ fila, motivo: 'faltaNombre' }); continue; }

    const dia = leerFecha(celda('fecha'));
    if (!dia) { errores.push({ fila, motivo: 'fechaInvalida' }); continue; }

    // La hora puede ir en su columna o dentro de la fecha (fecha y hora de Excel).
    let minutos: number | null = null;
    if (!vacia(celda('hora'))) {
      minutos = leerHora(celda('hora'));
    } else {
      const f0 = celda('fecha');
      if (typeof f0 === 'number' && f0 % 1 !== 0) minutos = leerHora(f0);
      else if (f0 instanceof Date) minutos = leerHora(f0);
    }
    if (minutos == null) { errores.push({ fila, motivo: 'horaInvalida' }); continue; }

    const { avisos, ignorados } = leerAvisos(celda('avisos'));
    carreras.push({
      fila,
      nombre,
      lugar: texto(celda('lugar')) || undefined,
      notas: texto(celda('notas')) || undefined,
      inicio: new Date(dia.y, dia.m - 1, dia.d, Math.floor(minutos / 60), minutos % 60, 0, 0),
      avisos,
      avisosIgnorados: ignorados,
    });
  }

  if (!hayFilas) return { ok: false, motivo: 'sinFilas' };
  return { ok: true, carreras, errores };
}

/** Misma carrera: mismo nombre (sin mayúsculas ni espacios de más) y mismo instante. */
export function clave(nombre: string, inicio: Date | string): string {
  return `${normalizarTexto(nombre)}|${new Date(inicio).getTime()}`;
}

// ── Importación completa ────────────────────────────────────────────────────

export type PreparacionImportacion =
  | {
      ok: true;
      /** Carreras que se guardarían (no estaban ya en el calendario). */
      nuevas: CarreraImportada[];
      /** Filas que ya estaban en el calendario o repetidas en el propio archivo. */
      repetidas: number;
      errores: ErrorFila[];
    }
  | { ok: false; motivo: 'sinCabecera' | 'sinFilas' };

/**
 * Prepara la importación: toma la primera hoja que contenga carreras, descarta
 * las que ya estén en el calendario (mismo nombre y mismo instante) o repetidas
 * dentro del archivo, y deja el resto como nuevas.
 */
export function prepararImportacion(
  hojas: Celda[][][],
  existentes: { nombre: string; inicio: string }[],
  alias: Alias,
): PreparacionImportacion {
  let fallo: PreparacionImportacion = { ok: false, motivo: 'sinCabecera' };
  for (const hoja of hojas) {
    const r = leerCarreras(hoja, alias);
    if (!r.ok) {
      // «sin filas» pesa más que «sin cabecera»: la hoja era la buena pero estaba vacía.
      if (r.motivo === 'sinFilas') fallo = r;
      continue;
    }
    const vistas = new Set(existentes.map(e => clave(e.nombre, e.inicio)));
    const nuevas: CarreraImportada[] = [];
    let repetidas = 0;
    for (const c of r.carreras) {
      const k = clave(c.nombre, c.inicio);
      if (vistas.has(k)) { repetidas++; continue; }
      vistas.add(k);
      nuevas.push(c);
    }
    return { ok: true, nuevas, repetidas, errores: r.errores };
  }
  return fallo;
}
