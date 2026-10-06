// TTS en el idioma de la app (castellano por defecto). Usa el módulo nativo
// local `BackgroundTts` cuando está disponible (iOS, con AVAudioSession bien
// configurado para background). Cae a `react-native-tts` como fallback si no
// está disponible o falla.

import Tts from 'react-native-tts';
import * as Bg from '../../modules/backgroundtts';
import { textosDe, type TextosVoz } from '../i18n';
import { VOZ_RESERVA } from '../i18n/idiomas';

const RATE = 0.5;

// Voz actual (BCP 47). La fija IdiomaProvider al arrancar y al cambiar idioma.
let lang = 'es-ES';

let ttsFallbackInit = false;

function aplicarIdiomaFallback(): void {
  // Si el motor no tiene la voz (p. ej. euskera), la de reserva.
  Tts.setDefaultLanguage(lang)
    .catch(() => Tts.setDefaultLanguage(VOZ_RESERVA))
    .catch(() => {});
}

function ensureFallbackInit(): void {
  if (ttsFallbackInit) return;
  ttsFallbackInit = true;
  aplicarIdiomaFallback();
  Tts.setDefaultRate(RATE);
  Tts.setIgnoreSilentSwitch?.('ignore');
}

/** Cambia el idioma de la voz ("es-ES", "en-GB"…). */
export function fijarVoz(codigo: string): void {
  if (codigo === lang) return;
  lang = codigo;
  if (ttsFallbackInit) aplicarIdiomaFallback();
}

let loggedRoute = false;

/** Habla un texto con la voz del idioma actual. */
export function speak(text: string): void {
  if (!text) return;
  // Camino preferente: módulo nativo con sesión de audio activa.
  if (Bg.isAvailable() && Bg.speak(text, lang, RATE)) {
    if (!loggedRoute) {
      console.log('[TTS] using NATIVE BackgroundTts');
      loggedRoute = true;
    }
    console.log('[TTS] status:', JSON.stringify(Bg.getStatus()));
    return;
  }
  // Fallback: react-native-tts (sólo funciona en foreground).
  if (!loggedRoute) {
    console.log('[TTS] using FALLBACK react-native-tts (native module not available)');
    loggedRoute = true;
  }
  ensureFallbackInit();
  try { Tts.speak(text); } catch (e) { console.log('[TTS fallback] err:', e); }
}

/** Detiene el habla en curso. */
export function shutUp(): void {
  if (Bg.isAvailable()) Bg.stop();
}

// ── Helpers de formato ───────────────────────────────────────────────────

export function fmtTime(ms: number | null): string {
  if (ms == null) return '—';
  const totalCs = Math.round(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  return `${s}.${String(cs).padStart(2, '0')}`;
}

export function speakTime(ms: number | null, voz: TextosVoz = textosDe('es').voz): string {
  if (ms == null) return voz.sinTiempo;
  // Centésimas truncadas (no redondeadas): 8739ms → "8 con 73", no "8 con 74".
  const totalCs = Math.floor(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  // Solo "12 45" — sin "con", se hace pesado al oírlo a cada vuelta. Las
  // centésimas exactas se dicen igual que el resto: 10000ms → "10 cero cero"
  // (en cifra, "00", el TTS lo lee como "cero" a secas). Cada idioma con su
  // palabra: "10 zero zero", "10 nul nul"…
  if (cs === 0) return `${s} ${voz.cero} ${voz.cero}`;
  return `${s} ${String(cs).padStart(2, '0')}`;
}
