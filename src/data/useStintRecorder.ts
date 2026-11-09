// Grabador de stints de entrenamiento.
//
// Mientras `recording` está activo, cada evento 'lap-completed' con tiempo
// válido se acumula en `laps`. El piloto lo arranca/para con el botón
// "Entreno GO" en la pantalla MyTurn. `stop()` devuelve los tiempos
// capturados para que la pantalla los persista (junto con el setup).
//
// Dos defensas contra vueltas perdidas (Android, sobre todo):
//   - Mientras graba, la pantalla no se apaga: con la pantalla apagada Android
//     duerme la app y el socket deja de recibir vueltas.
//   - Si aun así hay un corte, la siguiente vuelta trae el contador y el
//     historial del servidor y se rellenan las que faltan (grabacionStint.ts).

import { useEffect, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { useDataSource, useSourceEvent } from './sourceContext';
import { anadirVuelta, iniciarGrabacion, type GrabacionStint } from './grabacionStint';

const ETIQUETA_PANTALLA = 'pitwall-grabar-entreno';

export interface StintRecorder {
  recording: boolean;
  laps: number[];
  start: () => void;
  /** Detiene la grabación y devuelve los tiempos capturados. */
  stop: () => number[];
}

export function useStintRecorder(): StintRecorder {
  const { state } = useDataSource();
  const [recording, setRecording] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const recordingRef = useRef(false);
  const grabacionRef = useRef<GrabacionStint>(iniciarGrabacion(null));

  useSourceEvent(e => {
    if (!recordingRef.current) return;
    if (e.type === 'lap-completed' && e.lapTimeMs != null) {
      grabacionRef.current = anadirVuelta(grabacionRef.current, {
        lapTimeMs: e.lapTimeMs,
        lapCount: e.lapCount,
        historialMs: e.historialMs,
      });
      setLaps(grabacionRef.current.vueltas);
    }
  });

  // Pantalla encendida solo mientras se graba.
  useEffect(() => {
    if (!recording) return;
    activateKeepAwakeAsync(ETIQUETA_PANTALLA).catch(() => {});
    return () => { void deactivateKeepAwake(ETIQUETA_PANTALLA).catch(() => {}); };
  }, [recording]);

  function start() {
    grabacionRef.current = iniciarGrabacion(state.lapCount ?? null);
    setLaps([]);
    recordingRef.current = true;
    setRecording(true);
  }

  function stop(): number[] {
    recordingRef.current = false;
    setRecording(false);
    return grabacionRef.current.vueltas;
  }

  return { recording, laps, start, stop };
}
