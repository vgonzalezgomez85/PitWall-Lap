// Cliente Infolap (Tic Tac Slot) — fallback cuando no se encuentra PitWall.
//
// Protocolo (ingeniería inversa, ver memoria project_infolap_protocol.md):
//   • Descubrimiento: cliente broadcast UDP a 255.255.255.255:4441 cada 2 s
//     payload "InfoLap:CXXX". Servidor responde a <cliente>:12543 con
//     "OK Piloto 1;#001Piloto 2;#002..." (lista lanes).
//   • Estado en vivo: tras discovery el servidor empuja paquetes 52-byte
//     UDP, uno por carril, ciclando ~830 ms entre paquetes. Cliente NO envía
//     nada más después del primer probe.
//
// TicTac nuevo (2026): el descubrimiento es idéntico, pero el estado ya no
// llega por UDP sino por un WebSocket TLS en wss://<pc>:12543/ con mensajes
// JSON (ver infolapWss.ts). Tras el "OK" intentamos abrir ese WSS: si
// conecta usamos el protocolo nuevo; si no, seguimos con el UDP de siempre.
//
// Capacidades: protocolo antiguo, sólo tiempo por vuelta. Protocolo nuevo,
// casi lo mismo que PitWall: posición y gaps (el TicTac), más lo que aquí se
// calcula en cliente — media de carril, gaps en vueltas, tiempo restante y
// avisos de fin (con la duración de manga que configura el usuario),
// proyección, media para subir y dossier para el histórico (infolapRace.ts).
// No hay salidas, pit stops, plan de mangas ni pole: el TicTac no los manda.

import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  DataSource,
  LiveState,
  Participant,
  ProjectionRow,
  RaceInfo,
  RaceStatsSnapshot,
  SourceEvent,
} from './types';
import { INFOLAP_CAPABILITIES, INFOLAP_WSS_CAPABILITIES, emptyLiveState } from './types';
import { decodeLapField } from './infolapDecode';
import {
  INFOLAP_WSS_PORT, parseWsMessage, standingForLane, standingOf,
  type InfolapConfigMessage, type InfolapLapMessage, type InfolapRival,
  type InfolapRivalsMessage, type InfolapStanding,
} from './infolapWss';
import {
  buildProjection, buildSnapshot, catchUpPaceMs, gapMsToLaps, normName, statsAvgMs,
  type PilotStats,
} from './infolapRace';
import { loadMangaDurationMin } from './infolapSettings';
import { openInfolapWs, type InfolapWsConnection } from '../../modules/infolapws';

const SERVER_PORT = 4441;
const CLIENT_PORT = 12543;
// IP del último servidor TicTac al que conectamos. En iOS el escaneo de la
// subred lo bloquea el SO (anti-port-scan), así que en automático probamos
// PRIMERO esta IP recordada como un único unicast (que sí funciona).
const LAST_HOST_KEY = '@pitwall/infolap/last-host';
const PROBE_INTERVAL_MS = 2000;
// El barrido unicast suave necesita margen para recorrer la subred (en iOS
// hay que ir despacio para que no se pierda la respuesta del servidor).
const PROBE_TIMEOUT_MS  = 11000;

// El Gestor de Carreras de Tic Tac Slot rechaza silenciosamente los probes
// cuyo identificador `Cxxx` no coincide con el último octeto de la IP del
// cliente. Calculamos el ID a partir de la IP local (vía expo-network) y
// enviamos un único probe. Pero esa IP no siempre es la correcta — p.ej.
// un iPhone que comparte su Personal Hotspot estando en 4G devuelve la IP
// celular, no la 172.20.10.x de la red local. Por eso, si el probe único
// no obtiene respuesta, escalamos a un barrido de los 254 IDs. En cuanto
// llega la respuesta de discovery se deja de sondear (el protocolo no
// requiere más probes), así que el barrido es momentáneo.
function buildProbe(lastOctet: number): Buffer {
  return Buffer.from(`InfoLap:C${String(lastOctet).padStart(3, '0')}`, 'ascii');
}
const BRUTE_FORCE_PROBES: Buffer[] = [];
for (let i = 1; i <= 254; i++) BRUTE_FORCE_PROBES.push(buildProbe(i));
// Si el probe único no responde en este plazo, escalamos al barrido.
const PROBE_ESCALATE_MS = 2500;
// Fallback (sobre todo iOS): si el "OK" de discovery se pierde pero el
// servidor ya nos empuja paquetes de estado, resolvemos con los nombres que
// vengan en el estado tras recolectar este plazo.
const STATE_RESOLVE_MS = 1200;
// TicTac nuevo: plazo para que abra el WSS tras el "OK". Un TicTac antiguo no
// escucha en TCP 12543 y rechaza al instante; el plazo cubre un firewall que
// descarte la conexión en silencio.
const WSS_OPEN_TIMEOUT_MS = 2500;
const WSS_RECONNECT_MS = 2000;
// "Test de transmisión" del TicTac envía 100 vueltas falsas de 0,001–0,1 s
// al carril 1. Ninguna vuelta real de slot baja de esto.
const MIN_WSS_LAP_MS = 500;
const LAST_MINUTE_MS = 60_000;
const LAST_30S_MS = 30_000;

// ── Parsers puros (testables sin red) ─────────────────────────────────────

/**
 * Parsea el payload de discovery del Gestor Tic Tac Slot.
 *
 * Formato real (capturado): `"OK <n1>;#<id1><n2>;#<id2>..."` — entries
 * `<nombre>;#<id>` concatenadas SIN separador, y el id es de EXACTAMENTE
 * 3 dígitos. Ej.: `OK 6;#0015;#0024;#0033;#0042;#0051;#006` son 6 pilotos
 * de nombre "6","5","4","3","2","1" con ids 001..006.
 *
 * Es imprescindible fijar el id a `\d{3}`: si el nombre del piloto
 * siguiente es numérico (aquí lo son), un `\d+` codicioso se comería esa
 * cifra y desalinearía toda la lista.
 */
