// Aviso de versión nueva (solo Android): lógica pura, sin React ni módulos
// nativos. La web publica `version.json` junto al APK; la app lo compara con su
// propia versión.

/** Lo que publica la web en `/software/pitwall-lap/version.json`. */
export interface ManifiestoVersion {
  version: string;
  /** Ruta o URL del APK; si es relativa, cuelga de la carpeta del manifiesto. */
  apk: string;
  /** Tamaño esperado del APK, para detectar una descarga cortada. */
  bytes: number | null;
  /** Qué trae, en una línea (opcional). */
  notas: string | null;
}

/** Compara dos versiones x.y.z: <0 si a es anterior, 0 si iguales, >0 si a es posterior. */
export function compararVersiones(a: string, b: string): number {
  const num = (v: string) => v.split(/[.+-]/).slice(0, 3).map(p => parseInt(p, 10) || 0);
  const pa = num(a);
  const pb = num(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Valida lo que llega de la web; null si no tiene la forma esperada. */
export function leerManifiesto(raw: unknown): ManifiestoVersion | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.version !== 'string' || !/^\d+\.\d+\.\d+/.test(o.version)) return null;
  const apk = typeof o.apk === 'string' && o.apk.trim() ? o.apk.trim() : 'PitWallLap.apk';
  return {
    version: o.version,
    apk,
    bytes: typeof o.bytes === 'number' && o.bytes > 0 ? o.bytes : null,
    notas: typeof o.notas === 'string' && o.notas.trim() ? o.notas.trim() : null,
  };
}

/** ¿Hay una versión posterior a la instalada? */
export function hayVersionNueva(actual: string, manifiesto: ManifiestoVersion | null): boolean {
  return manifiesto != null && compararVersiones(manifiesto.version, actual) > 0;
}

/** URL absoluta del APK a partir de la carpeta donde está el manifiesto. */
export function urlDelApk(carpeta: string, manifiesto: ManifiestoVersion): string {
  if (/^https?:\/\//i.test(manifiesto.apk)) return manifiesto.apk;
  const base = carpeta.replace(/\/+$/, '');
  return `${base}/${manifiesto.apk.replace(/^\/+/, '')}?v=${encodeURIComponent(manifiesto.version)}`;
}
