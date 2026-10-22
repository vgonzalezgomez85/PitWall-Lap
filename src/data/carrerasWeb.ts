// Carreras públicas de pitwall.es (https://pitwall.es/carreras.html): lectura
// de los dos JSON que publica la web, mezcla igual que hace `carreras.js` y
// paso a evento del calendario. Lógica pura, sin React ni red.

import { AVISOS_POR_DEFECTO, type AvisoId } from './calendario';
import { clave, normalizarTexto } from './calendarioImport';

export const WEB_CARRERAS = 'https://www.pitwall.es/';
export const URL_MANUALES = `${WEB_CARRERAS}datos/carreras-manuales.json`;
export const URL_AUTO = `${WEB_CARRERAS}datos/carreras-auto.json`;
export const PAGINA_CARRERAS = `${WEB_CARRERAS}carreras.html`;

export type TipoCarrera = 'resistencia' | 'velocidad' | 'rally' | 'raid' | 'otro';
const TIPOS: TipoCarrera[] = ['resistencia', 'velocidad', 'rally', 'raid', 'otro'];

export interface CarreraWeb {
  id: string;
  fecha: string;              // AAAA-MM-DD
  fechaFin?: string;          // AAAA-MM-DD, si dura más de un día
  nombre: string;
  campeonato?: string;
  tipo?: TipoCarrera;
  club?: string;
  circuito?: string;
  ciudad?: string;
  pais?: string;              // ISO de 2 letras, en mayúsculas
  escala?: string;
  categoria?: string;
  enlace?: string;
  notas?: string;
  /** Añadida a mano en la web (true) o encontrada por la búsqueda automática (false). */
  verificada: boolean;
}

