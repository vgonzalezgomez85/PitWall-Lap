// Cliente Infolap (Tic Tac Slot) — fallback cuando no se encuentra SlotTime.
//
// Protocolo (ingeniería inversa, ver memoria project_infolap_protocol.md):
//   • Descubrimiento: cliente broadcast UDP a 255.255.255.255:4441 cada 2 s
//     payload "InfoLap:CXXX". Servidor responde a <cliente>:12543 con
//     "OK Piloto 1;#001Piloto 2;#002..." (lista lanes).
//   • Estado en vivo: tras discovery el servidor empuja paquetes 52-byte
//     UDP, uno por carril, ciclando ~830 ms entre paquetes. Cliente NO envía
//     nada más después del primer probe.
//
// Capacidades: sólo tiempo por vuelta. Sin posición/gap/avisos de fin/
// histórico (la matriz completa está en types.ts).

import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import * as Network from 'expo-network';

import type {
  DataSource,
  LiveState,
  Participant,
  RaceInfo,
  RaceStatsSnapshot,
  SourceEvent,
} from './types';
import { INFOLAP_CAPABILITIES, emptyLiveState } from './types';
import { decodeLapField } from './infolapDecode';

const SERVER_PORT = 4441;
const CLIENT_PORT = 12543;
const PROBE_INTERVAL_MS = 2000;
const PROBE_TIMEOUT_MS  = 6000;

// El Gestor de Carreras de Tic Tac Slot rechaza silenciosamente los probes
// cuyo identificador `Cxxx` no coincide con el último octeto de la IP del
// cliente. Calculamos el ID exacto a partir de la IP local
// (vía expo-network); si por algún motivo no hay IP (web/sim), caemos a
// brute force de los 254 IDs como fallback.
function buildProbe(lastOctet: number): Buffer {
  return Buffer.from(`InfoLap:C${String(lastOctet).padStart(3, '0')}`, 'ascii');
}
const BRUTE_FORCE_PROBES: Buffer[] = [];
for (let i = 1; i <= 254; i++) BRUTE_FORCE_PROBES.push(buildProbe(i));

// ── Parsers puros (testables sin red) ─────────────────────────────────────

/** Parsea el payload de discovery `"OK <name>;#<id>..."`. */
export function parseDiscoveryResponse(payload: string): Participant[] {
  if (!payload.startsWith('OK ')) return [];
  const body = payload.slice(3);
  // Entries son `<name>;#<id>` concatenadas sin separador entre entries; el
  // `;#` actúa como delimitador interno.
  const re = /([^]+?);#(\d+)/g;
  const out: Participant[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({ id: `#${m[2]}`, name: m[1]!.trim() });
  }
  return out;
}

export interface InfolapStatePacket {
  sequence: number;        // pos 0-3
  lane: number;            // pos 4
  driverName: string;      // pos 5-24 (trimmed)
  lastLapMs: number | null;
  /** "1" = primer reporte tras vuelta nueva; "X" = idle. */
  isNewLap: boolean;       // pos 44
  laneCode: number;        // pos 45-47
}

export function parseStatePacket(buf: Uint8Array): InfolapStatePacket | null {
  if (buf.length !== 52) return null;
  const s = Buffer.from(buf).toString('ascii');
  const sequence = parseInt(s.slice(0, 4), 10);
  const lane = parseInt(s.slice(4, 5), 10);
  const driverName = s.slice(5, 25).trimEnd();
  const timeField = s.slice(30, 37);
  const lastLapMs = decodeLapField(timeField);
  const isNewLap = s[44] === '1';
  const laneCode = parseInt(s.slice(45, 48), 10);
  if (Number.isNaN(sequence) || Number.isNaN(lane) || Number.isNaN(laneCode)) {
    return null;
  }
  return { sequence, lane, driverName, lastLapMs, isNewLap, laneCode };
}

// ── Fuente ────────────────────────────────────────────────────────────────

interface UdpSocket {
  bind: (port: number, cb?: () => void) => void;
  setBroadcast: (flag: boolean) => void;
  send: (
    buf: Buffer, offset: number, length: number,
    port: number, host: string, cb?: (err?: Error) => void
  ) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  close: (cb?: () => void) => void;
}

