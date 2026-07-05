// Descubrimiento de fuente: el usuario elige primero qué quiere conectar
// (SlotTime o InfoLap), luego intentamos auto-discovery; si falla, la UI
// permite introducir la IP manualmente y reintentar.
//
// SlotTime:
//   • Auto: mDNS `_voltrace-manager._tcp`.
//   • Manual: HTTP a `<host>:3000/api/mobile/races/current`.
//
// InfoLap (Tic Tac Slot):
//   • Auto: broadcast UDP a :4441 (no funciona en iOS sin multicast
//     entitlement → suele caer al manual).
//   • Manual: unicast UDP a `<host>:4441`.

import { Platform } from 'react-native';
import Zeroconf from 'react-native-zeroconf';
import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DataSource, RaceInfo } from './types';
import { InfolapSource } from './InfolapSource';
import { SlotTimeSource, type SlotTimeServerLocation } from './SlotTimeSource';

// iOS NSNetService.resolveWithTimeout en react-native-zeroconf es 5s.
const MDNS_TIMEOUT_MS = 6000;
const MDNS_SERVICE_TYPE = 'voltrace-manager';
// En Android el descubrimiento por defecto (NsdManager) es poco fiable; la
// implementación DNSSD embebida (mdnsresponder de Apple) sí funciona bien.
// En iOS hay una sola implementación nativa, así que dejamos el default.
const MDNS_IMPL = Platform.OS === 'android' ? 'DNSSD' : undefined;

export type SourceKind = 'slottime' | 'infolap';

/**
 * Para SlotTime devolvemos sólo la ubicación del servidor; la app pasará
 * después por RacePicker/TandaPicker antes de crear el `SlotTimeSource`
 * real (porque un servidor puede tener varias carreras activas y cada una
 * varias tandas).
 *
 * Para Infolap no hay multi-carrera ni multi-tanda → devolvemos el source
 * ya conectado y listo para usar.
 */
export type DiscoveryResult =
  | { kind: 'slottime'; server: SlotTimeServerLocation }
  | { kind: 'infolap'; source: DataSource; raceInfo: RaceInfo };

export interface DiscoveryOptions {
  /** Fuente que el usuario eligió en la pantalla de selección. */
  kind: SourceKind;
  /** Si se proporciona, salta el auto-discovery y va directo a este host. */
  manualHost?: string;
}

interface ResolvedService {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
}

// ── Probe mDNS para SlotTime ─────────────────────────────────────────────

