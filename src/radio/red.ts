// Descubrimiento de salas por la red local (Fase 1). El móvil del asistente
// publica su sala con mDNS/Bonjour y los participantes la descubren sin tener
// que teclear la IP. El tipo de servicio es `_pitwall-radio._tcp`.
//
// react-native-zeroconf ya está instalado (tipos en src/data/zeroconf.d.ts).

import { Platform } from 'react-native';
import Zeroconf from 'react-native-zeroconf';
import { PUERTO_RADIO } from './tcp';

export const RADIO_SERVICIO = 'pitwall-radio';

// En Android el descubrimiento por defecto (NsdManager) es poco fiable: a
// menudo resuelve el anuncio con el host vacío o un hostname `.local` que no
// resuelve, y la sala «se ve» pero la conexión TCP no llega. La implementación
// DNSSD (mDNSResponder de Apple embebido) sí entrega la IPv4 numérica, como ya
// hace discovery.ts para PitWall. En iOS hay una sola implementación nativa,
// así que dejamos el default (undefined).
const IMPL_MDNS = Platform.OS === 'android' ? 'DNSSD' : undefined;

export interface SalaDescubierta {
  host: string;
  puerto: number;
  codigo: string;
  nombre: string;
}

/** Publica una sala (lado asistente). Devuelve el modo de detenerlo. */
export function publicarSala(codigo: string): { detener: () => void } {
  const zc = new Zeroconf();
  try {
    // Cast: el .d.ts va por detrás del runtime (no tipa implType). En iOS
    // publishService ignora el 7.º argumento.
    (zc as unknown as { publishService: (t: string, p: string, d: string, n: string, port: number, txt?: Record<string, string>, impl?: string) => void })
      .publishService(
        RADIO_SERVICIO,
        'tcp',
        'local.',
        `Radio ${codigo}`,
        PUERTO_RADIO,
        { codigo },
        IMPL_MDNS,
      );
  } catch {
    /* la sala funciona igual; solo se pierde el descubrimiento */
  }
  return {
    detener() {
      try {
        (zc as unknown as { stop: (i?: string) => void }).stop(IMPL_MDNS);
        zc.removeDeviceListeners();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Busca salas en la red (lado participante). `onSala` se llama por cada sala
 * resuelta (puede repetirse al refrescar el anuncio). Devuelve el modo de
 * detener la búsqueda.
 */
export function buscarSalas(onSala: (sala: SalaDescubierta) => void): { detener: () => void } {
  const zc = new Zeroconf();
  const vistos = new Set<string>();

  zc.on('resolved', (servicio) => {
    // El anuncio trae la IP del asistente; el puerto es el fijo de Radio.
    // Preferimos la IPv4 numérica: el hostname Bonjour (`XXX.local`) no
    // siempre resuelve (igual que en discovery.ts para PitWall).
    const ip = (servicio.addresses ?? []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    const host = ip ?? servicio.host;
    if (!host) return;
    const codigo = String(servicio.txt?.codigo ?? '');
    const clave = `${host}:${codigo}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    onSala({
      host,
      puerto: PUERTO_RADIO,
      codigo,
      nombre: servicio.name ?? `Radio ${codigo}`,
    });
  });

  try {
    (zc as unknown as { scan: (t: string, p: string, d: string, i?: string) => void })
      .scan(RADIO_SERVICIO, 'tcp', 'local.', IMPL_MDNS);
  } catch {
    /* ignore */
  }

  return {
    detener() {
      try {
        (zc as unknown as { stop: (i?: string) => void }).stop(IMPL_MDNS);
        zc.removeDeviceListeners();
      } catch {
        /* ignore */
      }
    },
  };
}
