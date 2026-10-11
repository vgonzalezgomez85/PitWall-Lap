// Aviso de versión nueva en Android: pregunta a la web si hay una versión
// posterior a la instalada y, si el usuario quiere, descarga el APK y abre el
// instalador del sistema. En iPhone no se usa: ahí actualiza TestFlight.

import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';

import {
  hayVersionNueva, leerManifiesto, urlDelApk, type ManifiestoVersion,
} from './actualizacion';

/** Carpeta de la web donde están el APK y su `version.json`. */
export const CARPETA_WEB = 'https://www.pitwall.es/software/pitwall-lap/';
const ESPERA_MS = 6000;
/** Un APK de la app pesa decenas de MB; menos de esto es una descarga rota o una página de error. */
const BYTES_MINIMOS = 5_000_000;

export interface Actualizacion {
  version: string;
  notas: string | null;
  url: string;
  bytes: number | null;
}

/** Devuelve la versión nueva si la hay; null si no, o si no hay red / la web no responde. */
export async function buscarActualizacion(actual: string): Promise<Actualizacion | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    const res = await fetch(`${CARPETA_WEB}version.json?t=${Date.now()}`, {
      signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const m: ManifiestoVersion | null = leerManifiesto(await res.json());
    if (!hayVersionNueva(actual, m)) return null;
    return { version: m!.version, notas: m!.notas, url: urlDelApk(CARPETA_WEB, m!), bytes: m!.bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Descarga el APK y abre el instalador de Android. La primera vez Android pide
 * permitir a la app «instalar apps desconocidas»; tras concederlo, hay que
 * volver a pulsar Actualizar. Lanza si la descarga falla o llega incompleta.
 */
export async function descargarEInstalar(a: Actualizacion): Promise<void> {
  const destino = new File(Paths.cache, 'PitWallLap-actualizacion.apk');
  const fichero = await File.downloadFileAsync(a.url, destino, { idempotent: true });
  const tam = fichero.size ?? 0;
  if (tam < BYTES_MINIMOS || (a.bytes != null && tam !== a.bytes)) {
    throw new Error('apk-incompleto');
  }
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: fichero.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1,   // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch {
    // Sin instalador directo: que lo abra el navegador, que sí sabe descargar e instalar.
    await Linking.openURL(a.url);
  }
}
