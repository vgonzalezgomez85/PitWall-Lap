// Monta la fuente «Asistente» en el móvil del piloto/seguidor para recibir los
// tiempos que el asistente calcula y manda por el bus de Radio (D8). La fuente
// se instala en el `SourceProvider` para que `useVoice()` (locución) y las
// pantallas lean el `LiveState` resultante, igual que con un cronómetro real.
//
// Solo tiempos de un coche: sin posición, gaps ni plan. El historial se genera
// localmente al terminar (dossier), como hace TicTac.
//
// `activo` controla si se instala: con «la pista manda», no montamos esta
// fuente cuando ya hay una fuente de pista (PitWall/TicTac) activa, para no
// pisar su cronómetro.

import { useEffect, useRef } from 'react';

import { AsistenteSource } from '../data/AsistenteSource';
import { useDataSource } from '../data/sourceContext';

export function useAsistenteSource(nombre: string, activo: boolean): void {
  const { source, setSource, clearSource } = useDataSource();
  const clearRef = useRef(clearSource);
  clearRef.current = clearSource;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const nombreRef = useRef(nombre);
  nombreRef.current = nombre;

  useEffect(() => {
    if (!activo) return;

    let desechado = false;
    let instalada = false;
    const fuente = new AsistenteSource(nombreRef.current);
    fuente.connect().then(info => {
      if (desechado) {
        fuente.disconnect();
        return;
      }
      instalada = true;
      setSource(fuente, info);
    });

    return () => {
      desechado = true;
      fuente.disconnect();
      // Solo limpiamos el contexto si esta fuente sigue siendo la activa: si una
      // pista (PitWall/TicTac) la reemplazó, no borramos la fuente ajena.
      if (instalada && sourceRef.current === fuente) clearRef.current();
    };
  }, [activo, setSource]);
}