function probeSlotTime(): Promise<SlotTimeServerLocation | null> {
  return new Promise((resolve) => {
    const zc = new Zeroconf();
    let settled = false;
    const finish = (server: SlotTimeServerLocation | null) => {
      if (settled) return;
      settled = true;
      // El .d.ts de la librería va por detrás del runtime (no tipa implType).
      try { (zc as unknown as { stop: (i?: string) => void }).stop(MDNS_IMPL); } catch { /* ignore */ }
      try { zc.removeDeviceListeners(); } catch { /* ignore */ }
      resolve(server);
    };

    zc.on('resolved', (svc: ResolvedService) => {
      // Prefer IPv4 numeric address over Bonjour hostname (que en iOS no
      // siempre resuelve, p.ej. hostnames de Windows `DESKTOP-XXX.local`).
      const ip = (svc.addresses ?? []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      const host = ip ?? svc.host;
      if (host && svc.port) finish({ host, port: svc.port });
    });

    zc.on('error', () => { /* swallow — caemos al timeout */ });

    try {
      (zc as unknown as { scan: (t: string, p: string, d: string, i?: string) => void })
        .scan(MDNS_SERVICE_TYPE, 'tcp', 'local.', MDNS_IMPL);
    } catch {
      finish(null);
      return;
    }

    setTimeout(() => finish(null), MDNS_TIMEOUT_MS);
  });
}

// ── Fallback: subnet scan ────────────────────────────────────────────────
// iOS Bonjour falla resolviendo hostnames Windows (`DESKTOP-XXX.local`)
// — el browse encuentra el servicio pero `resolveWithTimeout` muere con
// NSNetServicesTimeoutError. Cuando esto pasa, escaneamos 1-254 del
// subnet local en paralelo, pidiendo `/api/mobile/races/active` en
// :3000. El primero que responde 2xx es el servidor.

const SCAN_PORT_DEFAULT = 3000;
const SCAN_PROBE_TIMEOUT_MS = 900;   // por IP; antes 1500 → el barrido se rinde antes
// IP del último servidor PitWall al que conectamos. En redes de club el mDNS
// suele estar filtrado y el server puede estar en otra subred, pero el unicast
// directo a una IP conocida sí funciona — así que la probamos primero.
const LAST_HOST_KEY = '@pitwall/slottime/last-host';

/** IP del último servidor PitWall al que conectamos (o null). La usan el
 *  histórico y otras pantallas para hablar con el servidor sin re-descubrir. */
export async function getCachedHost(): Promise<string | null> {
  try { return await AsyncStorage.getItem(LAST_HOST_KEY); } catch { return null; }
}

async function probeCachedHost(): Promise<SlotTimeServerLocation | null> {
  try {
    const host = await AsyncStorage.getItem(LAST_HOST_KEY);
    if (!host) return null;
    if (await probeHttpHost(host, SCAN_PORT_DEFAULT)) {
      console.log('[Discovery] cached host respondió', host);
      return { host, port: SCAN_PORT_DEFAULT };
    }
  } catch { /* ignore */ }
  return null;
}

async function probeHttpHost(host: string, port: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCAN_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${host}:${port}/api/mobile/races/active`, {
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function scanSubnetForSlotTime(): Promise<SlotTimeServerLocation | null> {
  let ip: string;
  try {
    ip = await Network.getIpAddressAsync();
  } catch {
    return null;
  }
  // Skip if not on a private LAN (e.g. cellular or 169.254 link-local).
  if (!/^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\./.test(ip)) {
    console.log('[Discovery] subnet scan skipped, local IP not LAN:', ip);
    return null;
  }
  const parts = ip.split('.');
  const subnet = parts.slice(0, 3).join('.');
  const myLast = parseInt(parts[3] ?? '', 10);
  console.log('[Discovery] subnet scan on', subnet + '.0/24');

  // Barrido de las 254 IPs por HTTP, con concurrencia limitada (lanzar las
  // 254 a la vez satura el stack de red en Android y la buena se queda sin
  // turno antes del timeout). Nos quedamos con el primero que responda.
  const order: number[] = [];
  for (let i = 1; i <= 254; i++) if (i !== myLast) order.push(i);

  const CONCURRENCY = 32;
  return new Promise<SlotTimeServerLocation | null>((resolve) => {
    let idx = 0, active = 0, remaining = order.length, settled = false;
    const pump = () => {
      if (settled) return;
      while (active < CONCURRENCY && idx < order.length) {
        const host = `${subnet}.${order[idx++]}`;
        active++;
        probeHttpHost(host, SCAN_PORT_DEFAULT).then((ok) => {
          active--; remaining--;
          if (settled) return;
          if (ok) {
            settled = true;
            console.log('[Discovery] subnet scan found SlotTime at', host);
            resolve({ host, port: SCAN_PORT_DEFAULT });
          } else if (remaining === 0) {
            settled = true;
            resolve(null);
          } else {
            pump();
          }
        });
      }
    };
    pump();
  });
}

// Resuelve con el primer resultado no-null de varias promesas; null si todas
// son null. No corta las demás (se ignoran al estar ya resuelto).
function firstNonNull<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = promises.length;
    let settled = false;
    for (const p of promises) {
      p.then((v) => {
        if (settled) return;
        if (v) { settled = true; resolve(v); }
        else if (--pending === 0) resolve(null);
      }).catch(() => { if (!settled && --pending === 0) resolve(null); });
    }
  });
}

// ── Orquestador ──────────────────────────────────────────────────────────

export async function discover(opts: DiscoveryOptions): Promise<DiscoveryResult | null> {
  if (opts.kind === 'slottime') {
    // mDNS y subnet scan en PARALELO: el primero que encuentre el servidor
    // gana. Así no dependemos de que el mDNS funcione (falla en Android) ni
    // esperamos su timeout antes de barrer la subred.
    // En PARALELO: IP recordada + mDNS + barrido de subred. El primero que
    // encuentre el servidor gana. La IP recordada es la que salva las redes de
    // club (mDNS filtrado / otra subred): un único unicast a un host conocido.
    const server: SlotTimeServerLocation | null = opts.manualHost
      ? { host: opts.manualHost, port: 3000 }
      : await firstNonNull([probeCachedHost(), probeSlotTime(), scanSubnetForSlotTime()]);
    if (!server) return null;

    // Smoke-test: comprueba que /api/mobile/races/active responde 2xx.
    // Si responde, el servidor está vivo y la app móvil podrá listar las
    // carreras desde RacePickerScreen.
    try {
      const url = `http://${server.host}:${server.port}/api/mobile/races/active`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log('[Discovery] SlotTime smoke-test failed:', res.status);
        return null;
      }
    } catch (e) {
      console.log('[Discovery] SlotTime unreachable:', (e as Error)?.message);
      return null;
    }
    // Recordar esta IP para la próxima vez (reconexión directa, sin barrido).
    void AsyncStorage.setItem(LAST_HOST_KEY, server.host).catch(() => {});
    return { kind: 'slottime', server };
  }

  // kind === 'infolap'
  const src = new InfolapSource(opts.manualHost ? { manualHost: opts.manualHost } : {});
  try {
    const raceInfo = await src.connect();
    return { kind: 'infolap', source: src, raceInfo };
  } catch (e) {
    console.log('[Discovery] InfoLap connect failed:', (e as Error)?.message);
    src.disconnect();
    return null;
  }
}