export interface InfolapOptions {
  /**
   * Si se proporciona, salta los broadcasts y manda UNICAST al host indicado.
   * Útil en iOS sin multicast entitlement (los broadcasts UDP fallan
   * silenciosamente). El usuario teclea la IP del PC manualmente.
   */
  manualHost?: string;
}

export class InfolapSource implements DataSource {
  readonly kind = 'infolap' as const;

  private opts: InfolapOptions;
  private socket: UdpSocket | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private selectedLane: number | null = null;
  /** Probes a enviar cada PROBE_INTERVAL_MS. Lista pequeña (1) si hemos
   *  resuelto nuestra IP local; o lista completa de 254 si no. */
  private probePayloads: Buffer[] = BRUTE_FORCE_PROBES;
  private stateListeners: ((s: LiveState) => void)[] = [];
  private eventListeners: ((e: SourceEvent) => void)[] = [];
  private currentState: LiveState = emptyLiveState();

  /** lane → último tiempo visto (para detectar cuándo cambia). */
  private laneLastMs = new Map<number, number | null>();
  /** lane → última secuencia procesada. Sirve para deduplicar paquetes
   *  duplicados (cuando el brute force genera 254 phantom clients y el
   *  Gestor reenvía el mismo estado N veces) y para contar vueltas con
   *  tiempo idéntico (cada vuelta nueva trae seq nuevo aunque el ms no
   *  cambie). */
  private laneLastSeq = new Map<number, number>();
  /** lane → contador de vueltas que hemos visto cambiar. */
  private laneLapCount = new Map<number, number>();
  /** lane → nombre del piloto (de los paquetes de estado). */
  private laneName = new Map<number, string>();
  /** lane → suma de todos los tiempos de vuelta vistos (para la media). */
  private laneSumMs = new Map<number, number>();
  /** participantes resueltos en el discovery, en orden. */
  private participants: Participant[] = [];

  /** Carril del rival que se está siguiendo, o null. */
  private rivalLane: number | null = null;

  constructor(opts: InfolapOptions = {}) {
    this.opts = opts;
  }

  async connect(): Promise<RaceInfo> {
    console.log('[Infolap] connect() start');

    // Detectar la IP local del dispositivo para mandar SÓLO el probe con
    // el `Cxxx` que matcheará el filtro del Gestor — sin esto el server
    // ve 254 phantom clients. Si no podemos detectarla (red rara, fallo),
    // caemos a brute force.
    try {
      const ip = await Network.getIpAddressAsync();
      const lastOctet = parseInt(ip.split('.').pop() ?? '', 10);
      if (Number.isFinite(lastOctet) && lastOctet >= 1 && lastOctet <= 254) {
        this.probePayloads = [buildProbe(lastOctet)];
        console.log('[Infolap] local IP', ip, '→ probe ID C' + String(lastOctet).padStart(3, '0'));
      } else {
        console.log('[Infolap] could not parse last octet from IP', ip, '→ brute force');
      }
    } catch (e) {
      console.log('[Infolap] getIpAddressAsync failed → brute force:', e);
    }

    return new Promise<RaceInfo>((resolve, reject) => {
      let resolved = false;
      const sock = (dgram as unknown as {
        createSocket: (o: { type: string }) => UdpSocket;
      }).createSocket({ type: 'udp4' });
      this.socket = sock;

      const timeout = setTimeout(() => {
        if (!resolved) {
          console.log('[Infolap] discovery TIMEOUT after', PROBE_TIMEOUT_MS, 'ms');
          this.disconnect();
          reject(new Error('infolap-discovery-timeout'));
        }
      }, PROBE_TIMEOUT_MS);

      sock.on('error', (err) => {
        console.log('[Infolap] socket error:', err);
        if (!resolved) {
          clearTimeout(timeout);
          this.disconnect();
          reject(err as Error);
        }
      });

      sock.on('message', (msg, rinfo) => {
        const buf = msg as Uint8Array;
        console.log('[Infolap] msg len=', buf.length, 'from', rinfo);
        // Distinguimos discovery response ("OK …") vs state packet (52 bytes).
        if (buf.length >= 3 && buf[0] === 0x4f && buf[1] === 0x4b && buf[2] === 0x20) {
          const text = Buffer.from(buf).toString('ascii');
          console.log('[Infolap] discovery payload:', text);
          if (!resolved) {
            const participants = parseDiscoveryResponse(text);
            console.log('[Infolap] parsed', participants.length, 'participants');
            if (participants.length > 0) {
              resolved = true;
              clearTimeout(timeout);
              this.participants = participants;
              resolve(this.buildRaceInfo());
              return;
            }
          }
          // Discovery responses subsiguientes: ignorar, ya estamos conectados.
          return;
        }
        if (buf.length === 52) {
          const pkt = parseStatePacket(buf);
          if (pkt) this.ingestPacket(pkt);
        }
      });

      sock.bind(CLIENT_PORT, () => {
        console.log('[Infolap] bound on :', CLIENT_PORT);
        sock.setBroadcast(true);
        this.sendProbe();
        this.probeTimer = setInterval(() => this.sendProbe(), PROBE_INTERVAL_MS);
      });
    });
  }

