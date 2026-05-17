// Mantener viva la sesión de audio iOS en background.
//
// Razón: AVSpeechSynthesizer (lo que usa expo-speech) sólo habla mientras
// hay una AVAudioSession activa. Cuando una utterance termina, la sesión
// se libera y iOS suspende la app en background → la siguiente utterance
// no se reproduce.
//
// Truco: reproducir un audio silente en bucle constante para que la
// sesión nunca se libere. La TTS habla "encima" gracias a
// `interruptionMode: 'mixWithOthers'`.

import { AudioPlayer, createAudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;

export function startSilentLoop(): void {
  if (player) return;
  try {
    // El módulo nativo `BackgroundTts` ya configura la categoría de
    // sesión a .playback. Aquí solo lanzamos un audio en loop para
    // mantener la app viva en background — sin tocar la categoría.
    player = createAudioPlayer(require('../../assets/silent.wav'));
    player.loop = true;
    player.volume = 0.05;
    player.play();
    console.log('[silentLoop] started');
  } catch (e) {
    console.warn('[silentLoop] failed to start:', e);
  }
}

export function stopSilentLoop(): void {
  if (!player) return;
  try {
    player.pause();
    player.remove();
    console.log('[silentLoop] stopped');
  } catch { /* ignore */ }
  player = null;
}
