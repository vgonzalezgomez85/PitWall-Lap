// Sesión de audio para la voz (Fase 2). `App.tsx` arranca en modo reproducción
// (locución TTS, `allowsRecording: false`); la voz WebRTC necesita captura, así
// que durante Radio pasamos a `allowsRecording: true`. Al salir se restaura.

import { setAudioModeAsync } from 'expo-audio';
import { fijarModoVoz } from '../../modules/backgroundtts';
import { fijarLocucionEnLlamada } from '../voice/speak';

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

/** Activa la captura de micro para Radio. En iOS, además, la locución deja
 *  de devolver la sesión a solo reproducción (cortaba el micro de WebRTC). */
export async function activarAudioVoz(): Promise<void> {
  await aplicar(true);
  fijarModoVoz(true);
  fijarLocucionEnLlamada(true);
}

/** Restaura el modo reproducción (locución) al cerrar Radio. */
export async function restaurarAudio(): Promise<void> {
  fijarModoVoz(false);
  fijarLocucionEnLlamada(false);
  await aplicar(false);
}
