// Motor de voz: enlaza los eventos del DataSource (más un ticker periódico
// para gaps/medias en modo avanzado) con expo-speech.
//
// Reglas:
//   • Solo habla si el piloto está en su turno (state.status === 'my-turn').
//   • Si el master `enabled` está off, silencio total.
//   • Modo Infolap (capabilities.lapTimes only): sólo dispara "lap-completed".
//   • En descanso → silencio + un único aviso al volver a "my-turn" con la
//     próxima manga (lo dispara el evento 'manga-changed').
//
// Los toggles concretos (sayLaps, sayPositionChange, ...) se leen vía
// useVoiceSettings.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useDataSource, useSourceEvent } from '../data/sourceContext';
import { speak, speakTime, shutUp } from './speak';
import { useVoiceSettings, type VoiceSettings } from './settings';

export function useVoice(): { settings: VoiceSettings; toggle: (k: keyof VoiceSettings) => void; update: (p: Partial<VoiceSettings>) => void; ready: boolean } {
  const { state, raceInfo } = useDataSource();
  const { settings, toggle, update, ready } = useVoiceSettings();

  // Refs para los datos más recientes (los lee el ticker sin causar
  // re-renders del callback).
  const settingsRef = useRef(settings);
  const stateRef    = useRef(state);
  settingsRef.current = settings;
  stateRef.current    = state;

  // ── Eventos discretos ──────────────────────────────────────────────────
  useSourceEvent(e => {
    const s = settingsRef.current;
    if (!s.enabled) return;

    // Si estoy descansando, sólo dejamos pasar 'manga-changed'.
    if (stateRef.current.status !== 'my-turn' && e.type !== 'manga-changed') return;

    switch (e.type) {
      case 'lap-completed': {
        if (!s.sayLaps) return;
        const t = speakTime(e.lapTimeMs);
        const ms = e.lapTimeMs;
        const prevBest = bestLapRef.current;
        const isFastest =
          ms != null && e.lapCount > 1 && (prevBest == null || ms < prevBest);
        if (ms != null && (prevBest == null || ms < prevBest)) {
          bestLapRef.current = ms;
        }
        console.log('[Voice] speak lap:', e.lapCount, t, isFastest ? '(rápida)' : '');
        speak(isFastest ? `Vuelta rápida, ${t}` : t);
        break;
      }
      case 'position-changed': {
        if (!s.sayPositionChange) return;
        if (e.to < e.from)      speak(`Has subido a ${ordinal(e.to)}`);
        else if (e.to > e.from) speak(`Te han adelantado, vas ${ordinal(e.to)}`);
        break;
      }
      case 'last-minute':
        if (s.sayLastMinute) speak('Último minuto');
        break;
      case 'last-30s':
        if (s.sayLast30s) speak('Últimos treinta segundos');
        break;
      case 'manga-changed':
        bestLapRef.current = null;
        if (e.newLane != null) speak(`Tu turno, carril ${e.newLane}`);
        break;
      case 'race-finished':
        speak('Fin de la manga');
        break;
      // 'lap-ghost': silenciado a propósito — el piloto no necesita oír
      // anomalías técnicas del cronometrador, se reasignan solas.
      // lap-reassigned, race-started, connection-*: no se locutan en v1.
      default:
        break;
    }
  });

  // ── Ticker periódico para modo avanzado (gaps + medias) ────────────────
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      const s = settingsRef.current;
      const st = stateRef.current;
      if (!s.enabled || st.status !== 'my-turn') return;
      const minute = Math.floor((Date.now() / 1000) / 60);

      // Medias: cada N minutos en punto.
      if (s.sayAveragesEveryMin > 0 && minute % s.sayAveragesEveryMin === 0) {
        if (lastAvgMinuteRef.current !== minute && st.avgLapMs != null) {
          lastAvgMinuteRef.current = minute;
          speak(`Media de carril ${speakTime(st.avgLapMs)}`);
        }
      }

      // Gaps: cada N minutos en punto.
      if (s.sayGapsEveryMin > 0 && minute % s.sayGapsEveryMin === 0) {
        if (lastGapMinuteRef.current !== minute) {
          lastGapMinuteRef.current = minute;
          if (st.gapAheadMs != null && st.aheadName) {
            speak(`Te separan ${speakTime(st.gapAheadMs)} de ${st.aheadName}`);
          }
          if (st.gapBehindMs != null && st.behindName) {
            speak(`Tienes a ${st.behindName} a ${speakTime(st.gapBehindMs)}`);
          }
        }
      }
    }, 5000); // chequear cada 5s, la guarda por minuto evita repetición
    return () => clearInterval(interval);
  }, [ready]);

  // Refs para evitar disparar el mismo aviso varias veces dentro del mismo
  // minuto (el ticker corre cada 5s).
  const lastAvgMinuteRef = useRef<number>(-1);
  const lastGapMinuteRef = useRef<number>(-1);
  const bestLapRef       = useRef<number | null>(null);

  // El keep-alive en background lo hace el módulo nativo `BackgroundTts`
  // vía AVAudioEngine (loop infinito de ruido inaudible). Aquí solo
  // detenemos lo que esté hablando al salir de MyTurn.
  useEffect(() => {
    return () => { shutUp(); };
  }, []);

  // Si cambia la fuente (raceInfo) → reset de las guardas.
  useEffect(() => {
    lastAvgMinuteRef.current = -1;
    lastGapMinuteRef.current = -1;
    bestLapRef.current = null;
  }, [raceInfo?.source]);

  return { settings, toggle, update, ready };
}

function ordinal(n: number): string {
  switch (n) {
    case 1: return 'primero';
    case 2: return 'segundo';
    case 3: return 'tercero';
    case 4: return 'cuarto';
    case 5: return 'quinto';
    case 6: return 'sexto';
    case 7: return 'séptimo';
    case 8: return 'octavo';
    case 9: return 'noveno';
    case 10: return 'décimo';
    default: return `puesto ${n}`;
  }
}
