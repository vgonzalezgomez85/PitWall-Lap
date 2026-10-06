// Idiomas de la app. Lógica pura (sin React ni módulos nativos) para poder
// testearla: qué idiomas hay, cómo se elige el del sistema y qué locale de
// fechas y de voz (TTS) corresponde a cada uno.

export type Idioma = 'es' | 'ca' | 'eu' | 'en' | 'it' | 'fr' | 'pt' | 'nl';

/** Preferencia guardada: un idioma concreto o seguir el del sistema. */
export type PreferenciaIdioma = Idioma | 'auto';

/** Idioma si el del móvil no es ninguno de los soportados (p. ej. alemán). */
export const IDIOMA_POR_DEFECTO: Idioma = 'en';

/** Orden del selector; cada idioma con su nombre en ese mismo idioma. */
export const IDIOMAS: { codigo: Idioma; nombre: string }[] = [
  { codigo: 'es', nombre: 'Español' },
  { codigo: 'ca', nombre: 'Català' },
  { codigo: 'eu', nombre: 'Euskara' },
  { codigo: 'en', nombre: 'English' },
  { codigo: 'it', nombre: 'Italiano' },
  { codigo: 'fr', nombre: 'Français' },
  { codigo: 'pt', nombre: 'Português' },
  { codigo: 'nl', nombre: 'Nederlands' },
];

export function esIdioma(v: unknown): v is Idioma {
  return typeof v === 'string' && IDIOMAS.some(i => i.codigo === v);
}

export function nombreIdioma(idioma: Idioma): string {
  return IDIOMAS.find(i => i.codigo === idioma)?.nombre ?? idioma;
}

/**
 * Primer idioma soportado de la lista de idiomas del sistema (en orden de
 * preferencia, como los da expo-localization: "ca-ES", "en", "pt_BR"...).
 * Si ninguno está soportado, inglés.
 */
export function idiomaDelSistema(codigos: readonly (string | null | undefined)[]): Idioma {
  for (const c of codigos) {
    const base = c?.toLowerCase().split(/[-_]/)[0];
    if (esIdioma(base)) return base;
  }
  return IDIOMA_POR_DEFECTO;
}

export function resolverIdioma(
  preferencia: PreferenciaIdioma,
  codigosSistema: readonly (string | null | undefined)[],
): Idioma {
  return preferencia === 'auto' ? idiomaDelSistema(codigosSistema) : preferencia;
}

/** Locale para formatear fechas (toLocaleString). */
export function localeFechas(idioma: Idioma): string {
  return LOCALES[idioma];
}

/**
 * Voz del TTS. El euskera no tiene voz de sistema en iOS (ni en la mayoría
 * de Android): se pide "eu-ES" y el módulo nativo cae a la de castellano,
 * que con la ortografía del euskera se entiende bien.
 */
export function vozDe(idioma: Idioma): string {
  return LOCALES[idioma];
}

/** Voz de reserva cuando el móvil no tiene la del idioma elegido. */
export const VOZ_RESERVA = 'es-ES';

const LOCALES: Record<Idioma, string> = {
  es: 'es-ES',
  ca: 'ca-ES',
  eu: 'eu-ES',
  en: 'en-GB',
  it: 'it-IT',
  fr: 'fr-FR',
  pt: 'pt-PT',
  nl: 'nl-NL',
};
