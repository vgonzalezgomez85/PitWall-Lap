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

/** En Android se busca con las DOS implementaciones a la vez (NSD del sistema
 *  y DNSSD embebido): con algunos routers una no ve los anuncios de un iPhone
 *  y la otra sí. La librería las mantiene separadas, así que pueden convivir. */
const IMPLS_BUSQUEDA: (string | undefined)[] = Platform.OS === 'android' ? ['DNSSD', 'NSD'] : [undefined];

/** Lo que va viendo la búsqueda, para diagnosticar a distancia. */
export interface DiagnosticoBusqueda {
  /** Anuncios de sala oídos (aunque aún no se sepa su IP). */
  oidos: number;
  /** Anuncios resueltos con dirección. */
  resueltos: number;
  /** Último error de la librería, si lo hubo. */
  error: string | null;
}

/** Estado del anuncio de la sala propia: `null` mientras se publica. */
export type EstadoAnuncio = { ok: true } | { ok: false; error: string } | null;

export interface SalaDescubierta {
  host: string;
  puerto: number;
  codigo: string;
  nombre: string;
}

/** Publica una sala (lado asistente). `onEstado` avisa de si el anuncio
 *  quedó visible en la red o falló (antes fallaba en silencio). Devuelve el
 *  modo de detenerlo. */
export function publicarSala(
  codigo: string,
  onEstado: (e: EstadoAnuncio) => void = () => {},
): { detener: () => void } {
  const zc = new Zeroconf();
  zc.on('published' as never, () => onEstado({ ok: true }));
  zc.on('error', (err) => onEstado({ ok: false, error: err instanceof Error ? err.message : String(err) }));
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
  } catch (e) {
    // La sala funciona igual; solo se pierde el descubrimiento.
    onEstado({ ok: false, error: e instanceof Error ? e.message : String(e) });
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
 * resuelta (puede repetirse al refrescar el anuncio); `onDiagnostico`, con lo
 * que se va oyendo. Devuelve el modo de detener la búsqueda.
 */
export function buscarSalas(
  onSala: (sala: SalaDescubierta) => void,
  onDiagnostico: (d: DiagnosticoBusqueda) => void = () => {},
): { detener: () => void } {
  const zc = new Zeroconf();
  const vistos = new Set<string>();
  const oidos = new Set<string>();
  const diag: DiagnosticoBusqueda = { oidos: 0, resueltos: 0, error: null };
  const avisar = () => onDiagnostico({ ...diag });

  zc.on('found', (nombre) => {
    if (oidos.has(nombre)) return;
    oidos.add(nombre);
    diag.oidos = oidos.size;
    avisar();
  });

  zc.on('error', (err) => {
    diag.error = err instanceof Error ? err.message : String(err);
    avisar();
  });

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
    if (servicio.name) oidos.add(servicio.name);
    diag.oidos = oidos.size;
    diag.resueltos = vistos.size;
    avisar();
    onSala({
      host,
      puerto: PUERTO_RADIO,
      codigo,
      nombre: servicio.name ?? `Radio ${codigo}`,
    });
  });

  const z = zc as unknown as {
    scan: (t: string, p: string, d: string, i?: string) => void;
    stop: (i?: string) => void;
  };
  for (const impl of IMPLS_BUSQUEDA) {
    try {
      z.scan(RADIO_SERVICIO, 'tcp', 'local.', impl);
    } catch (e) {
      diag.error = e instanceof Error ? e.message : String(e);
      avisar();
    }
  }

  return {
    detener() {
      for (const impl of IMPLS_BUSQUEDA) {
        try { z.stop(impl); } catch { /* ignore */ }
      }
      try { zc.removeDeviceListeners(); } catch { /* ignore */ }
    },
  };
}