/** Hora a la que se apuntan (la web solo da el día); luego se puede cambiar. */
export const HORA_POR_DEFECTO = 9 * 60;

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Como `slug` de la web: minúsculas, sin tildes, guiones. */
function slug(s: string | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** «AAAA-MM-DD» como día local; null si no es una fecha real. */
export function parsearDia(s: string | undefined): Date | null {
  const m = FECHA.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

function leerCarrera(r: unknown, verificada: boolean): CarreraWeb | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const fecha = str(o.fecha);
  const nombre = str(o.nombre) ?? str(o.campeonato);
  if (!fecha || !parsearDia(fecha) || !nombre) return null;
  const fechaFin = str(o.fecha_fin);
  const tipo = str(o.tipo) as TipoCarrera | undefined;
  const enlace = str(o.enlace);
  const c: CarreraWeb = {
    id: '',
    fecha,
    fechaFin: fechaFin && parsearDia(fechaFin) && fechaFin > fecha ? fechaFin : undefined,
    nombre,
    campeonato: str(o.campeonato),
    tipo: tipo && TIPOS.includes(tipo) ? tipo : undefined,
    club: str(o.club),
    circuito: str(o.circuito),
    ciudad: str(o.ciudad),
    pais: /^[A-Za-z]{2}$/.test(str(o.pais) ?? '') ? str(o.pais)!.toUpperCase() : undefined,
    escala: str(o.escala),
    categoria: str(o.categoria),
    enlace: enlace && /^https?:\/\//i.test(enlace) ? enlace : undefined,
    notas: str(o.notas),
    verificada,
  };
  // Mismo id que calcula la web, para que coincidan las de los dos ficheros.
  c.id = str(o.id) ?? [slug(c.campeonato ?? c.nombre), c.fecha, slug(c.ciudad ?? c.club)]
    .filter(Boolean).join('-');
  return c;
}

function lista(json: unknown, campo: string): unknown[] {
  const v = json && typeof json === 'object' ? (json as Record<string, unknown>)[campo] : undefined;
  return Array.isArray(v) ? v : [];
}

/**
 * Mezcla las carreras manuales y las automáticas como la web: las manuales
 * ganan si comparten id; las automáticas listadas en `ocultar` o del mismo
 * campeonato y día que una manual se descartan. Ordenadas por fecha y nombre.
 */
export function mezclarCarreras(manuales: unknown, auto: unknown): CarreraWeb[] {
  const ocultas = new Set(lista(manuales, 'ocultar').filter((x): x is string => typeof x === 'string'));
  const man = lista(manuales, 'carreras').map(r => leerCarrera(r, true)).filter((c): c is CarreraWeb => !!c);
  const diaClave = (c: CarreraWeb) => `${slug(c.campeonato ?? c.nombre)}|${c.fecha}`;
  const diasMan = new Set(man.map(diaClave));
  const porId = new Map<string, CarreraWeb>();
  for (const r of lista(auto, 'carreras')) {
    const c = leerCarrera(r, false);
    if (c && !ocultas.has(c.id) && !diasMan.has(diaClave(c))) porId.set(c.id, c);
  }
  for (const c of man) porId.set(c.id, c);
  return [...porId.values()].sort((a, b) =>
    a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.nombre.localeCompare(b.nombre));
}

/** Las que no han terminado todavía (el día de fin cuenta entero). */
export function carrerasProximas(carreras: CarreraWeb[], ahora: Date): CarreraWeb[] {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return carreras.filter(c => parsearDia(c.fechaFin ?? c.fecha)!.getTime() >= hoy.getTime());
}

/** Búsqueda libre sin tildes ni mayúsculas; cada palabra debe aparecer en algún campo. */
export function filtrarCarreras(
  carreras: CarreraWeb[],
  texto: string,
  extra: (c: CarreraWeb) => string = () => '',
): CarreraWeb[] {
  const palabras = texto.split(/\s+/).map(normalizarTexto).filter(Boolean);
  if (palabras.length === 0) return carreras;
  return carreras.filter(c => {
    const pajar = normalizarTexto([
      c.nombre, c.campeonato, c.club, c.circuito, c.ciudad, c.pais, c.categoria, c.escala, c.tipo, extra(c),
    ].join(' '));
    return palabras.every(p => pajar.includes(p));
  });
}

// ── Filtros (los mismos desplegables que la web) ────────────────────────────

export interface FiltrosCarreras {
  pais?: string;
  tipo?: TipoCarrera;
  campeonato?: string;
}

/** Aplica país, tipo y campeonato; un filtro vacío no filtra. */
export function aplicarFiltros(carreras: CarreraWeb[], f: FiltrosCarreras): CarreraWeb[] {
  return carreras.filter(c =>
    (!f.pais || c.pais === f.pais)
    && (!f.tipo || c.tipo === f.tipo)
    && (!f.campeonato || c.campeonato === f.campeonato));
}

export interface OpcionesFiltros {
  paises: string[];
  tipos: TipoCarrera[];
  campeonatos: string[];
}

/**
 * Valores que aparecen en las carreras, como rellena la web sus desplegables:
 * países por nombre, tipos en su orden fijo, campeonatos alfabéticos.
 */
export function opcionesFiltros(
  carreras: CarreraWeb[],
  nombrePais: (codigo: string) => string = p => p,
): OpcionesFiltros {
  const paises = new Set<string>();
  const tipos = new Set<TipoCarrera>();
  const campeonatos = new Set<string>();
  for (const c of carreras) {
    if (c.pais) paises.add(c.pais);
    if (c.tipo) tipos.add(c.tipo);
    if (c.campeonato) campeonatos.add(c.campeonato);
  }
  return {
    paises: [...paises].sort((a, b) => nombrePais(a).localeCompare(nombrePais(b))),
    tipos: TIPOS.filter(t => tipos.has(t)),
    campeonatos: [...campeonatos].sort((a, b) => a.localeCompare(b)),
  };
}

/** Nombre del país en el idioma de la app; el código si el motor no trae `Intl.DisplayNames`. */
export function nombrePais(codigo: string, locale: string): string {
  try {
    const DisplayNames = (Intl as unknown as {
      DisplayNames?: new (l: string[], o: { type: 'region' }) => { of(c: string): string | undefined };
    }).DisplayNames;
    return (DisplayNames && new DisplayNames([locale], { type: 'region' }).of(codigo)) || codigo;
  } catch {
    return codigo;
  }
}

/** Bandera emoji desde el código ISO del país. */
export function bandera(pais: string | undefined): string {
  if (!pais || !/^[A-Z]{2}$/.test(pais)) return '';
  return String.fromCodePoint(...[...pais].map(ch => 127397 + ch.charCodeAt(0)));
}

/** «Circuito o club · ciudad · país». */
export function lugarDe(c: CarreraWeb): string | undefined {
  return [c.circuito ?? c.club, c.ciudad, c.pais].filter(Boolean).join(' · ') || undefined;
}

// ── Paso al calendario ──────────────────────────────────────────────────────

export interface TextosNotas {
  campeonato: string;
  categoria: string;
  hasta: (dia: string) => string;
  web: string;
}

/** Carrera lista para `guardarCarreras`. */
export interface CarreraNuevaWeb {
  nombre: string;
  lugar?: string;
  notas?: string;
  inicio: Date;
  avisos: AvisoId[];
  webId: string;
}

export function carreraAEvento(
  c: CarreraWeb,
  txt: TextosNotas,
  formatoDia: (d: Date) => string,
  minutos = HORA_POR_DEFECTO,
): CarreraNuevaWeb {
  const dia = parsearDia(c.fecha)!;
  const fin = c.fechaFin ? parsearDia(c.fechaFin) : null;
  const notas = [
    c.campeonato && c.campeonato !== c.nombre ? `${txt.campeonato}: ${c.campeonato}` : '',
    [c.categoria, c.escala].filter(Boolean).length
      ? `${txt.categoria}: ${[c.categoria, c.escala].filter(Boolean).join(' · ')}` : '',
    fin ? txt.hasta(formatoDia(fin)) : '',
    c.notas ?? '',
    c.enlace ? `${txt.web}: ${c.enlace}` : '',
  ].filter(Boolean).join('\n');
  return {
    nombre: c.nombre,
    lugar: lugarDe(c),
    notas: notas || undefined,
    inicio: new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(minutos / 60), minutos % 60),
    avisos: [...AVISOS_POR_DEFECTO],
    webId: c.id,
  };
}

/**
 * Ids de las carreras de la web que ya están en el calendario: por su `webId`
 * o, si se apuntó de otra forma, por mismo nombre y mismo instante.
 */
export function idsYaAnadidas(
  carreras: CarreraWeb[],
  existentes: { nombre: string; inicio: string; webId?: string }[],
): Set<string> {
  const porWeb = new Set(existentes.map(e => e.webId).filter(Boolean));
  const porClave = new Set(existentes.map(e => clave(e.nombre, e.inicio)));
  const out = new Set<string>();
  for (const c of carreras) {
    const dia = parsearDia(c.fecha)!;
    const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(),
      Math.floor(HORA_POR_DEFECTO / 60), HORA_POR_DEFECTO % 60);
    if (porWeb.has(c.id) || porClave.has(clave(c.nombre, inicio))) out.add(c.id);
  }
  return out;
}
