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

import Zeroconf from 'react-native-zeroconf';
import * as Network from 'expo-network';

import type { DataSource, RaceInfo } from './types';
import { InfolapSource } from './InfolapSource';
import { SlotTimeSource, type SlotTimeServerLocation } from './SlotTimeSource';

// iOS NSNetService.resolveWithTimeout en react-native-zeroconf es 5s.
const MDNS_TIMEOUT_MS = 6000;
const MDNS_SERVICE_TYPE = 'voltrace-manager';

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
      try { zc.stop(); } catch { /* ignore */ }
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
      zc.scan(MDNS_SERVICE_TYPE, 'tcp', 'local.');
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
const SCAN_PROBE_TIMEOUT_MS = 1500;

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

  // Lanzamos los 254 probes en paralelo y nos quedamos con el primero
  // que responda. Damos prioridad a IPs típicas de servidores (1-30, 99-110)
  // resolviendo primero la promesa de las menores.
  const order: number[] = [];
  for (let i = 1; i <= 254; i++) if (i !== myLast) order.push(i);

  return new Promise<SlotTimeServerLocation | null>((resolve) => {
    let pending = order.length;
    let settled = false;
    for (const i of order) {
      const host = `${subnet}.${i}`;
      probeHttpHost(host, SCAN_PORT_DEFAULT).then((ok) => {
        if (settled) return;
        if (ok) {
          settled = true;
          console.log('[Discovery] subnet scan found SlotTime at', host);
          resolve({ host, port: SCAN_PORT_DEFAULT });
        } else if (--pending === 0) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

// ── Orquestador ──────────────────────────────────────────────────────────

export async function discover(opts: DiscoveryOptions): Promise<DiscoveryResult | null> {
  if (opts.kind === 'slottime') {
    let server: SlotTimeServerLocation | null = opts.manualHost
      ? { host: opts.manualHost, port: 3000 }
      : await probeSlotTime();
    // Fallback: si mDNS no resolvió (típico iOS con hostnames Windows),
    // probamos un scan del subnet local en HTTP:3000.
    if (!server && !opts.manualHost) {
      console.log('[Discovery] mDNS failed → trying subnet scan');
      server = await scanSubnetForSlotTime();
    }
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
