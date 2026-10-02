// Parser del protocolo del InfoLap NUEVO de TicTac (TICTAC_Slot, 2026).
//
// El descubrimiento sigue siendo el de siempre (UDP "InfoLap:Cxxx" → :4441,
// respuesta "OK <nombre>;#<id>…" a :12543), pero el estado en vivo ya NO va
// en paquetes UDP de 52 bytes: el Gestor abre un WebSocket sobre TLS en
// `wss://<pc>:12543/` (certificado autofirmado CN=InfoLapServer) y empuja
// mensajes de texto JSON. No hace falta enviarle nada tras conectar.
//
// Mensajes capturados (tiempos y gaps en SEGUNDOS con decimales):
//   • CONFIG — al empezar cada manga (no se repite al conectar a mitad):
//       {"type":"CONFIG","minAppVersionCode":1,"minAppVersion":"1.0",
//        "mangaPilots":[{"laneId":1,"name":"Piloto 1"},…],"rivals":[…]}
//     Incluye todos los carriles; los libres llevan "Carril N". `rivals` es
//     la parrilla (a veces vacía). Al arrancar una carrera llega DOS veces
//     seguidas, sin vueltas entre medias; y si se reinicia la carrera llega
//     otra vez con los mismos pilotos en los mismos carriles (una manga
//     nueva, en cambio, los rota). Ver `clasificarConfig`.
//   • LAP — cada cruce de meta (y 100 vueltas falsas con "Test de transmisión"):
//       {"type":"LAP","frame":105,"laneId":2,"pilotName":"Piloto 2",
//        "lapTime":2.9400,"isFastLap":true,"position":2,"isRace":true,
//        "isFirstLap":false,"pilotAheadName":"Piloto 1","pilotAheadVme":3.9334,
//        "gapAhead":0.9274,"pilotBehindName":"Piloto 3","pilotBehindVme":0.0}
//     `frame` es un contador global de la sesión del TicTac (no se reinicia
//     entre tandas). `isFirstLap` = cruce de salida (lapTime 0).
//     `isRace` = false en tanda libre (sin CONFIG, carriles "Carril N",
//     position 0); true en carrera. `isFastLap` = mejor vuelta PERSONAL de
//     la carrera (la primera cronometrada siempre lo es; no es la mejor de
//     todos). `gapAhead`/`gapBehind` solo vienen cuando se conocen.
//   • RIVALS_UPDATE — clasificación completa; llega justo ANTES de cada LAP
//     y de cada CONFIG (mismo milisegundo):
//       {"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 1",
//        "vme":3.9334,"isRacing":true,"laneId":1,"gap":0.0},…]}
//     `gap` = distancia en tiempo al líder (null hasta que se conoce: en cada
//     salida llegan todos a null, no indica reinicio).
//     `vme` = tiempo total / vueltas (incluye el tramo de salida); 0 = sin datos.

export const INFOLAP_WSS_PORT = 12543;

export interface InfolapLapMessage {
  type: 'LAP';
  frame: number;
  laneId: number;
  pilotName: string;
  /** null en el cruce de salida (`isFirstLap`, lapTime 0). */
  lapTimeMs: number | null;
  isFastLap: boolean;
  isFirstLap: boolean;
  isRace: boolean;
  /** 0 fuera de carrera → null. */
  position: number | null;
  aheadName: string | null;
  aheadGapMs: number | null;
  behindName: string | null;
  behindGapMs: number | null;
}

export interface InfolapConfigMessage {
  type: 'CONFIG';
  pilots: { laneId: number; name: string }[];
}

export interface InfolapRival {
  position: number;
  laneId: number;
  name: string;
  /** Gap en tiempo al líder; null si aún no se conoce. */
  gapMs: number | null;
  /** Ritmo medio según el TicTac (`vme`), null si aún no hay. */
  vmeMs: number | null;
  isRacing: boolean;
}

export interface InfolapRivalsMessage {
  type: 'RIVALS_UPDATE';
  rivals: InfolapRival[];
}

export type InfolapWsMessage = InfolapLapMessage | InfolapConfigMessage | InfolapRivalsMessage;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() : null;
}

function secToMs(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n * 1000);
}

