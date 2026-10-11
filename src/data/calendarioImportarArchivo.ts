// Importar carreras al calendario desde un Excel y descargar la plantilla: la
// parte que toca el sistema de archivos, el selector de documentos, las
// notificaciones y el almacén. El análisis está en `calendarioImport.ts`.

import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { programarAvisos } from './avisos';
import { avisosPendientes, nuevoIdEvento, type AvisoId, type Evento } from './calendario';
import {
  aliasCon, prepararImportacion, type Alias, type CarreraImportada, type Columna,
  type PreparacionImportacion,
} from './calendarioImport';
import { listEventos, saveEvento } from './calendarioStore';
import { crearPlantilla, leerHojas, type TextosPlantilla } from './plantillaCalendario';
import { IDIOMAS } from '../i18n/idiomas';
import { textosDe } from '../i18n';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Las cabeceras de la plantilla en TODOS los idiomas: se importa un Excel de cualquiera. */
export function aliasTodosLosIdiomas(): Alias {
  const extra: Partial<Record<Columna, string[]>> = {};
  for (const { codigo } of IDIOMAS) {
    const cols = textosDe(codigo).calendarioImp.columnas;
    for (const c of Object.keys(cols) as Columna[]) (extra[c] ??= []).push(cols[c]);
  }
  return aliasCon(extra);
}

/** Genera la plantilla en el idioma de la app y abre el menú de compartir. */
export async function compartirPlantilla(
  txt: TextosPlantilla,
  titulo: string,
): Promise<'ok' | 'sinCompartir'> {
  const archivo = new File(Paths.cache, 'plantilla-calendario.xlsx');
  if (archivo.exists) archivo.delete();
  archivo.create();
  archivo.write(crearPlantilla(txt, new Date()));
  if (!(await Sharing.isAvailableAsync())) return 'sinCompartir';
  await Sharing.shareAsync(archivo.uri, {
    mimeType: MIME_XLSX,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
    dialogTitle: titulo,
  });
  return 'ok';
}

/**
 * Pide un Excel y lo analiza contra lo que ya hay en el calendario. null si el
 * usuario cancela el selector. Lanza si el archivo no es legible.
 */
export async function elegirYPreparar(): Promise<PreparacionImportacion | null> {
  const r = await DocumentPicker.getDocumentAsync({
    type: [MIME_XLSX, 'application/vnd.ms-excel', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  const f = r.canceled ? null : r.assets[0];
  if (!f) return null;
  const hojas = leerHojas(await new File(f.uri).bytes());
  return prepararImportacion(hojas, await listEventos(), aliasTodosLosIdiomas());
}

/**
 * Guarda las carreras nuevas con sus avisos. `sinPermiso` = había avisos que
 * programar y el sistema no dejó (la carrera se guarda igual).
 */
export async function guardarCarreras(
  carreras: CarreraImportada[],
  cuerpo: (aviso: AvisoId, lugar?: string) => string,
): Promise<{ guardadas: number; sinPermiso: boolean }> {
  let sinPermiso = false;
  for (const c of carreras) {
    const evento: Evento = {
      id: nuevoIdEvento(),
      nombre: c.nombre,
      lugar: c.lugar,
      notas: c.notas,
      inicio: c.inicio.toISOString(),
      avisos: c.avisos,
      notificaciones: [],
    };
    evento.notificaciones = await programarAvisos(evento, a => cuerpo(a, evento.lugar));
    if (evento.notificaciones.length === 0
        && avisosPendientes(evento.inicio, evento.avisos, new Date()).length > 0) {
      sinPermiso = true;
    }
    await saveEvento(evento);
  }
  return { guardadas: carreras.length, sinPermiso };
}
