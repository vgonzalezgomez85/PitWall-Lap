// Avisos del calendario: notificaciones locales programadas con
// expo-notifications. Cada aviso de un evento es una notificación con su hora;
// al editar o borrar el evento se cancelan y se reprograman.

import * as Notifications from 'expo-notifications';

import { avisosPendientes, type AvisoId, type Evento } from './calendario';

// Con la app abierta, que el aviso también se vea como banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Pide permiso de notificaciones si hace falta. true = concedido. */
export async function pedirPermisoAvisos(): Promise<boolean> {
  try {
    const actual = await Notifications.getPermissionsAsync();
    if (actual.granted) return true;
    if (!actual.canAskAgain) return false;
    const nuevo = await Notifications.requestPermissionsAsync();
    return nuevo.granted;
  } catch {
    return false;
  }
}

export async function cancelarAvisos(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );
}

/**
 * Programa los avisos futuros del evento y devuelve los ids creados. Sin
 * permiso de notificaciones no programa nada (devuelve []).
 */
export async function programarAvisos(
  evento: Pick<Evento, 'nombre' | 'lugar' | 'inicio' | 'avisos'>,
  cuerpo: (aviso: AvisoId) => string,
): Promise<string[]> {
  const pendientes = avisosPendientes(evento.inicio, evento.avisos, new Date());
  if (pendientes.length === 0) return [];
  if (!(await pedirPermisoAvisos())) return [];
  const ids: string[] = [];
  for (const { aviso, fecha } of pendientes) {
    try {
      ids.push(await Notifications.scheduleNotificationAsync({
        content: {
          title: evento.nombre,
          body: cuerpo(aviso),
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fecha },
      }));
    } catch { /* un aviso que falle no impide los demás */ }
  }
  return ids;
}
