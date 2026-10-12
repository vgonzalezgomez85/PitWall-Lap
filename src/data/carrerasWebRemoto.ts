// Descarga de las carreras de pitwall.es. La mezcla y el paso al calendario
// están en `carrerasWeb.ts`.

import { mezclarCarreras, URL_AUTO, URL_MANUALES, type CarreraWeb } from './carrerasWeb';

const ESPERA_MS = 10_000;

async function bajarJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { signal, headers: { 'Cache-Control': 'no-cache' } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Todas las carreras publicadas (pasadas incluidas). null si no llega ninguno de los dos ficheros. */
export async function descargarCarrerasWeb(): Promise<CarreraWeb[] | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    const [man, auto] = await Promise.all([bajarJson(URL_MANUALES, ctl.signal), bajarJson(URL_AUTO, ctl.signal)]);
    if (man == null && auto == null) return null;
    return mezclarCarreras(man, auto);
  } finally {
    clearTimeout(timer);
  }
}