export function parseWsMessage(text: string): InfolapWsMessage | null {
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    m = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (m.type) {
    case 'LAP': {
      const frame = num(m.frame);
      const laneId = num(m.laneId);
      if (frame == null || laneId == null) return null;
      const isFirstLap = m.isFirstLap === true;
      const lapTimeMs = secToMs(m.lapTime);
      const position = num(m.position);
      return {
        type: 'LAP',
        frame,
        laneId,
        pilotName: str(m.pilotName) ?? '',
        lapTimeMs: isFirstLap || lapTimeMs == null || lapTimeMs <= 0 ? null : lapTimeMs,
        isFastLap: m.isFastLap === true,
        isFirstLap,
        isRace: m.isRace === true,
        position: position != null && position > 0 ? position : null,
        aheadName: str(m.pilotAheadName) || null,
        aheadGapMs: secToMs(m.gapAhead),
        behindName: str(m.pilotBehindName) || null,
        behindGapMs: secToMs(m.gapBehind),
      };
    }
    case 'CONFIG': {
      const list = Array.isArray(m.mangaPilots) ? m.mangaPilots : [];
      const pilots: InfolapConfigMessage['pilots'] = [];
      for (const p of list) {
        if (!p || typeof p !== 'object') continue;
        const o = p as Record<string, unknown>;
        const laneId = num(o.laneId);
        const name = str(o.name);
        if (laneId != null && laneId > 0 && name) pilots.push({ laneId, name });
      }
      return { type: 'CONFIG', pilots };
    }
    case 'RIVALS_UPDATE': {
      const list = Array.isArray(m.rivals) ? m.rivals : [];
      const rivals: InfolapRival[] = [];
      for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const o = r as Record<string, unknown>;
        const position = num(o.position);
        const laneId = num(o.laneId);
        const name = str(o.name);
        if (position == null || laneId == null || !name) continue;
        const vmeMs = secToMs(o.vme);
        rivals.push({
          position, laneId, name,
          gapMs: secToMs(o.gap),
          vmeMs: vmeMs != null && vmeMs > 0 ? vmeMs : null,
          isRacing: o.isRacing !== false,
        });
      }
      rivals.sort((a, b) => a.position - b.position);
      return { type: 'RIVALS_UPDATE', rivals };
    }
    default:
      return null;
  }
}

export interface InfolapStanding {
  position: number;
  total: number;
  aheadName: string | null;
  aheadGapMs: number | null;
  behindName: string | null;
  behindGapMs: number | null;
}

/** Posición y gaps (en tiempo) de un carril a partir de la clasificación. */
export function standingForLane(rivals: InfolapRival[], lane: number): InfolapStanding | null {
  return standingOf(rivals, r => r.laneId === lane);
}

/** Igual, localizando al piloto con `match` (p. ej. por nombre si descansa). */
export function standingOf(rivals: InfolapRival[], match: (r: InfolapRival) => boolean): InfolapStanding | null {
  const i = rivals.findIndex(match);
  if (i < 0) return null;
  const me = rivals[i]!;
  const ahead = rivals[i - 1] ?? null;
  const behind = rivals[i + 1] ?? null;
  const diff = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null ? Math.max(0, a - b) : null;
  return {
    position: me.position,
    total: rivals.length,
    aheadName: ahead?.name ?? null,
    aheadGapMs: diff(me.gapMs, ahead?.gapMs),
    behindName: behind?.name ?? null,
    behindGapMs: diff(behind?.gapMs, me.gapMs),
  };
}

/** Qué supone un CONFIG respecto al anterior:
 *  - `duplicado`: mismos pilotos y ninguna vuelta de carrera desde el último
 *    (el TicTac lo manda dos veces al arrancar). Solo reajusta el reloj.
 *  - `reinicio`: mismos pilotos en los mismos carriles tras vueltas de
 *    carrera → se ha reiniciado la carrera; empieza de cero.
 *  - `nueva-manga`: hubo vueltas de carrera y los pilotos han cambiado de
 *    carril (o es el primer CONFIG tras conectar a mitad de manga).
 *  - `misma-manga`: primer CONFIG, o pilotos cambiados antes de correr. */
export type TipoConfig = 'duplicado' | 'reinicio' | 'nueva-manga' | 'misma-manga';

/** Huella de la asignación de pilotos a carriles de un CONFIG. */
export function claveConfig(pilots: InfolapConfigMessage['pilots']): string {
  return [...pilots]
    .sort((a, b) => a.laneId - b.laneId)
    .map(p => `${p.laneId}:${p.name.trim().toLowerCase()}`)
    .join('|');
}

export function clasificarConfig(args: {
  /** Huella del CONFIG anterior en esta sesión (null = no hubo). */
  claveAnterior: string | null;
  clave: string;
  /** ¿Ha habido vueltas cronometradas de carrera desde el CONFIG anterior
   *  (o desde que conectamos, si no hubo)? */
  vueltasCarrera: boolean;
}): TipoConfig {
  const { claveAnterior, clave, vueltasCarrera } = args;
  if (claveAnterior === clave) return vueltasCarrera ? 'reinicio' : 'duplicado';
  return vueltasCarrera ? 'nueva-manga' : 'misma-manga';
}
