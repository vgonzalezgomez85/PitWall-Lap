// Coordinación locución ↔ voz (§6 del diseño). Las reglas de prioridad se
// deciden aquí de forma pura (testable); el reloj y los callbacks los pone el
// hook `useRadio` / `useCoordinacionAudio`.

import type { Hablando } from './mensajes';

/** Qué hace la voz del asistente cuando llega durante una locución. */
export type VozDuranteLocucion = 'atenuar' | 'cortar';

export interface AjustesAudioRadio {
  /** El asistente canta los tiempos al piloto (locución automática). */
  locutarTiempos: boolean;
  /** Si llega un tiempo mientras habla el asistente, la locución espera. */
  esperarSiHabla: boolean;
  /** Máximo que la locución espera a que suelte el asistente (ms). */
  maxEsperaMs: number;
  /** Qué hacer si el asistente habla durante una locución. */
  vozDuranteLocucion: VozDuranteLocucion;
}

export const MAX_ESPERA_POR_DEFECTO = 1500;

export function ajustesAudioPorDefecto(): AjustesAudioRadio {
  return {
    locutarTiempos: true,
    esperarSiHabla: true,
    maxEsperaMs: MAX_ESPERA_POR_DEFECTO,
    vozDuranteLocucion: 'atenuar',
  };
}

/** Qué hacer con un tiempo que acaba de llegar. */
export type DecisionLocucion = 'locutar' | 'esperar' | 'callar';

/**
 * Decide qué hacer cuando llega un tiempo a locutar.
 *
 * - Locución desactivada → `callar`.
 * - El asistente habla y hay que esperar, pero aún no se ha agotado la espera
 *   → `esperar` (el hook reprograma la decisión al soltar o al vencer).
 * - En cualquier otro caso → `locutar`.
 */
export function decidirLocucion(
  hablando: Hablando,
  esperadoMs: number,
  ajustes: AjustesAudioRadio,
): DecisionLocucion {
  if (!ajustes.locutarTiempos) return 'callar';
  if (hablando !== null && ajustes.esperarSiHabla && esperadoMs < ajustes.maxEsperaMs) {
    return 'esperar';
  }
  return 'locutar';
}

/** Qué hace la voz del asistente cuando empieza durante una locución. */
export type DecisionVoz = 'normal' | 'atenuar' | 'cortar';

/**
 * Decide cómo tratar la voz del asistente que entra durante una locución.
 * `locutando` indica si hay una locución en curso.
 */
export function decidirVoz(
  hablando: Hablando,
  locutando: boolean,
  ajustes: AjustesAudioRadio,
): DecisionVoz {
  if (hablando === null || !locutando) return 'normal';
  return ajustes.vozDuranteLocucion === 'cortar' ? 'cortar' : 'atenuar';
}
