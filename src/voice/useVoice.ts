// Motor de voz: enlaza los eventos del DataSource (más un ticker periódico
// para gaps/medias en modo avanzado) con expo-speech.
//
// Reglas:
//   • Solo habla si el piloto está en su turno (state.status === 'my-turn').
//   • Si el master `enabled` está off, silencio total.
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
import { crearAgrupadorPosicion, cuentaParaMedia, locutaAvisosDeClasificacion, mediaAnunciable, type AgrupadorPosicion } from './avisos';
import { useIdioma } from '../i18n/IdiomaContext';
import { ordinalHablado, type TextosVoz } from '../i18n';
import type { ClaveAviso } from '../radio/mensajes';

export function useVoice(): { settings: VoiceSettings; toggle: (k: keyof VoiceSettings) => void; update: (p: Partial<VoiceSettings>) => void; ready: boolean } {
  const { state, raceInfo } = useDataSource();
  const { settings, toggle, update, ready } = useVoiceSettings();
  const { t } = useIdioma();

  // Refs para los datos más recientes (los lee el ticker sin causar
  // re-renders del callback).
  const settingsRef = useRef(settings);
  const stateRef    = useRef(state);
  const vozRef      = useRef(t.voz);
  const raceInfoRef = useRef(raceInfo);
  settingsRef.current = settings;
  raceInfoRef.current = raceInfo;
  stateRef.current    = state;
  vozRef.current      = t.voz;

  // Cambios de posición: una racha seguida (2 → 3 → … → 6) se dice una vez,
  // con la última. Al decirla se vuelve a mirar si sigue tocando hablar.
  const posicionRef = useRef<AgrupadorPosicion | null>(null);
  if (!posicionRef.current) {
    posicionRef.current = crearAgrupadorPosicion(pos => {
      const s = settingsRef.current;
      if (!s.enabled || !s.sayPositionChange || stateRef.current.status !== 'my-turn') return;
      speak(ordinalHablado(pos, vozRef.current));
    });
  }

  // ── Eventos discretos ──────────────────────────────────────────────────
  useSourceEvent(e => {
    const s = settingsRef.current;
    const v = vozRef.current;
    if (!s.enabled) return;

    // Si estoy descansando, sólo dejamos pasar 'manga-changed'.
    // Los avisos del equipo (Radio) se dicen siempre: el asistente puede
    // mandar «box» antes de la primera vuelta.
    if (stateRef.current.status !== 'my-turn' && e.type !== 'manga-changed' && e.type !== 'aviso-equipo') return;

    switch (e.type) {
      case 'lap-completed': {
        if (cuentaParaMedia(e)) vueltasValidasRef.current += 1;
        if (!s.sayLaps) return;
        const tiempo = speakTime(e.lapTimeMs, v);
        const ms = e.lapTimeMs;
        const prevBest = bestLapRef.current;
        // Si la fuente ya manda `isFastest` (p.ej. Pole, calculado en el
        // servidor a partir de su propio bestLapMs) nos fiamos de eso en vez
        // de recalcularlo con la referencia local — la local puede quedarse
        // obsoleta si el cliente no detecta un "cambio de turno" (reintento
        // del mismo piloto) que el servidor sí resetea.
        const isFastest = e.isFastest ??
          (ms != null && e.lapCount > 1 && (prevBest == null || ms < prevBest));
        if (ms != null && (prevBest == null || ms < prevBest)) {
          bestLapRef.current = ms;
        }
        // En Pole: si además de tu mejor marca personal es mejor que la de
        // todos los pilotos ya terminados (standings, que solo incluye a
        // quien ya completó su turno), vas primero de la clasificación.
        const pole = stateRef.current.pole;
        const poleLeaderMs = pole?.standings[0]?.lapTimeMs ?? null;
        const isPoleLeader =
          pole != null && isFastest && ms != null &&
          (poleLeaderMs == null || ms < poleLeaderMs);
        console.log('[Voice] speak lap:', e.lapCount, tiempo, isFastest ? '(rápida)' : '', isPoleLeader ? '(líder pole)' : '');
        speak(isPoleLeader ? v.vueltaRapidaPrimero(tiempo) : isFastest ? v.vueltaRapida(tiempo) : tiempo);
        break;
      }
      case 'aviso-equipo':
        speak(textoAviso(e.clave, v));
        break;
      case 'diferencia-objetivo': {
        if (!s.sayLaps) return;
        const t = speakTime(Math.abs(e.diffMs), v);
        speak(e.diffMs > 0 ? v.sobreObjetivo(t) : v.bajoObjetivo(t));
        break;
      }
      case 'position-changed': {
        if (!s.sayPositionChange) return;
        if (e.to !== e.from) posicionRef.current?.cambio(e.from, e.to);
        break;
      }
      case 'half-manga':
        if (s.sayHalfManga) speak(v.mitadManga);
        break;
      case 'last-minute':
        if (s.sayLastMinute) speak(v.ultimoMinuto);
        break;
      case 'last-30s':
        if (s.sayLast30s) speak(v.ultimos30s);
        break;
      case 'race-started':
        vueltasValidasRef.current = 0;
        break;
      case 'manga-changed':
        posicionRef.current?.cancelar();
        bestLapRef.current = null;
        vueltasValidasRef.current = 0;
        if (e.newLane != null) {
          speak(stateRef.current.pole ? v.poleTuTurno(e.newLane)
            : e.lastManga ? `${v.tuTurno(e.newLane)}, ${v.ultimaManga}` : v.tuTurno(e.newLane));
        }
        break;
      case 'race-finished': {
        // La posición final ya va en el aviso de fin.
        posicionRef.current?.cancelar();
        if (stateRef.current.pole) { speak(v.finPole); break; }
        // TicTac nuevo: posición final de la clasificación cerrada.
        const fin = e.raceOver ? v.finCarrera : v.finManga;
        speak(e.position != null ? `${fin}, ${ordinalHablado(e.position, v)}` : fin);
        break;
      }
      case 'manga-paused':
        speak(v.mangaPausa);
        break;
      case 'manga-resumed':
        speak(v.mangaReanudada);
        break;
      // STOP manual: la manga se repite desde cero, así que su mejor vuelta y
      // su media ya no cuentan como referencia.
      case 'manga-cancelled':
        bestLapRef.current = null;
        vueltasValidasRef.current = 0;
        speak(v.mangaDetenida);
        break;
      // Vuelta fantasma en MI carril (cruce demasiado rápido, no cuenta): no
      // es vuelta rápida — se avisa como ignorada.
      case 'lap-ghost':
        if (s.sayLaps && e.lane === stateRef.current.myLane) speak(v.vueltaIgnorada);
        break;
      // Vuelta fantasma reasignada. Si era mía (la "pierdo"): "ignorada,
      // asignada a X". Si me la asignan a mí (la gano): "vuelta asignada"
      // (sin tiempo — cuenta a media, no al tiempo rápido del fantasma).
      case 'lap-reassigned': {
        if (!s.sayLaps) break;
        const my = stateRef.current.myLane;
        if (e.fromLane === my) {
          speak(e.toName ? v.vueltaIgnoradaAsignada(e.toName) : v.vueltaIgnorada);
        } else if (e.toLane === my) {
          speak(v.vueltaAsignada);
        }
        break;
      }
      // connection-*: no se locutan.
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
      const v = vozRef.current;
      if (!s.enabled || st.status !== 'my-turn') return;
      // Con la manga pausada o cerrada no hay nada nuevo que contar.
      if (st.estadoManga != null && st.estadoManga !== 'en-curso') return;
      const minute = Math.floor((Date.now() / 1000) / 60);
      const clasificacion = locutaAvisosDeClasificacion(raceInfoRef.current, st.protocoloTicTac);

      // Medias: cada N minutos en punto, y solo con al menos dos vueltas
      // válidas en la manga (con una, la media es esa vuelta repetida).
      if (s.sayAveragesEveryMin > 0 && minute % s.sayAveragesEveryMin === 0) {
        if (lastAvgMinuteRef.current !== minute && st.avgLapMs != null
            && mediaAnunciable(vueltasValidasRef.current)) {
          lastAvgMinuteRef.current = minute;
          speak(v.mediaCarril(speakTime(st.avgLapMs, v)));
        }
      }

      // Media de carrera (todas las mangas): cada N minutos en punto. Misma
      // espera de dos vueltas válidas en la manga, para no repetir de entrada
      // una media que aún no incluye nada de esta manga.
      if (clasificacion && s.sayRaceAvgEveryMin > 0 && minute % s.sayRaceAvgEveryMin === 0) {
        if (lastRaceAvgMinuteRef.current !== minute && st.raceAvgLapMs != null
            && mediaAnunciable(vueltasValidasRef.current)) {
          lastRaceAvgMinuteRef.current = minute;
          speak(v.mediaCarrera(speakTime(st.raceAvgLapMs, v)));
        }
      }

      // Gaps: cada N minutos en punto. Avisamos en VUELTAS, y solo cuando el
      // rival está a 2 vueltas o menos (lo bastante cerca para importar).
      if (clasificacion && s.sayGapsEveryMin > 0 && minute % s.sayGapsEveryMin === 0) {
        if (lastGapMinuteRef.current !== minute) {
          lastGapMinuteRef.current = minute;
          if (st.gapAheadLaps != null && st.gapAheadLaps <= GAP_LAPS_THRESHOLD && st.aheadName) {
            speak(st.gapAheadLaps === 0
              ? v.delanteALaPar(st.aheadName)
              : v.delanteA(st.gapAheadLaps, st.aheadName));
          }
          if (st.gapBehindLaps != null && st.gapBehindLaps <= GAP_LAPS_THRESHOLD && st.behindName) {
            speak(st.gapBehindLaps === 0
              ? v.detrasALaPar(st.behindName)
              : v.detrasA(st.gapBehindLaps, st.behindName));
          }
        }
      }

      // Media para subir: cada N minutos en punto. Solo si el servidor manda un
      // ritmo aplicable (no líder / con tiempo / alcanzable).
      if (clasificacion && s.sayCatchUpEveryMin > 0 && minute % s.sayCatchUpEveryMin === 0) {
        if (lastCatchMinuteRef.current !== minute && st.avgToCatchMs != null) {
          lastCatchMinuteRef.current = minute;
          speak(v.paraSubir(speakTime(st.avgToCatchMs, v)));
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
  // Vueltas válidas (sin salidas ni primer paso) de la manga en curso.
  const vueltasValidasRef    = useRef(0);

  // El keep-alive en background lo hace el módulo nativo `BackgroundTts`
  // vía AVAudioEngine (loop infinito de ruido inaudible). Aquí solo
  // detenemos lo que esté hablando al salir de MyTurn.
  useEffect(() => {
    return () => { posicionRef.current?.cancelar(); shutUp(); };
  }, []);

  // Si cambia la fuente (raceInfo) → reset de las guardas.
  useEffect(() => {
    lastAvgMinuteRef.current = -1;
    lastGapMinuteRef.current = -1;
    lastCatchMinuteRef.current = -1;
    lastRaceAvgMinuteRef.current = -1;
    bestLapRef.current = null;
    vueltasValidasRef.current = 0;
    posicionRef.current?.cancelar();
  }, [raceInfo?.source]);

  return { settings, toggle, update, ready };
}

// Solo avisamos del rival si está a esta diferencia de vueltas o menos.
const GAP_LAPS_THRESHOLD = 2;

/** Frase que se locuta para cada mensaje rápido del asistente (Radio). */
export function textoAviso(clave: ClaveAviso, v: TextosVoz): string {
  switch (clave) {
    case 'box': return v.avisoBox;
    case 'gomas': return v.avisoGomas;
    case 'mediaManga': return v.mitadManga;
    case 'ultimoMinuto': return v.ultimoMinuto;
    case 'push': return v.avisoPush;
    case 'sigueAsi': return v.avisoSigueAsi;
    default: return '';
  }
}
