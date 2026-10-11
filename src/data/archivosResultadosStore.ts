// Almacén local de los archivos de resultados subidos a mano (Excel, PDF o
// foto). El fichero se copia al directorio de documentos de la app, así que
// sigue disponible aunque el original se borre; el índice va en AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import {
  extension, nuevoIdArchivo, tipoDeArchivo, tituloDeFichero, type ArchivoResultado,
} from './archivosResultados';

const KEY = '@pitwall/resultados-archivos/v1';

function directorio(): Directory {
  const dir = new Directory(Paths.document, 'resultados');
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}

export function ficheroDe(archivo: ArchivoResultado): File {
  return new File(directorio(), archivo.fichero);
}

export async function listArchivos(): Promise<ArchivoResultado[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const lista: ArchivoResultado[] = raw ? JSON.parse(raw) : [];
    return lista.sort((a, b) => b.anadidoEn.localeCompare(a.anadidoEn));
  } catch {
    return [];
  }
}

export async function getArchivo(id: string): Promise<ArchivoResultado | null> {
  return (await listArchivos()).find(a => a.id === id) ?? null;
}

async function guardarLista(lista: ArchivoResultado[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(lista));
}

/**
 * Copia el archivo elegido a la app y lo da de alta. `nombre` es el nombre
 * original del fichero y `mime` el tipo que informó el selector, si lo hay.
 */
export async function anadirArchivo(
  uriOrigen: string,
  nombre: string,
  mime?: string | null,
): Promise<ArchivoResultado> {
  const id = nuevoIdArchivo();
  const ext = extension(nombre);
  const fichero = ext ? `${id}.${ext}` : id;
  new File(uriOrigen).copy(new File(directorio(), fichero));
  const archivo: ArchivoResultado = {
    id,
    nombre: tituloDeFichero(nombre),
    tipo: tipoDeArchivo(nombre, mime),
    fichero,
    anadidoEn: new Date().toISOString(),
  };
  await guardarLista([...(await listArchivos()), archivo]);
  return archivo;
}

export async function renombrarArchivo(id: string, nombre: string): Promise<void> {
  const lista = await listArchivos();
  await guardarLista(lista.map(a => (a.id === id ? { ...a, nombre } : a)));
}

export async function borrarArchivo(id: string): Promise<void> {
  const lista = await listArchivos();
  const archivo = lista.find(a => a.id === id);
  if (archivo) {
    try {
      const f = ficheroDe(archivo);
      if (f.exists) f.delete();
    } catch { /* el fichero ya no está: seguimos con el índice */ }
  }
  await guardarLista(lista.filter(a => a.id !== id));
}
