// Tipos y utilidades puras de los archivos de resultados que sube el piloto a
// mano (Excel, PDF o foto). Sin módulos nativos, para poder testearlas.

export type TipoArchivo = 'excel' | 'pdf' | 'imagen' | 'otro';

export interface ArchivoResultado {
  id: string;
  nombre: string;          // título que ve el piloto (editable)
  tipo: TipoArchivo;
  fichero: string;         // nombre del fichero en el directorio de la app
  anadidoEn: string;       // ISO
}

const EXT_EXCEL = ['xlsx', 'xls', 'xlsm', 'csv'];
const EXT_IMAGEN = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'];

export function extension(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  return i < 0 ? '' : nombre.slice(i + 1).toLowerCase();
}

/** Clasifica un archivo por su MIME y, si no es fiable, por su extensión. */
export function tipoDeArchivo(nombre: string, mime?: string | null): TipoArchivo {
  const ext = extension(nombre);
  const m = (mime ?? '').toLowerCase();
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('image/') || EXT_IMAGEN.includes(ext)) return 'imagen';
  if (m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv' || EXT_EXCEL.includes(ext)) {
    return 'excel';
  }
  return 'otro';
}

/** Título por defecto: el nombre del fichero sin extensión. */
export function tituloDeFichero(nombre: string): string {
  const ext = extension(nombre);
  const base = ext ? nombre.slice(0, nombre.length - ext.length - 1) : nombre;
  return base.trim() || nombre;
}

export function nuevoIdArchivo(): string {
  return `ar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
