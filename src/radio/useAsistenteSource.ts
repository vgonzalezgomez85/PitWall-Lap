// Monta la fuente «Asistente» en el móvil del piloto/seguidor para recibir los
// tiempos que el asistente calcula y manda por el bus de Radio (D8). La fuente
// se instala en el `SourceProvider` para que `useVoice()` (locución) y las
// pantallas lean el `LiveState` resultante, igual que con un cronómetro real.
//
// Solo tiempos de un coche: sin posición, gaps ni plan. El historial se genera
// localmente al terminar (dossier), como hace TicTac.

import { useEffect, useRef } from 'react';

import { AsistenteSource } from '../data/AsistenteSource';
import { useDataSource } from '../data/sourceContext';

export function useAsistenteSource(nombre: string): void {
  const { setSource, clearSource } = useDataSource();
  const clearRef = useRef(clearSource);
  clearRef.current = clearSource;
  const nombreRef = useRef(nombre);
  nombreRef.current = nombre;

  useEffect(() => {
    let activo = true;
    const fuente = new AsistenteSource(nombreRef.current);
    fuente.connect().then(info => {
      if (activo) setSource(fuente, info);
    });
    return () => {
      activo = false;
      fuente.disconnect();
      // Deja el contexto limpio (sin fuente fantasma ni estado residual).
      clearRef.current();
    };
  }, [setSource]);
}