export function parseDiscoveryResponse(payload: string): Participant[] {
  if (!payload.startsWith('OK ')) return [];
  const body = payload.slice(3);
  const re = /([^]+?);#(\d{3})/g;
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
  bind: (port: number, cb?: (err?: unknown) => void) => void;
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
  /** Probes a enviar cada PROBE_INTERVAL_MS. Empieza con un único
   *  `InfoLap:Cxxx` (derivado de la IP local) y escala a los 254 si no
   *  hay respuesta. */
  private probePayloads: Buffer[] = BRUTE_FORCE_PROBES;
  /** Probe con NUESTRO id (un solo payload), para el barrido unicast. */
  private ownProbe: Buffer | null = null;
  /** Hosts de la subred local para el barrido unicast (funciona en iOS,
   *  donde el broadcast UDP está bloqueado sin entitlement multicast). */
  private subnetHosts: string[] = [];
  /** true mientras un barrido unicast por tandas está en curso. */
  private sweeping = false;
  /** true una vez resuelto el descubrimiento (para parar el barrido). */
  private discovered = false;
  /** IP del último servidor (recordada) para probarla primero en auto. */
  private cachedHost: string | null = null;
  /** Si arrancamos el barrido de subred. Con IP recordada esperamos a que
   *  esa falle (evita disparar el anti-escaneo de iOS en el caso normal). */
  private sweepEnabled = false;
  /** IP desde la que respondió el servidor en esta sesión (para recordarla). */
  private serverHost: string | null = null;
  /** WSS del TicTac nuevo (null = protocolo UDP antiguo o reconectando). */
  private wsConn: InfolapWsConnection | null = null;
  /** true si el servidor habla el protocolo nuevo (WSS + JSON). */
  private wssMode = false;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** false tras disconnect(): no reconectar ni procesar nada más. */
  private active = false;
  /** Ya llegó algún CONFIG (inicio de manga) en esta sesión. */
  private configSeen = false;
  /** Duración de manga configurada en la app (el TicTac no la manda). */
  private mangaDurationMs: number | null = null;
  /** Date.now() del CONFIG de la manga en curso (null = no la vimos empezar). */
  private mangaStartAt: number | null = null;
  private mangaTimer: ReturnType<typeof setInterval> | null = null;
  private firedHalf = false;
  private firedLastMinute = false;
  private firedLast30s = false;
  private firedEnd = false;
  /** Acumulado de toda la carrera por piloto (nombre normalizado). */
  private pilotStats = new Map<string, PilotStats>();
  /** Última clasificación oficial recibida (RIVALS_UPDATE). */
  private lastRivals: InfolapRival[] = [];
  private snapshotListeners: ((s: RaceStatsSnapshot) => void)[] = [];
  private sessionStartedAt = new Date();
  private stateListeners: ((s: LiveState) => void)[] = [];
  private eventListeners: ((e: SourceEvent) => void)[] = [];
  private currentState: LiveState = emptyLiveState();

  /** lane → último tiempo visto (para detectar cuándo cambia). */
  private laneLastMs = new Map<number, number | null>();
  /** lane → última secuencia procesada. Sirve para deduplicar paquetes
   *  (el Gestor reenvía cada estado N veces — opción "Reenviar paquetes
   *  de datos") y para contar vueltas con tiempo idéntico (cada vuelta
   *  nueva trae seq nuevo aunque el ms no cambie). */
  private laneLastSeq = new Map<number, number>();
  /** lane → contador de vueltas que hemos visto cambiar. */
  private laneLapCount = new Map<number, number>();
  /** lane → nombre del piloto (de los paquetes de estado). */
  private laneName = new Map<number, string>();
  /** lane → suma de todos los tiempos de vuelta vistos (para la media). */
  private laneSumMs = new Map<number, number>();
  /** lane → wall-clock ms cuando se contó la última vuelta. Sirve para
   *  descartar retransmisiones tardías que llegan con sequence distinto
   *  (el Gestor reenvía cada paquete N veces según su ajuste). */
  private laneLastIngestAt = new Map<number, number>();
  /** participantes resueltos en el discovery, en orden. */
  private participants: Participant[] = [];

  /** Carril del rival que se está siguiendo, o null. */
  private rivalLane: number | null = null;
  /** Nombres del piloto propio y del rival. El carril real se resuelve
   *  emparejando estos nombres con el `driverName` de los paquetes —
   *  el orden de la lista de discovery NO coincide con el nº de carril. */
  private selectedName: string | null = null;
  private rivalSelectedName: string | null = null;
  /** Nº de manga, incrementado en cada rotación de carriles detectada. */
  private mangaCount = 1;

  constructor(opts: InfolapOptions = {}) {
    this.opts = opts;
  }

  async connect(): Promise<RaceInfo> {
    console.log('[Infolap] connect() start');
    this.discovered = false;
    this.sweeping = false;
    this.active = true;
    this.wssMode = false;
    this.configSeen = false;
    this.mangaStartAt = null;
    this.pilotStats.clear();
    this.lastRivals = [];
    this.sessionStartedAt = new Date();
    try {
      const min = await loadMangaDurationMin();
      this.mangaDurationMs = min > 0 ? min * 60_000 : null;
    } catch { /* sin duración */ }

    // Detectar la IP local del dispositivo para el probe único inicial.
    // Si no responde, el escalado de abajo pasa al barrido completo.
    try {
      const ip = await Network.getIpAddressAsync();
      // 169.254.x.x es link-local (p. ej. el iPhone conectado por cable al
      // Mac), no la WiFi: su último octeto daría un ID de probe que el TicTac
      // no reconoce. La tratamos como IP desconocida.
      const lastOctet = ip.startsWith('169.254.')
        ? NaN
        : parseInt(ip.split('.').pop() ?? '', 10);
      if (Number.isFinite(lastOctet) && lastOctet >= 1 && lastOctet <= 254) {
        this.ownProbe = buildProbe(lastOctet);
        this.probePayloads = [this.ownProbe];
        // Hosts de la subred para el barrido unicast (todas menos la nuestra),
        // en orden PRIORIZADO: primero los rangos donde suele estar un servidor
        // (bajos 1-60 y el tramo 100-150) para encontrarlo pronto, luego el resto.
        const subnet = ip.split('.').slice(0, 3).join('.');
        if (/^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\./.test(ip)) {
          const priority = (n: number) => (n <= 60 ? 0 : (n >= 100 && n <= 150) ? 1 : 2);
          const octets: number[] = [];
          for (let i = 1; i <= 254; i++) if (i !== lastOctet) octets.push(i);
          octets.sort((a, b) => priority(a) - priority(b) || a - b);
          this.subnetHosts = octets.map(i => `${subnet}.${i}`);
        }
        console.log('[Infolap] local IP', ip, '→ probe ID C' + String(lastOctet).padStart(3, '0'),
          '· unicast sweep', this.subnetHosts.length, 'hosts');
      } else {
        console.log('[Infolap] could not parse last octet from IP', ip, '→ barrido');
      }
    } catch (e) {
      console.log('[Infolap] getIpAddressAsync failed → barrido:', e);
    }

    // Auto: cargar la IP del último servidor para probarla primero (sortea el
    // bloqueo de escaneo de iOS — un único unicast a un host conocido sí pasa).
    if (!this.opts.manualHost) {
      try {
        this.cachedHost = await AsyncStorage.getItem(LAST_HOST_KEY);
        if (this.cachedHost) console.log('[Infolap] cached host →', this.cachedHost);
      } catch { /* ignore */ }
    }
    // Sin IP recordada barremos desde el principio; con IP recordada esperamos
    // a que esa falle antes de barrer (para no disparar el anti-escaneo iOS).
    this.sweepEnabled = !this.cachedHost;

    return new Promise<RaceInfo>((resolve, reject) => {
      let resolved = false;
      let stateTimer: ReturnType<typeof setTimeout> | null = null;

      // Si la IP recordada no respondió a tiempo, habilitamos el barrido de
      // subred (caso: servidor en otra IP, o primera vez sin caché).
      const escalate = setTimeout(() => {
        if (!resolved && !this.sweepEnabled) {
          console.log('[Infolap] IP recordada sin respuesta → habilitando barrido');
          this.sweepEnabled = true;
          this.sendProbe();
        }
      }, PROBE_ESCALATE_MS);
      // reusePort: si queda un socket anterior sin soltar el 12543 (reintento
      // rápido), el bind no falla con "address in use".
      const sock = (dgram as unknown as {
        createSocket: (o: { type: string; reusePort?: boolean }) => UdpSocket;
      }).createSocket({ type: 'udp4', reusePort: true });
      this.socket = sock;

      const timeout = setTimeout(() => {
        if (!resolved) {
          console.log('[Infolap] discovery TIMEOUT after', PROBE_TIMEOUT_MS, 'ms');
          clearTimeout(escalate);
          if (stateTimer) clearTimeout(stateTimer);
          this.disconnect();
          reject(new Error('infolap-discovery-timeout'));
        }
      }, PROBE_TIMEOUT_MS);

      sock.on('error', (err) => {
        console.log('[Infolap] socket error:', err);
        if (!resolved) {
          clearTimeout(timeout);
          clearTimeout(escalate);
          if (stateTimer) clearTimeout(stateTimer);
          this.disconnect();
          reject(err as Error);
        }
      });

      // Resuelve el descubrimiento (por "OK" o por estado) una sola vez.
      const settle = (participants: Participant[]) => {
        if (resolved) return;
        resolved = true;
        this.discovered = true;
        clearTimeout(timeout);
        clearTimeout(escalate);
        if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
        // El protocolo no requiere más probes tras el discovery: el Gestor
        // empuja los paquetes de estado solo. Paramos de sondear.
        if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null; }
        // Recordar la IP del servidor para la próxima conexión automática.
        if (this.serverHost) {
          void AsyncStorage.setItem(LAST_HOST_KEY, this.serverHost).catch(() => {});
        }
        this.participants = participants;
        // TicTac nuevo: el estado va por WSS. Esperamos a saber si abre para
        // publicar las capacidades correctas (posición/gaps).
        const host = this.serverHost;
        if (host) this.openWss(host, () => resolve(this.buildRaceInfo()));
        else resolve(this.buildRaceInfo());
      };

      sock.on('message', (msg, rinfo) => {
        const buf = msg as Uint8Array;
        console.log('[Infolap] msg len=', buf.length, 'from', rinfo);
        const addr = (rinfo as { address?: string } | undefined)?.address;
        if (addr) this.serverHost = addr;
        // Distinguimos discovery response ("OK …") vs state packet (52 bytes).
        if (buf.length >= 3 && buf[0] === 0x4f && buf[1] === 0x4b && buf[2] === 0x20) {
          const text = Buffer.from(buf).toString('ascii');
          console.log('[Infolap] discovery payload:', text);
          const participants = parseDiscoveryResponse(text);
          console.log('[Infolap] parsed', participants.length, 'participants');
          if (participants.length > 0) settle(participants);
          return;
        }
        // Con el protocolo nuevo el estado llega por WSS; ignoramos UDP para no
        // contar dos veces si un servidor mandase ambos.
        if (buf.length === 52 && !this.wssMode) {
          const pkt = parseStatePacket(buf);
          if (pkt) this.ingestPacket(pkt);
          // Fallback (iOS): si el "OK" se pierde pero el servidor ya nos
          // empuja estado con nombres, resolvemos con esos participantes tras
          // recolectar un poco (los carriles ciclan ~830 ms cada uno).
          if (!resolved && this.laneName.size > 0 && !stateTimer) {
            stateTimer = setTimeout(() => {
              stateTimer = null;
              if (resolved || this.laneName.size === 0) return;
              const participants = [...this.laneName.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([lane, name]) => ({ id: `#${String(lane).padStart(3, '0')}`, name }));
              console.log('[Infolap] resolved from state packets:', participants.length);
              settle(participants);
            }, STATE_RESOLVE_MS);
          }
        }
      });

      // react-native-udp llama a este callback TAMBIÉN cuando el bind falla
      // (con el error como argumento, y luego emite 'error'). Sin esta guarda,
      // setBroadcast lanzaba EBADF sobre un socket sin bindear y la app se
      // cerraba. El fallo lo gestiona el handler de 'error' de arriba.
      sock.bind(CLIENT_PORT, (err?: unknown) => {
        if (err) {
          console.log('[Infolap] bind falló en :', CLIENT_PORT, err);
          return;
        }
        console.log('[Infolap] bound on :', CLIENT_PORT);
        try {
          sock.setBroadcast(true);
        } catch (e) {
          console.log('[Infolap] setBroadcast falló:', e);
        }
        this.sendProbe();
        this.probeTimer = setInterval(() => this.sendProbe(), PROBE_INTERVAL_MS);
      });
    });
  }

  disconnect(): void {
    // Guardar lo corrido antes de soltar los listeners (histórico).
    if (this.active) this.emitSnapshot();
    this.active = false;
    this.sweeping = false;
    if (this.mangaTimer) {
      clearInterval(this.mangaTimer);
      this.mangaTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.wsConn) {
      this.wsConn.close();
      this.wsConn = null;
    }
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
    this.snapshotListeners = [];
    this.pilotStats.clear();
    this.lastRivals = [];
    this.mangaStartAt = null;
    this.laneLastMs.clear();
    this.laneLastSeq.clear();
    this.laneLapCount.clear();
    this.laneName.clear();
    this.laneSumMs.clear();
    this.laneLastIngestAt.clear();
    this.rivalLane = null;
    this.selectedName = null;
    this.rivalSelectedName = null;
    this.mangaCount = 1;
  }

  selectParticipant(id: string): void {
    // El nº de carril NO se corresponde con la posición del piloto en la
    // lista de discovery. Resolvemos el carril real emparejando el nombre
    // del piloto con el `driverName` de los paquetes de estado (puede que
    // aún no haya llegado ninguno → se resuelve luego en ingestPacket).
    const p = this.participants.find(x => x.id === id);
    this.selectedName = p?.name ?? null;
    this.selectedLane = this.laneForName(this.selectedName);
    // Al cambiar de piloto propio dejamos de seguir al rival anterior.
    this.rivalLane = null;
    this.rivalSelectedName = null;
    const lane = this.selectedLane;
    this.currentState = {
      ...emptyLiveState(),
      // Con la manga ya empezada (CONFIG visto) sin mi piloto → descansa.
      status: this.configSeen && lane == null ? 'resting' : 'my-turn',
      myLane: lane,
      selfName: this.selectedName,
      lapCount: lane != null ? this.laneLapCount.get(lane) ?? 0 : 0,
      lastLapMs: lane != null ? this.laneLastMs.get(lane) ?? null : null,
      bestLapMs: null,
      avgLapMs: lane != null ? this.laneAvgMs(lane) : null,
      currentMangaNum: this.configSeen ? this.mangaCount : null,
      remainingMs: this.remainingMsNow(),
      totalParticipants: this.participants.length,
    };
    this.refreshDerived();
    this.emitState();
  }

  /** Seguir (o dejar de seguir) a otro piloto para los avisos de gap. */
  setRival(id: string | null): void {
    if (id == null) {
      this.rivalLane = null;
      this.rivalSelectedName = null;
    } else {
      const p = this.participants.find(x => x.id === id);
      this.rivalSelectedName = p?.name ?? null;
      this.rivalLane = this.laneForName(this.rivalSelectedName);
    }
    this.applyRivalToState();
    this.emitState();
  }

  /** Normaliza un nombre para emparejar discovery vs paquetes. */
  private norm(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** Longitud mínima del nombre corto para aceptar una coincidencia por
   *  prefijo. El paquete recorta a 20 chars, así que un prefijo solo es
   *  fiable si el corto está cerca de esa longitud (fue truncado). Por debajo
   *  exigimos coincidencia EXACTA — si no, "1" emparejaría con "10" y "Juan"
   *  con "Juan Pérez", siguiendo al coche equivocado. */
  private static readonly PREFIX_MIN = 18;

  /** ¿Dos nombres se refieren al mismo piloto? Exacto, o prefijo solo cuando
   *  el nombre corto pudo haber sido truncado a ~20 chars. */
  private nameMatches(a: string, b: string): boolean {
    const x = this.norm(a), y = this.norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return long.startsWith(short) && short.length >= InfolapSource.PREFIX_MIN;
  }

  /** Busca el carril cuyo `driverName` coincide con `name`. */
  private laneForName(name: string | null): number | null {
    if (!name) return null;
    const target = this.norm(name);
    if (!target) return null;
    // Primero coincidencia exacta (evita que "1" empareje con "10").
    for (const [lane, dn] of this.laneName) {
      if (this.norm(dn) === target) return lane;
    }
    // Luego por prefijo, pero SOLO si el nombre corto pudo ser un truncado
    // (mismo criterio que nameMatches) para no emparejar nombres cortos
    // parecidos ("1" con "10", "Juan" con "Juan Pérez").
    for (const [lane, dn] of this.laneName) {
      const n = this.norm(dn);
      if (!n) continue;
      const [short, long] = n.length <= target.length ? [n, target] : [target, n];
      if (long.startsWith(short) && short.length >= InfolapSource.PREFIX_MIN) return lane;
    }
    return null;
  }

  /** Rotación de carriles (nueva manga): mi piloto ha aparecido en otro
   *  carril, lo que significa que todos los pilotos han rotado. Reseteamos
   *  los contadores de todos los carriles y seguimos a mi piloto y al
   *  rival a sus nuevos carriles. */
  private handleLaneRotation(newLane: number): void {
    this.mangaCount += 1;
    this.laneLapCount.clear();
    this.laneSumMs.clear();
    this.laneLastSeq.clear();
    this.laneLastMs.clear();
    this.laneLastIngestAt.clear();
    this.selectedLane = newLane;
    // El carril del rival se re-resolverá cuando llegue su paquete.
    this.rivalLane = this.laneForName(this.rivalSelectedName);
    this.currentState = {
      ...this.currentState,
      myLane: newLane,
      lapCount: 0,
      lastLapMs: null,
      bestLapMs: null,
    };
    this.applyRivalToState();
    this.emitEvent({ type: 'manga-changed', newMangaNum: this.mangaCount, newLane });
    this.emitState();
  }

  /** Re-resuelve carril propio/rival cuando llega un paquete nuevo y
   *  todavía no se conocía el carril de alguno de ellos. */
  private resolveLanes(): void {
    let changed = false;
    if (this.selectedLane == null && this.selectedName) {
      const lane = this.laneForName(this.selectedName);
      if (lane != null) {
        this.selectedLane = lane;
        this.currentState = {
          ...this.currentState,
          myLane: lane,
          lapCount: this.laneLapCount.get(lane) ?? 0,
          lastLapMs: this.laneLastMs.get(lane) ?? null,
        };
        changed = true;
      }
    }
    if (this.rivalLane == null && this.rivalSelectedName) {
      const lane = this.laneForName(this.rivalSelectedName);
      if (lane != null) { this.rivalLane = lane; changed = true; }
    }
    if (changed) {
      this.applyRivalToState();
      this.emitState();
    }
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
      ?? this.rivalSelectedName ?? `Carril ${rLane}`;
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

  onRaceStatsSnapshot(cb: (snapshot: RaceStatsSnapshot) => void): () => void {
    // Sólo el protocolo nuevo: el dossier se construye en cliente y se emite
    // al acabar cada manga y al desconectar (mismo raceId → se actualiza).
    this.snapshotListeners.push(cb);
    return () => {
      this.snapshotListeners = this.snapshotListeners.filter(l => l !== cb);
    };
  }

  setMangaDurationMs(ms: number | null): void {
    this.mangaDurationMs = ms != null && ms > 0 ? ms : null;
    // Sin avisos de golpe por umbrales que ya han pasado.
    this.armMangaFlags();
    this.tickManga(true);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private sendProbe(): void {
    const sock = this.socket;
    if (!sock) {
      console.log('[Infolap] sendProbe: no socket');
      return;
    }
    // Cada envío protegido: en iOS un send a una dirección de broadcast puede
    // lanzar (EACCES/EHOSTUNREACH) y, sin proteger, abortaría el resto —
    // incluido el barrido unicast, que es justo lo que funciona en iOS.
    const send = (payload: Buffer, host: string) => {
      try { sock.send(payload, 0, payload.length, SERVER_PORT, host); }
      catch { /* host concreto falla: seguimos con los demás */ }
    };

    // Manual: unicast directo al host indicado (un solo probe basta).
    if (this.opts.manualHost) {
      const payloads = this.ownProbe ? [this.ownProbe] : this.probePayloads;
      for (const payload of payloads) send(payload, this.opts.manualHost);
      return;
    }

    const broadcastAddrs = ['255.255.255.255', '192.168.10.255', '192.168.1.255', '192.168.0.255', '192.168.115.255'];
    const probe = this.ownProbe;
    if (probe) {
      // PRIMERO la IP recordada (un único unicast a un host conocido — esto sí
      // pasa el filtro anti-escaneo de iOS y resuelve al instante si el
      // servidor sigue ahí).
      if (this.cachedHost) send(probe, this.cachedHost);
      // Broadcast SOLO en Android (en iOS está bloqueado sin entitlement
      // multicast). Resuelve al instante en Android.
      if (Platform.OS === 'android') {
        for (const host of broadcastAddrs) send(probe, host);
      }
      // El barrido de subred solo cuando está habilitado (sin caché desde el
      // principio; con caché, tras 2,5 s sin respuesta). Evita disparar el
      // anti-escaneo de iOS en el caso normal (IP recordada).
      if (this.sweepEnabled) this.startUnicastSweep(probe);
      console.log('[Infolap] sendProbe →', this.cachedHost ? `cached ${this.cachedHost} ` : '',
        this.sweepEnabled ? `sweep ${this.subnetHosts.length}` : '(sin barrido)',
        Platform.OS === 'android' ? '+ broadcast' : '');
    } else {
      // Sin IP local detectada: todos los IDs a la IP recordada (un único
      // host, pasa el anti-escaneo de iOS) y por broadcast (fallback antiguo).
      if (this.cachedHost) {
        for (const payload of this.probePayloads) send(payload, this.cachedHost);
      }
      for (const host of broadcastAddrs) {
        for (const payload of this.probePayloads) send(payload, host);
      }
      console.log('[Infolap] sendProbe → broadcast brute-force (sin IP local)');
    }
  }

  // Barrido unicast por tandas: envía `probe` a cada host de la subred en
  // grupos pequeños con pausas, para no saturar el socket UDP (en iOS la
  // ráfaga síncrona hace que se pierda la respuesta del servidor).
  private startUnicastSweep(probe: Buffer): void {
    if (this.sweeping || this.subnetHosts.length === 0) return;
    this.sweeping = true;
    const hosts = this.subnetHosts;
    // Suave: pocas por tanda con pausa amplia. En iOS, sondear deprisa muchas
    // IPs congestiona la pila (ARP a hosts inexistentes) y se pierde el "OK".
    const CHUNK = 3;
    const GAP_MS = 50;
    let i = 0;
    const step = () => {
      const sock = this.socket;
      if (!sock || this.discovered) { this.sweeping = false; return; }
      const end = Math.min(i + CHUNK, hosts.length);
      for (; i < end; i++) {
        try { sock.send(probe, 0, probe.length, SERVER_PORT, hosts[i]!); } catch { /* ignore */ }
      }
      if (i < hosts.length) setTimeout(step, GAP_MS);
      else this.sweeping = false;
    };
    step();
  }

  private buildRaceInfo(): RaceInfo {
    return {
      source: 'infolap',
      name: 'InfoLap',
      format: 'individual',
      // Clave de la estrategia de neumáticos (una por día de carrera).
      raceId: this.wssMode ? dayKey(this.sessionStartedAt) : undefined,
      participants: this.participants,
      capabilities: this.wssMode ? INFOLAP_WSS_CAPABILITIES : INFOLAP_CAPABILITIES,
    };
  }

  // ── Protocolo nuevo (WSS) ───────────────────────────────────────────────

  /**
   * Abre el WSS del TicTac nuevo. `onReady` (solo el primer intento) se llama
   * una vez: al abrir, o al fallar/agotar el plazo (→ protocolo UDP antiguo).
   * Si una conexión ya establecida se cae, reintenta cada WSS_RECONNECT_MS.
   */
  private openWss(host: string, onReady?: () => void): void {
    if (!this.active) { onReady?.(); return; }
    let ready = onReady;
    const markReady = () => { const r = ready; ready = undefined; r?.(); };
    const url = `wss://${host}:${INFOLAP_WSS_PORT}/`;
    let opened = false;
    let openTimer: ReturnType<typeof setTimeout> | null = null;

    const conn = openInfolapWs(url, {
      onOpen: () => {
        opened = true;
        if (openTimer) clearTimeout(openTimer);
        const wasWss = this.wssMode;
        this.wssMode = true;
        console.log('[Infolap] WSS conectado', url);
        if (!this.mangaTimer) this.mangaTimer = setInterval(() => this.tickManga(), 1000);
        if (wasWss) this.emitEvent({ type: 'connection-restored' });
        markReady();
      },
      onMessage: (data) => this.handleWsMessage(data),
      onClose: (reason) => {
        if (openTimer) clearTimeout(openTimer);
        if (this.wsConn === conn) this.wsConn = null;
        console.log('[Infolap] WSS cerrado:', reason);
        if (!this.active) return;
        if (!this.wssMode) { markReady(); return; }   // TicTac antiguo
        if (opened) this.emitEvent({ type: 'connection-lost' });
        this.wsReconnectTimer = setTimeout(() => {
          this.wsReconnectTimer = null;
          if (this.active && !this.wsConn) this.openWss(host);
        }, WSS_RECONNECT_MS);
      },
    });
    this.wsConn = conn;

    if (onReady) {
      openTimer = setTimeout(() => {
        if (opened) return;
        console.log('[Infolap] WSS sin respuesta → protocolo UDP antiguo');
        conn.close();
        if (this.wsConn === conn) this.wsConn = null;
        markReady();
      }, WSS_OPEN_TIMEOUT_MS);
    }
  }

  private handleWsMessage(text: string): void {
    if (!this.active) return;
    const msg = parseWsMessage(text);
    if (!msg) {
      console.log('[Infolap] WSS mensaje no reconocido:', text.slice(0, 120));
      return;
    }
    switch (msg.type) {
      case 'LAP': this.ingestWsLap(msg); break;
      case 'CONFIG': this.ingestConfig(msg); break;
      case 'RIVALS_UPDATE': this.ingestRivals(msg); break;
    }
  }

  private ingestWsLap(msg: InfolapLapMessage): void {
    if (msg.lapTimeMs != null && msg.lapTimeMs < MIN_WSS_LAP_MS) return;  // test de transmisión
    this.ingestPacket({
      sequence: msg.frame,
      lane: msg.laneId,
      driverName: msg.pilotName,
      lastLapMs: msg.lapTimeMs,
      isNewLap: true,
      laneCode: msg.laneId,
    }, true);
    if (msg.laneId === this.selectedLane && msg.position != null) {
      this.applyStanding({
        position: msg.position,
        total: null,
        aheadName: msg.aheadName,
        aheadGapMs: msg.aheadGapMs,
        behindName: msg.behindName,
        behindGapMs: msg.behindGapMs,
      });
    }
  }

  /** CONFIG = empieza una manga: pilotos por carril (ya rotados). */
  private ingestConfig(msg: InfolapConfigMessage): void {
    if (msg.pilots.length === 0) return;
    const anyLaps = [...this.laneLapCount.values()].some(n => n > 0);
    if (anyLaps) this.emitSnapshot();   // cierra la manga anterior en el histórico
    if (this.configSeen || anyLaps) this.mangaCount += 1;
    const first = !this.configSeen;
    this.configSeen = true;
    this.mangaStartAt = Date.now();
    this.armMangaFlags();
    if (first) this.emitEvent({ type: 'race-started' });

    this.laneName.clear();
    for (const p of msg.pilots) this.laneName.set(p.laneId, p.name);
    this.laneLapCount.clear();
    this.laneSumMs.clear();
    this.laneLastSeq.clear();
    this.laneLastMs.clear();
    this.laneLastIngestAt.clear();

    const lane = this.laneForName(this.selectedName);
    this.selectedLane = lane;
    this.rivalLane = this.laneForName(this.rivalSelectedName);
    this.currentState = {
      ...this.currentState,
      // Si mi piloto no está en la lista de esta manga, descansa.
      status: this.selectedName && lane == null ? 'resting' : 'my-turn',
      myLane: lane,
      lapCount: 0,
      lastLapMs: null,
      bestLapMs: null,
      avgLapMs: null,
      currentMangaNum: this.mangaCount,
      remainingMs: this.remainingMsNow(),
      position: null,
      gapAheadMs: null,
      gapBehindMs: null,
      gapAheadLaps: null,
      gapBehindLaps: null,
      aheadName: null,
      behindName: null,
      avgToCatchMs: null,
    };
    this.applyRivalToState();
    this.refreshDerived();
    this.emitState();
    if (lane != null) this.emitEvent({ type: 'manga-changed', newMangaNum: this.mangaCount, newLane: lane });
  }

  private ingestRivals(msg: InfolapRivalsMessage): void {
    this.lastRivals = msg.rivals;
    // Corriendo: por carril. Descansando: por nombre (sigue en la general).
    const name = this.selectedName;
    const s = this.selectedLane != null
      ? standingForLane(msg.rivals, this.selectedLane)
      : name ? standingOf(msg.rivals, r => this.nameMatches(r.name, name)) : null;
    if (s) this.applyStanding(s);
  }

  /** Posición y gaps del piloto propio (en tiempo del TicTac y en vueltas). */
  private applyStanding(s: Omit<InfolapStanding, 'total'> & { total: number | null }): void {
    const prev = this.currentState.position;
    const pace = this.myPaceMs();
    this.currentState = {
      ...this.currentState,
      position: s.position,
      totalParticipants: s.total ?? this.currentState.totalParticipants,
      aheadName: s.aheadName,
      gapAheadMs: s.aheadGapMs,
      gapAheadLaps: gapMsToLaps(s.aheadGapMs, pace),
      behindName: s.behindName,
      gapBehindMs: s.behindGapMs,
      gapBehindLaps: gapMsToLaps(s.behindGapMs, pace),
    };
    this.refreshDerived();
    this.emitState();
    if (prev != null && prev !== s.position) {
      this.emitEvent({ type: 'position-changed', from: prev, to: s.position });
    }
  }

  /** Mi ritmo de referencia: media del carril en esta manga, media de la
   *  carrera, `vme` del TicTac o, en último caso, la última vuelta. */
  private myPaceMs(): number | null {
    const lane = this.selectedLane;
    const name = this.selectedName;
    return (lane != null ? this.laneAvgMs(lane) : null)
      ?? (name ? statsAvgMs(this.pilotStats.get(normName(name))) : null)
      ?? (name ? this.lastRivals.find(r => this.nameMatches(r.name, name))?.vmeMs ?? null : null)
      ?? this.currentState.lastLapMs;
  }

  /** Proyección, vueltas proyectadas y media para subir (sin emitir). Solo
   *  con duración de manga configurada y la manga vista empezar. */
  private refreshDerived(): void {
    if (!this.wssMode) return;
    const rem = this.remainingMsNow();
    const name = this.selectedName;
    let projection: ProjectionRow[] | null = null;
    let projectedTotal: number | null = null;
    let avgToCatchMs: number | null = null;
    if (rem != null && this.lastRivals.length > 0) {
      const racing = new Set([...this.laneName.values()].map(normName));
      projection = buildProjection(this.lastRivals, this.pilotStats, racing, rem);
      projectedTotal = name
        ? projection.find(r => this.nameMatches(r.name, name))?.projectedTotal ?? null
        : null;
      const aheadName = this.currentState.aheadName;
      const ahead = aheadName ? this.lastRivals.find(r => this.nameMatches(r.name, aheadName)) : undefined;
      if (ahead && this.currentState.status === 'my-turn') {
        avgToCatchMs = catchUpPaceMs({
          remainingMs: rem,
          gapMs: this.currentState.gapAheadMs,
          aheadPaceMs: statsAvgMs(this.pilotStats.get(normName(ahead.name))) ?? ahead.vmeMs,
          aheadRacing: ahead.isRacing && racing.has(normName(ahead.name)),
          myPaceMs: this.myPaceMs(),
          myBestMs: name ? this.pilotStats.get(normName(name))?.bestMs ?? null : null,
        });
      }
    }
    this.currentState = { ...this.currentState, projection, projectedTotal, avgToCatchMs };
  }

  // ── Reloj de manga (duración configurada por el usuario) ────────────────

  private remainingMsNow(): number | null {
    if (this.mangaDurationMs == null || this.mangaStartAt == null) return null;
    return Math.max(0, this.mangaDurationMs - (Date.now() - this.mangaStartAt));
  }

  /** Marca como ya lanzados los avisos cuyo umbral ya pasó. */
  private armMangaFlags(): void {
    const rem = this.remainingMsNow();
    const d = this.mangaDurationMs;
    this.firedHalf = rem != null && d != null && rem <= d / 2;
    this.firedLastMinute = rem != null && rem <= LAST_MINUTE_MS;
    this.firedLast30s = rem != null && rem <= LAST_30S_MS;
    this.firedEnd = rem != null && rem <= 0;
  }

  private tickManga(force = false): void {
    if (!this.active) return;
    const rem = this.remainingMsNow();
    const shown = rem == null ? null : Math.ceil(rem / 1000) * 1000;
    if (force || shown !== this.currentState.remainingMs) {
      this.currentState = { ...this.currentState, remainingMs: shown };
      this.refreshDerived();
      this.emitState();
    }
    if (rem == null) return;
    const d = this.mangaDurationMs!;
    if (!this.firedHalf && rem <= d / 2 && rem > LAST_MINUTE_MS) {
      this.firedHalf = true;
      this.emitEvent({ type: 'half-manga' });
    }
    if (!this.firedLastMinute && rem <= LAST_MINUTE_MS && rem > LAST_30S_MS) {
      this.firedLastMinute = true;
      this.emitEvent({ type: 'last-minute' });
    }
    if (!this.firedLast30s && rem <= LAST_30S_MS && rem > 0) {
      this.firedLast30s = true;
      this.emitEvent({ type: 'last-30s' });
    }
    if (!this.firedEnd && rem <= 0) {
      this.firedEnd = true;
      this.emitEvent({ type: 'race-finished' });
      this.emitSnapshot();
    }
  }

  // ── Histórico ───────────────────────────────────────────────────────────

  private emitSnapshot(): void {
    if (!this.wssMode) return;
    const d = this.sessionStartedAt;
    const pad = (n: number) => String(n).padStart(2, '0');
    const snap = buildSnapshot({
      raceId: `tictac-${d.getTime()}`,
      name: `TicTac ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      startedAt: d.toISOString(),
      finishedAt: new Date().toISOString(),
      stats: this.pilotStats,
      rivals: this.lastRivals,
    });
    if (!snap) return;
    for (const l of this.snapshotListeners) l(snap);
  }

  private recordPilotLap(name: string, lapMs: number): void {
    const key = normName(name);
    if (!key) return;
    let st = this.pilotStats.get(key);
    if (!st) {
      st = { name, laps: 0, sumMs: 0, bestMs: null, mangas: new Set() };
      this.pilotStats.set(key, st);
    }
    st.laps += 1;
    st.sumMs += lapMs;
    st.bestMs = st.bestMs == null ? lapMs : Math.min(st.bestMs, lapMs);
    st.mangas.add(this.mangaCount);
  }

  // ── Común ───────────────────────────────────────────────────────────────

  /** `reliable`: paquete del WSS (cada vuelta llega una sola vez), sin la
   *  red de seguridad contra retransmisiones UDP tardías. */
  private ingestPacket(pkt: InfolapStatePacket, reliable = false): void {
    if (pkt.driverName) {
      this.laneName.set(pkt.lane, pkt.driverName);

      // Mi piloto ha aparecido en otro carril → rotación de carriles
      // (nueva manga). Le seguimos a su carril nuevo.
      if (this.selectedName && this.selectedLane != null
          && this.selectedLane !== pkt.lane
          && this.nameMatches(pkt.driverName, this.selectedName)) {
        this.handleLaneRotation(pkt.lane);
      }

      // El rival también puede haber rotado de carril.
      if (this.rivalSelectedName && this.rivalLane != null
          && this.rivalLane !== pkt.lane
          && this.nameMatches(pkt.driverName, this.rivalSelectedName)) {
        this.rivalLane = pkt.lane;
        this.applyRivalToState();
        this.emitState();
      }

      // Con el nombre nuevo quizá podamos resolver mi carril / el del rival.
      this.resolveLanes();
    }

    // Sentinel "EF54AB1" → carril sin vuelta válida todavía. Ignorar.
    if (pkt.lastLapMs === null) return;

    // Cada paquete del Gestor para un carril trae un sequence counter único.
    // Una vuelta nueva → sequence nuevo (aunque el tiempo en ms sea idéntico
    // al de la vuelta anterior). Paquetes con el mismo sequence son
    // duplicados (el Gestor reenvía cada estado N veces).
    const prevSeq = this.laneLastSeq.get(pkt.lane);
    if (prevSeq === pkt.sequence) return;   // duplicado por sequence → ignorar
    this.laneLastSeq.set(pkt.lane, pkt.sequence);

    // Segunda red de seguridad: si llega la misma vuelta del mismo carril
    // en menos de 3 s, es una retransmisión tardía con sequence distinto
    // (el Gestor reenvía 5x por defecto). Mejor descartar que cantarla 5x.
    const prevMs = this.laneLastMs.get(pkt.lane);
    const prevAt = this.laneLastIngestAt.get(pkt.lane) ?? 0;
    const now = Date.now();
    if (!reliable && prevMs === pkt.lastLapMs && now - prevAt < 3000) {
      return;
    }
    this.laneLastIngestAt.set(pkt.lane, now);

    this.laneLastMs.set(pkt.lane, pkt.lastLapMs);
    const newCount = (this.laneLapCount.get(pkt.lane) ?? 0) + 1;
    this.laneLapCount.set(pkt.lane, newCount);
    this.laneSumMs.set(pkt.lane, (this.laneSumMs.get(pkt.lane) ?? 0) + pkt.lastLapMs);

    // Vuelta de CUALQUIER piloto → acumulado de carrera y estrategia de rivales.
    const pilot = pkt.driverName || this.laneName.get(pkt.lane) || `Carril ${pkt.lane}`;
    this.recordPilotLap(pilot, pkt.lastLapMs);
    this.emitEvent({
      type: 'entity-lap',
      lane: pkt.lane,
      name: pilot,
      lapTimeMs: pkt.lastLapMs,
      lapNumber: newCount,
    });

    if (this.selectedLane === pkt.lane) {
      const best = this.currentState.bestLapMs;
      const newBest = best === null || pkt.lastLapMs < best ? pkt.lastLapMs : best;
      this.currentState = {
        ...this.currentState,
        lapCount: newCount,
        lastLapMs: pkt.lastLapMs,
        bestLapMs: newBest,
        avgLapMs: this.laneAvgMs(pkt.lane),
      };
      this.applyRivalToState();
      this.refreshDerived();
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

/** yyyymmdd como número (clave de estrategia de un día de carrera). */
function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
