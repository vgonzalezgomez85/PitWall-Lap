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
  const isInfolapRef = useRef(false);
  settingsRef.current = settings;
  stateRef.current    = state;
  isInfolapRef.current = raceInfo?.source === 'infolap';

  // ── Eventos discretos ──────────────────────────────────────────────────
  useSourceEvent(e => {
    const s = settingsRef.current;
    if (!s.enabled) return;

    // Si estoy descansando, sólo dejamos pasar 'manga-changed'.
    if (stateRef.current.status !== 'my-turn' && e.type !== 'manga-changed') return;

    switch (e.type) {
      case 'lap-completed': {
        // Acumular para la media de carrera (independiente de sayLaps).
        if (e.lapTimeMs != null) raceLapsRef.current.push(e.lapTimeMs);
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
        if (e.to !== e.from) speak(ordinal(e.to));
        break;
      }
      case 'half-manga':
        if (s.sayHalfManga) speak('Media manga');
        break;
      case 'last-minute':
        if (s.sayLastMinute) speak('Último minuto');
        break;
      case 'last-30s':
        if (s.sayLast30s) speak('Últimos treinta segundos');
        break;
      case 'manga-changed':
        bestLapRef.current = null;
        raceLapsRef.current = [];
        if (e.newLane != null) {
          if (stateRef.current.pole) {
            speak(`Pole, tu turno, carril ${e.newLane}`);
          } else {
            speak(`Tu turno, carril ${e.newLane}`);
          }
        }
        break;
      case 'race-finished':
        speak(stateRef.current.pole ? 'Fin de la pole' : 'Fin de la manga');
        break;
      // Vuelta fantasma en MI carril (cruce demasiado rápido, no cuenta): no
      // es vuelta rápida — se avisa como ignorada.
      case 'lap-ghost':
        if (s.sayLaps && e.lane === stateRef.current.myLane) speak('Vuelta ignorada');
        break;
      // Vuelta fantasma reasignada. Si era mía (la "pierdo"): "ignorada,
      // asignada a X". Si me la asignan a mí (la gano): "vuelta asignada"
      // (sin tiempo — cuenta a media, no al tiempo rápido del fantasma).
      case 'lap-reassigned': {
        if (!s.sayLaps) break;
        const my = stateRef.current.myLane;
        if (e.fromLane === my) {
          speak(e.toName ? `Vuelta ignorada, asignada a ${e.toName}` : 'Vuelta ignorada');
        } else if (e.toLane === my) {
          speak('Vuelta asignada');
        }
        break;
      }
      // race-started, connection-*: no se locutan.
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

      // InfoLap: media acumulada de la carrera, cada minuto.
      if (isInfolapRef.current && lastRaceAvgMinuteRef.current !== minute) {
        // El primer tick solo fija el minuto base; así el primer aviso
        // llega tras un minuto completo, no nada más entrar.
        if (lastRaceAvgMinuteRef.current === -1) {
          lastRaceAvgMinuteRef.current = minute;
        } else {
          lastRaceAvgMinuteRef.current = minute;
          const laps = raceLapsRef.current;
          if (laps.length > 0) {
            const avg = laps.reduce((a, b) => a + b, 0) / laps.length;
            speak(`Media de carrera ${speakTime(avg)}`);
          }
        }
      }

      // Medias: cada N minutos en punto.
      if (s.sayAveragesEveryMin > 0 && minute % s.sayAveragesEveryMin === 0) {
        if (lastAvgMinuteRef.current !== minute && st.avgLapMs != null) {
          lastAvgMinuteRef.current = minute;
          speak(`Media de carril ${speakTime(st.avgLapMs)}`);
        }
      }

      // Gaps: cada N minutos en punto. Avisamos en VUELTAS, y solo cuando el
      // rival está a 2 vueltas o menos (lo bastante cerca para importar).
      if (s.sayGapsEveryMin > 0 && minute % s.sayGapsEveryMin === 0) {
        if (lastGapMinuteRef.current !== minute) {
          lastGapMinuteRef.current = minute;
          if (st.gapAheadLaps != null && st.gapAheadLaps <= GAP_LAPS_THRESHOLD && st.aheadName) {
            speak(st.gapAheadLaps === 0
              ? `A la par con ${st.aheadName}`
              : `A ${lapsPhrase(st.gapAheadLaps)} de ${st.aheadName}`);
          }
          if (st.gapBehindLaps != null && st.gapBehindLaps <= GAP_LAPS_THRESHOLD && st.behindName) {
            speak(st.gapBehindLaps === 0
              ? `${st.behindName}, a la par`
              : `Tienes a ${st.behindName} a ${lapsPhrase(st.gapBehindLaps)}`);
          }
        }
      }

      // Media para subir: cada N minutos en punto. Solo si el servidor manda un
      // ritmo aplicable (no líder / con tiempo / alcanzable).
      if (s.sayCatchUpEveryMin > 0 && minute % s.sayCatchUpEveryMin === 0) {
        if (lastCatchMinuteRef.current !== minute && st.avgToCatchMs != null) {
          lastCatchMinuteRef.current = minute;
          speak(`Para subir, ${speakTime(st.avgToCatchMs)}`);
        }
      }
    }, 5000); // chequear cada 5s, la guarda por minuto evita repetición
    return () => clearInterval(interval);
  }, [ready]);

  // Refs para evitar disparar el mismo aviso varias veces dentro del mismo
  // minuto (el ticker corre cada 5s).
  const lastAvgMinuteRef     = useRef<number>(-1);
  const lastGapMinuteRef     = useRef<number>(-1);
  const lastCatchMinuteRef   = useRef<number>(-1);
  const lastRaceAvgMinuteRef = useRef<number>(-1);
  const bestLapRef           = useRef<number | null>(null);
  // Tiempos de todas las vueltas del piloto en la manga/carrera actual.
  const raceLapsRef          = useRef<number[]>([]);

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
    lastCatchMinuteRef.current = -1;
    lastRaceAvgMinuteRef.current = -1;
    bestLapRef.current = null;
    raceLapsRef.current = [];
  }, [raceInfo?.source]);

  return { settings, toggle, update, ready };
}

// Solo avisamos del rival si está a esta diferencia de vueltas o menos.
const GAP_LAPS_THRESHOLD = 2;

function lapsPhrase(n: number): string {
  return n === 1 ? 'una vuelta' : `${n} vueltas`;
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
