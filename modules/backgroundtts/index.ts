// Wrapper TS del módulo nativo iOS `BackgroundTts`. Sólo iOS por ahora;
// en Android el TTS nativo del sistema ya funciona en background sin
// gestión especial de audio session.

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface BackgroundTtsNative {
  speak(text: string, language: string, rate: number): string;
  stop(): void;
  getStatus(): string;
}

const native = requireOptionalNativeModule<BackgroundTtsNative>('BackgroundTts');

export function speak(text: string, language: string = 'es-ES', rate: number = 0.5): boolean {
  if (Platform.OS !== 'ios' || !native) return false;
  try {
    const status = native.speak(text, language, rate);
    if (status !== 'ok') console.log('[BackgroundTts] status:', status);
    return true;
  } catch (e) {
    console.log('[BackgroundTts] speak err:', e);
    return false;
  }
}

export function stop(): void {
  if (Platform.OS !== 'ios' || !native) return;
  try { native.stop(); } catch { /* ignore */ }
}

export function isAvailable(): boolean {
  return Platform.OS === 'ios' && !!native;
}

export function getStatus(): string {
  if (!native) return 'no-native';
  try { return native.getStatus(); } catch (e) { return `err: ${e}`; }
}