  disconnect(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
    this.stateListeners = [];
    this.eventListeners = [];
    this.laneLastMs.clear();
    this.laneLastSeq.clear();
    this.laneLapCount.clear();
    this.laneName.clear();
    this.laneSumMs.clear();
    this.rivalLane = null;
  }

  selectParticipant(id: string): void {
    // En Infolap el id es "#NNN" y se asume que el orden de discovery
    // corresponde 1:1 con los carriles (Piloto 1 → lane 1, etc.). Buscamos
    // el índice del participante elegido y usamos lane = idx + 1.
    const idx = this.participants.findIndex(p => p.id === id);
    this.selectedLane = idx >= 0 ? idx + 1 : null;
    // Al cambiar de piloto propio dejamos de seguir al rival anterior.
    this.rivalLane = null;
    // Resetear estado: ahora pintamos sólo lo del carril seleccionado.
    const lapCount = this.laneLapCount.get(this.selectedLane ?? -1) ?? 0;
    const lastLapMs = this.laneLastMs.get(this.selectedLane ?? -1) ?? null;
    const myName = this.participants.find(p => p.id === id)?.name ?? null;
    this.currentState = {
      ...emptyLiveState(),
      status: 'my-turn',
      myLane: this.selectedLane,
      lapCount,
      lastLapMs,
      bestLapMs: null,
      totalParticipants: this.participants.length,
    };
    void myName;
    this.emitState();
  }

  /** Seguir (o dejar de seguir) a otro piloto para los avisos de gap. */
  setRival(id: string | null): void {
    if (id == null) {
      this.rivalLane = null;
    } else {
      const idx = this.participants.findIndex(p => p.id === id);
      this.rivalLane = idx >= 0 ? idx + 1 : null;
    }
    this.applyRivalToState();
    this.emitState();
  }

  /** Media de los tiempos de vuelta vistos para un carril, o null. */
  private laneAvgMs(lane: number): number | null {
    const count = this.laneLapCount.get(lane) ?? 0;
    const sum = this.laneSumMs.get(lane) ?? 0;
    return count > 0 ? sum / count : null;
  }

  /** Recalcula los campos del rival en `currentState` (sin emitir). */
  private applyRivalToState(): void {
    const myLane = this.selectedLane;
    const rLane = this.rivalLane;
    if (myLane == null || rLane == null) {
      this.currentState = {
        ...this.currentState,
        rivalName: null, rivalGapMs: null, rivalLapCount: null,
      };
      return;
    }
    const myCount = this.laneLapCount.get(myLane) ?? 0;
    const rivalCount = this.laneLapCount.get(rLane) ?? 0;
    // Ritmo de referencia para traducir vueltas a tiempo: media de las
    // medias disponibles; si aún no hay media, el último tiempo visto.
    const paces = [this.laneAvgMs(myLane), this.laneAvgMs(rLane)]
      .filter((p): p is number => p != null);
    const pace: number | null = paces.length
      ? paces.reduce((a, b) => a + b, 0) / paces.length
      : (this.laneLastMs.get(myLane) ?? this.laneLastMs.get(rLane) ?? null);
    const gapMs = pace != null ? (myCount - rivalCount) * pace : null;
    const rivalName = this.laneName.get(rLane)
      ?? this.participants[rLane - 1]?.name ?? `Carril ${rLane}`;
    this.currentState = {
      ...this.currentState,
      rivalName,
      rivalGapMs: gapMs,
      rivalLapCount: rivalCount,
    };
  }

