// Descarga y cachea localmente el Excel comparativa de una carrera, para
// poder abrirlo sin conexión. Lo usan el auto-guardado (al capturar el
// dossier) y la pantalla de detalle (bajo demanda).

import { File, Paths } from 'expo-file-system';

import type { RaceStatsSnapshot } from './types';
import { updateSnapshot } from './historyStore';

/**
 * Devuelve la ruta local (file://) del Excel de esta carrera, descargándolo
 * del servidor si hace falta y guardando la ruta en el snapshot. Devuelve null
 * si no hay Excel disponible o el servidor no es accesible (best-effort).
 */
export async function ensureExcelLocal(snap: RaceStatsSnapshot): Promise<string | null> {
  // ¿Ya está descargado y el fichero sigue ahí?
  if (snap.excelLocalPath) {
    try {
      if (new File(snap.excelLocalPath).exists) return snap.excelLocalPath;
    } catch { /* ruta inválida → re-descargamos */ }
  }
  if (!snap.serverBaseUrl || !snap.excelPath) return null;
  try {
    const target = new File(Paths.document, `history-${snap.raceId}.xlsx`);
    try { if (target.exists) target.delete(); } catch { /* ignore */ }
    const url = `${snap.serverBaseUrl}${snap.excelPath}`;
    const file = await File.downloadFileAsync(url, target);
    await updateSnapshot(snap.raceId, { excelLocalPath: file.uri });
    return file.uri;
  } catch {
    return null;
  }
}
