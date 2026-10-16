// Sesión de audio para la voz (Fase 2). `App.tsx` arranca en modo reproducción
// (locución TTS, `allowsRecording: false`); la voz WebRTC necesita captura, así
// que durante Radio pasamos a `allowsRecording: true`. Al salir se restaura.

import { setAudioModeAsync } from 'expo-audio';

async function aplicar(allowsRecording: boolean): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    });
  } catch (e) {
    console.warn('[Radio] setAudioModeAsync failed:', e);
  }
}

/** Activa la captura de micro para Radio. */
export function activarAudioVoz(): Promise<void> {
  return aplicar(true);
}

/** Restaura el modo reproducción (locución) al cerrar Radio. */
export function restaurarAudio(): Promise<void> {
  return aplicar(false);
}
