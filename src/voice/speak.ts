// TTS en castellano. Usa el módulo nativo local `BackgroundTts` cuando
// está disponible (iOS, con AVAudioSession bien configurado para
// background). Cae a `react-native-tts` como fallback si no está
// disponible o falla.

import Tts from 'react-native-tts';
import * as Bg from '../../modules/backgroundtts';

const LANG = 'es-ES';
const RATE = 0.5;

let ttsFallbackInit = false;

function ensureFallbackInit(): void {
  if (ttsFallbackInit) return;
  ttsFallbackInit = true;
  Tts.setDefaultLanguage(LANG).catch(() => {});
  Tts.setDefaultRate(RATE);
  Tts.setIgnoreSilentSwitch?.('ignore');
}

let loggedRoute = false;

/** Habla un texto en castellano. */
export function speak(text: string): void {
  if (!text) return;
  // Camino preferente: módulo nativo con sesión de audio activa.
  if (Bg.isAvailable() && Bg.speak(text, LANG, RATE)) {
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

export function speakTime(ms: number | null): string {
  if (ms == null) return 'sin tiempo';
  // Centésimas truncadas (no redondeadas): 8739ms → "8 con 73", no "8 con 74".
  const totalCs = Math.floor(ms / 10);
  const s = Math.floor(totalCs / 100);
  const cs = totalCs % 100;
  if (cs === 0) return `${s} segundos`;
  return `${s} con ${String(cs).padStart(2, '0')}`;
}