  onStateChange(cb: (s: LiveState) => void): () => void {
    this.stateListeners.push(cb);
    cb(this.currentState);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb);
    };
  }

  onEvent(cb: (e: SourceEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  onRaceStatsSnapshot(_cb: (snapshot: RaceStatsSnapshot) => void): () => void {
    // Infolap no emite snapshot al final de carrera. Callback nunca se llama.
    return () => {};
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private sendProbe(): void {
    const sock = this.socket;
    if (!sock) {
      console.log('[Infolap] sendProbe: no socket');
      return;
    }
    const targets = this.opts.manualHost
      ? [this.opts.manualHost]
      : ['255.255.255.255', '192.168.10.255', '192.168.1.255', '192.168.0.255', '192.168.115.255'];
    console.log('[Infolap] sendProbe →', targets.length, 'host(s) x',
      this.probePayloads.length, 'ID(s)', this.opts.manualHost ? '(unicast)' : '(broadcast)');
    for (const host of targets) {
      for (const payload of this.probePayloads) {
        sock.send(payload, 0, payload.length, SERVER_PORT, host);
      }
    }
  }

  private buildRaceInfo(): RaceInfo {
    return {
      source: 'infolap',
      name: 'InfoLap',
      format: 'individual',
      participants: this.participants,
      capabilities: INFOLAP_CAPABILITIES,
    };
  }

  private ingestPacket(pkt: InfolapStatePacket): void {
    if (pkt.driverName) this.laneName.set(pkt.lane, pkt.driverName);

    // Sentinel "EF54AB1" → carril sin vuelta válida todavía. Ignorar.
    if (pkt.lastLapMs === null) return;

    // Cada paquete del Gestor para un carril trae un sequence counter único.
    // Una vuelta nueva → sequence nuevo (aunque el tiempo en ms sea idéntico
    // al de la vuelta anterior). Paquetes con el mismo sequence son
    // duplicados (resultado de los 254 phantom clients del brute force).
    const prevSeq = this.laneLastSeq.get(pkt.lane);
    if (prevSeq === pkt.sequence) return;   // duplicado → ignorar
    this.laneLastSeq.set(pkt.lane, pkt.sequence);

    this.laneLastMs.set(pkt.lane, pkt.lastLapMs);
    const newCount = (this.laneLapCount.get(pkt.lane) ?? 0) + 1;
    this.laneLapCount.set(pkt.lane, newCount);
    this.laneSumMs.set(pkt.lane, (this.laneSumMs.get(pkt.lane) ?? 0) + pkt.lastLapMs);

    if (this.selectedLane === pkt.lane) {
      const best = this.currentState.bestLapMs;
      const newBest = best === null || pkt.lastLapMs < best ? pkt.lastLapMs : best;
      this.currentState = {
        ...this.currentState,
        lapCount: newCount,
        lastLapMs: pkt.lastLapMs,
        bestLapMs: newBest,
      };
      this.applyRivalToState();
      this.emitState();
      this.emitEvent({ type: 'lap-completed', lapTimeMs: pkt.lastLapMs, lapCount: newCount });
    } else if (this.rivalLane === pkt.lane) {
      // El rival ha cruzado: actualizar el gap aunque no sea mi carril.
      this.applyRivalToState();
      this.emitState();
    }
  }

  private emitState(): void {
    for (const l of this.stateListeners) l(this.currentState);
  }

  private emitEvent(e: SourceEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}
