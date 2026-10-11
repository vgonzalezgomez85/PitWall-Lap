// Aviso de versión nueva en Android: pregunta a la web si hay una versión
// posterior a la instalada y, si el usuario quiere, descarga el APK y abre el
// instalador del sistema. En iPhone no se usa: ahí actualiza TestFlight.

import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';

import {
  estaAtascada, hayVersionNueva, leerManifiesto, LIMITE_DESCARGA_MS, porcentaje, urlDelApk,
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

export type ResultadoBusqueda =
  | { estado: 'nueva'; actualizacion: Actualizacion }
  | { estado: 'alDia' }
  /** Sin red, la web no respondió a tiempo o lo recibido no era el manifiesto. */
  | { estado: 'error' };

/** Pregunta a la web (con un límite de 6 s para toda la petición). Nunca lanza. */
export async function comprobarActualizacion(actual: string): Promise<ResultadoBusqueda> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    const res = await fetch(`${CARPETA_WEB}version.json?t=${Date.now()}`, {
      signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { estado: 'error' };
    const m = leerManifiesto(await res.json());
    if (!m) return { estado: 'error' };
    if (!hayVersionNueva(actual, m)) return { estado: 'alDia' };
    return {
      estado: 'nueva',
      actualizacion: { version: m.version, notas: m.notas, url: urlDelApk(CARPETA_WEB, m), bytes: m.bytes },
    };
  } catch {
    return { estado: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

export interface Descarga {
  /** Termina cuando el instalador está abierto. Rechaza con `cancelada`, `atascada` o `apk-incompleto`. */
  promesa: Promise<void>;
  cancelar: () => void;
}

/**
 * Descarga el APK y abre el instalador de Android. La primera vez Android pide
 * permitir a la app «instalar apps desconocidas»; tras concederlo, hay que
 * volver a pulsar Actualizar. Se puede cancelar, y se corta sola si pasan 30 s
 * sin recibir nada o 10 min en total. `alProgreso` recibe 0–100 (null si no se
 * conoce el tamaño).
 */
export function iniciarDescarga(a: Actualizacion, alProgreso: (pct: number | null) => void): Descarga {
  const ruta = `${FileSystemLegacy.cacheDirectory ?? ''}PitWallLap-actualizacion.apk`;
  const inicio = Date.now();
  let ultimoAvance = inicio;
  let motivo: 'cancelada' | 'atascada' | null = null;

  const tarea = FileSystemLegacy.createDownloadResumable(a.url, ruta, {}, p => {
    ultimoAvance = Date.now();
    alProgreso(porcentaje(p.totalBytesWritten, p.totalBytesExpectedToWrite));
  });

  const vigilante = setInterval(() => {
    const ahora = Date.now();
    if (motivo == null && (estaAtascada(ultimoAvance, ahora) || ahora - inicio > LIMITE_DESCARGA_MS)) {
      motivo = 'atascada';
      void tarea.cancelAsync();
    }
  }, 5000);

  const promesa = (async () => {
    try {
      await FileSystemLegacy.deleteAsync(ruta, { idempotent: true });
      const r = await tarea.downloadAsync();
      if (!r) throw new Error(motivo ?? 'cancelada');
      const fichero = new File(r.uri);
      const tam = fichero.size ?? 0;
      if (tam < BYTES_MINIMOS || (a.bytes != null && tam !== a.bytes)) throw new Error('apk-incompleto');
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
    } catch (e) {
      // Si la descarga se cortó por red, el error llega sin motivo: se sigue tratando como fallo.
      if (motivo === 'atascada') throw new Error('atascada');
      if (motivo === 'cancelada') throw new Error('cancelada');
      throw e;
    } finally {
      clearInterval(vigilante);
    }
  })();

  return { promesa, cancelar: () => { motivo = 'cancelada'; void tarea.cancelAsync(); } };
}
