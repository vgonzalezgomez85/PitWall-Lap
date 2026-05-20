// Grabador de stints de entrenamiento.
//
// Mientras `recording` está activo, cada evento 'lap-completed' con tiempo
// válido se acumula en `laps`. El piloto lo arranca/para con el botón
// "Entreno GO" en la pantalla MyTurn. `stop()` devuelve los tiempos
// capturados para que la pantalla los persista (junto con el setup).

import { useRef, useState } from 'react';

import { useSourceEvent } from './sourceContext';

export interface StintRecorder {
  recording: boolean;
  laps: number[];
  start: () => void;
  /** Detiene la grabación y devuelve los tiempos capturados. */
  stop: () => number[];
}

export function useStintRecorder(): StintRecorder {
  const [recording, setRecording] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const recordingRef = useRef(false);
  const lapsRef = useRef<number[]>([]);

  useSourceEvent(e => {
    if (!recordingRef.current) return;
    if (e.type === 'lap-completed' && e.lapTimeMs != null) {
      lapsRef.current = [...lapsRef.current, e.lapTimeMs];
      setLaps(lapsRef.current);
    }
  });

  function start() {
    lapsRef.current = [];
    setLaps([]);
    recordingRef.current = true;
    setRecording(true);
  }

  function stop(): number[] {
    recordingRef.current = false;
    setRecording(false);
    return lapsRef.current;
  }

  return { recording, laps, start, stop };
}
