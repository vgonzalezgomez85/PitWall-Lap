// Hook que escucha el evento `race:stats-snapshot` de cualquier fuente
// activa y lo persiste localmente en el histórico. Se monta una vez
// dentro del SourceProvider para que funcione globalmente.

import { useEffect } from 'react';

import { useDataSource } from './sourceContext';
import { saveSnapshot } from './historyStore';

export function useAutoSaveHistory(): void {
  const { subscribeSnapshot } = useDataSource();
  useEffect(() => {
    return subscribeSnapshot(snap => {
      void saveSnapshot(snap);
      console.log('[history] auto-saved snapshot for race', snap.raceId);
    });
  }, [subscribeSnapshot]);
}
