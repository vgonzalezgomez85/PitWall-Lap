// Wrapper TS del módulo nativo iOS `BackgroundTts`. Sólo iOS por ahora;
// en Android el TTS nativo del sistema ya funciona en background sin
// gestión especial de audio session.

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface BackgroundTtsNative {
  start(): boolean;
  speak(text: string, language: string, rate: number): string;
  stop(): void;
  shutUp(): void;
  getStatus(): string;
  modoVoz?(activo: boolean): void;
  mostrarModosMicro?(): Promise<void>;
  modoMicro?(): string;
  addListener?(evento: 'onLocucion', cb: (e: { hablando: boolean }) => void): { remove(): void };
}

const native = requireOptionalNativeModule<BackgroundTtsNative>('BackgroundTts');

/**
 * Radio con voz activa (iOS): la sesión de audio pasa a playAndRecord +
 * voiceChat para que la locución no corte el micro de WebRTC.
 */
export function fijarModoVoz(activo: boolean): void {
  if (Platform.OS !== 'ios' || !native?.modoVoz) return;
  try { native.modoVoz(activo); } catch (e) { console.log('[BackgroundTts] modoVoz err:', e); }
}

/** Abre el selector del sistema de modo de micro (Aislamiento de voz). iOS 15+. */
export function mostrarModosMicro(): void {
  if (Platform.OS !== 'ios' || !native?.mostrarModosMicro) return;
  native.mostrarModosMicro().catch(() => { /* ignore */ });
}

/** Modo de micro activo en iOS: 'aislamiento' | 'estandar' | 'amplio' | ''. */
export function modoMicro(): string {
  if (Platform.OS !== 'ios' || !native?.modoMicro) return '';
  try { return native.modoMicro(); } catch { return ''; }
}

/** Avisa cuando la locución nativa empieza/acaba. Devuelve la cancelación. */
export function onLocucionNativa(cb: (hablando: boolean) => void): () => void {
  if (Platform.OS !== 'ios' || !native?.addListener) return () => {};
  const sub = native.addListener('onLocucion', e => cb(!!e.hablando));
  return () => sub.remove();
}

/**
 * Activa el keep-alive de audio (loop silente) que mantiene viva la app en
 * background para que la voz suene con la pantalla bloqueada. Llamar SOLO al
 * conectar con una carrera; mientras está activo iOS no suspende la app.
 */
export function startKeepAlive(): void {
  if (Platform.OS !== 'ios' || !native) return;
  try { native.start(); } catch (e) { console.log('[BackgroundTts] start err:', e); }
}

/**
 * Para el keep-alive y libera la sesión de audio para que iOS pueda suspender
 * la app. Llamar al desconectar de la carrera (ahorra batería).
 */
export function stopKeepAlive(): void {
  if (Platform.OS !== 'ios' || !native) return;
  try { native.stop(); } catch (e) { console.log('[BackgroundTts] stop err:', e); }
}

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

/** Interrumpe el habla en curso, sin tocar el keep-alive. */
export function stop(): void {
  if (Platform.OS !== 'ios' || !native) return;
  try { native.shutUp(); } catch { /* ignore */ }
}

export function isAvailable(): boolean {
  return Platform.OS === 'ios' && !!native;
}

export function getStatus(): string {
  if (!native) return 'no-native';
  try { return native.getStatus(); } catch (e) { return `err: ${e}`; }
}
