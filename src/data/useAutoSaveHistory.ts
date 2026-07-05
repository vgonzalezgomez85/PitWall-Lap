// Hook que escucha el evento `race:stats-snapshot` de cualquier fuente
// activa y lo persiste localmente en el histórico. Se monta una vez
// dentro del SourceProvider para que funcione globalmente.

import { useEffect } from 'react';

import { useDataSource } from './sourceContext';
import { saveSnapshot } from './historyStore';
import { ensureExcelLocal } from './excelCache';

export function useAutoSaveHistory(): void {
  const { subscribeSnapshot } = useDataSource();
  useEffect(() => {
    return subscribeSnapshot(async snap => {
      await saveSnapshot(snap);
      console.log('[history] auto-saved snapshot for race', snap.raceId);
      // Best-effort: descargar el Excel ya, con el servidor a mano, para
      // poder abrirlo luego sin conexión. Si falla, se baja bajo demanda.
      void ensureExcelLocal(snap);
    });
  }, [subscribeSnapshot]);
}
