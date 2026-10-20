// Flujo completo con el TicTac nuevo: "OK" por UDP → WSS → mensajes JSON.

import { Buffer } from 'buffer';

import type { LiveState, SourceEvent } from './types';

type Handler = (...args: unknown[]) => void;

const udp = {
  handlers: {} as Record<string, Handler>,
  sent: [] as string[],
};

jest.mock('react-native-udp', () => ({
  createSocket: () => ({
    bind: (_port: number, cb?: () => void) => { cb?.(); },
    setBroadcast: () => {},
    send: (buf: Buffer) => { udp.sent.push(buf.toString()); },
    on: (ev: string, fn: Handler) => { udp.handlers[ev] = fn; },
    close: () => {},
  }),
}));
jest.mock('expo-network', () => ({ getIpAddressAsync: async () => '192.168.10.50' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => {},
}));

interface WsHandlers { onOpen(): void; onMessage(d: string): void; onClose(r: string): void }
const ws = { opened: [] as { url: string; h: WsHandlers; closed: boolean }[] };
jest.mock('../../modules/infolapws', () => ({
  openInfolapWs: (url: string, h: WsHandlers) => {
    const c = { url, h, closed: false };
    ws.opened.push(c);
    return { close: () => { c.closed = true; } };
  },
}));

import { InfolapSource } from './InfolapSource';

// Paquete de estado de 52 bytes del TicTac antiguo (ver infolapDecode.ts).
function paqueteUdp(seq: number, lane: number, name: string, ms: number | null, nueva = true): Uint8Array {
  if (ms == null) return paqueteUdpSinVuelta(seq, lane, name);
  const d = [
    Math.floor(ms / 100) % 10, Math.floor(ms / 10000) % 10, ms % 10,
    Math.floor(ms / 10) % 10, Math.floor(ms / 100000) % 10, Math.floor(ms / 1000) % 10, 0,
  ];
  const tiempo = d.map((x, i) => (x ^ Number('7654321'[i])).toString(16).toUpperCase()).join('');
  const s = String(seq).padStart(4, '0') + String(lane) + name.padEnd(20) + ' '.repeat(5)
    + tiempo + ' ' + ' '.repeat(6) + (nueva ? '1' : 'X') + String(lane).padStart(3, '0') + ' '.repeat(4);
  return new Uint8Array(Buffer.from(s, 'ascii'));
}

// Carril que aún no ha dado vuelta: centinela "EF54AB1" en el campo de tiempo.
function paqueteUdpSinVuelta(seq: number, lane: number, name: string): Uint8Array {
  const s = String(seq).padStart(4, '0') + String(lane) + name.padEnd(20) + ' '.repeat(5)
    + 'EF54AB1' + ' ' + ' '.repeat(6) + 'X' + String(lane).padStart(3, '0') + ' '.repeat(4);
  return new Uint8Array(Buffer.from(s, 'ascii'));
}

const lap = (frame: number, lane: number, name: string, sec: number, extra = '') =>
  `{"type":"LAP","frame":${frame},"laneId":${lane},"pilotName":"${name}","lapTime":${sec},"isFastLap":false,"position":0,"isRace":true,"isFirstLap":${sec === 0}${extra}}`;

async function connectNew() {
  udp.handlers = {}; udp.sent = []; ws.opened = [];
  const src = new InfolapSource();
  const p = src.connect();
  // Deja que connect() pase los await de IP / AsyncStorage y abra el socket.
  for (let i = 0; i < 5 && !udp.handlers.message; i++) await Promise.resolve();
  udp.handlers.message!(
    new Uint8Array(Buffer.from('OK Piloto 1;#001Piloto 2;#002Piloto 3;#003')),
    { address: '192.168.10.144' },
  );
  expect(ws.opened).toHaveLength(1);
  expect(ws.opened[0]!.url).toBe('wss://192.168.10.144:12543/');
  ws.opened[0]!.h.onOpen();
  const info = await p;
  return { src, info, conn: ws.opened[0]! };
}

describe('InfolapSource con TicTac nuevo (WSS)', () => {
  it('detecta el WSS y publica posición/gaps', async () => {
    const { src, info, conn } = await connectNew();
    expect(info.participants.map(p => p.name)).toEqual(['Piloto 1', 'Piloto 2', 'Piloto 3']);
    expect(info.capabilities.positions).toBe(true);

    let state!: LiveState;
    const events: SourceEvent[] = [];
    src.onStateChange(s => { state = s; });
    src.onEvent(e => events.push(e));
    src.selectParticipant('#002');

    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"},{"laneId":3,"name":"Piloto 3"}],"rivals":[]}');
    expect(state.myLane).toBe(2);
    expect(events).toContainEqual({ type: 'manga-changed', newMangaNum: 1, newLane: 2 });

    conn.h.onMessage(lap(101, 2, 'Piloto 2', 0));        // salida: no cuenta
    conn.h.onMessage(lap(102, 1, 'Piloto 1', 2.9));      // otro carril
    conn.h.onMessage(lap(103, 2, 'Piloto 2', 2.94));
    conn.h.onMessage(lap(103, 2, 'Piloto 2', 2.94));     // duplicado por frame
    expect(state.lapCount).toBe(1);
    expect(state.lastLapMs).toBe(2940);
    expect(events.filter(e => e.type === 'lap-completed')).toHaveLength(1);

    conn.h.onMessage('{"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 2","laneId":2,"gap":0},{"position":2,"name":"Piloto 1","laneId":1,"gap":0.4}]}');
    expect(state.position).toBe(1);
    expect(state.behindName).toBe('Piloto 1');
    expect(state.gapBehindMs).toBe(400);
    conn.h.onMessage('{"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 1","laneId":1,"gap":0},{"position":2,"name":"Piloto 2","laneId":2,"gap":0.3}]}');
    expect(state.position).toBe(2);
    expect(state.gapAheadMs).toBe(300);
    expect(events).toContainEqual({ type: 'position-changed', from: 1, to: 2 });
    src.disconnect();
    expect(conn.closed).toBe(true);
  });

  it('con duración de manga: tiempo restante, avisos, media, gaps en vueltas e histórico', async () => {
    jest.useFakeTimers();
    try {
      const { src, conn } = await connectNew();
      let state!: LiveState;
      const events: SourceEvent[] = [];
      const snaps: unknown[] = [];
      src.onStateChange(s => { state = s; });
      src.onEvent(e => events.push(e));
      src.onRaceStatsSnapshot(s => snaps.push(s));
      src.selectParticipant('#002');
      src.setMangaDurationMs(3 * 60_000);

      conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"}]}');
      expect(events).toContainEqual({ type: 'race-started' });
      expect(state.remainingMs).toBe(180_000);

      conn.h.onMessage(lap(1, 1, 'Piloto 1', 3.0));
      conn.h.onMessage(lap(2, 2, 'Piloto 2', 3.2));
      conn.h.onMessage(lap(3, 2, 'Piloto 2', 2.8));
      expect(state.avgLapMs).toBe(3000);
      expect(events.filter(e => e.type === 'entity-lap')).toHaveLength(3);

      // Voy 2º a 6,1 s (≈ 2 vueltas a mi media de 3 s) del líder.
      conn.h.onMessage('{"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 1","laneId":1,"gap":0,"vme":3.0},{"position":2,"name":"Piloto 2","laneId":2,"gap":6.1,"vme":3.0}]}');
      expect(state.gapAheadLaps).toBe(2);
      expect(state.aheadName).toBe('Piloto 1');
      expect(state.projection?.map(r => r.name)).toEqual(['Piloto 1', 'Piloto 2']);
      expect(state.projectedTotal).toBe(62);   // 2 + 180 s / 3 s
      expect(state.avgToCatchMs).toBe(Math.round((3000 * 180_000) / 186_100));

      // La manga sigue: el carril 1 cruza cada 10 s (sin vueltas = pausa).
      let frame = 100;
      const rodar = (ms: number) => {
        for (let t = 0; t < ms; t += 10_000) {
          const paso = Math.min(10_000, ms - t);
          jest.advanceTimersByTime(paso);
          if (paso === 10_000) conn.h.onMessage(lap(frame++, 1, 'Piloto 1', 10));
        }
      };
      rodar(90_000);
      expect(events).toContainEqual({ type: 'half-manga' });
      rodar(30_000);
      expect(events).toContainEqual({ type: 'last-minute' });
      // Parada de 60 s: el reloj se congela y no avisa.
      const congelado = state.remainingMs;
      jest.advanceTimersByTime(60_000);
      expect(state.remainingMs).toBe(congelado);
      expect(events).not.toContainEqual({ type: 'last-30s' });
      // Se reanuda: la primera vuelta (10 s) descuenta lo parado.
      conn.h.onMessage(lap(frame++, 1, 'Piloto 1', 10));
      jest.advanceTimersByTime(1_000);
      expect(state.remainingMs).toBe(congelado! - 11_000);
      rodar(30_000);
      expect(events).toContainEqual({ type: 'last-30s' });
      rodar(21_000);
      expect(events).toContainEqual({ type: 'race-finished' });
      expect(state.remainingMs).toBe(0);
      expect(state.avgToCatchMs).toBeNull();
      expect(snaps).toHaveLength(1);

      src.disconnect();
      expect(snaps).toHaveLength(2);   // al desconectar se vuelve a guardar
      const last = snaps[1] as { standings: { name: string; totalLaps: number }[] };
      expect(last.standings.map(s => [s.name, s.totalLaps])).toEqual([['Piloto 1', 19], ['Piloto 2', 2]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignora las vueltas del "Test de transmisión"', async () => {
    const { src, conn } = await connectNew();
    let state!: LiveState;
    src.onStateChange(s => { state = s; });
    src.selectParticipant('#001');
    conn.h.onMessage(lap(1, 1, 'Piloto 1', 0.001));
    conn.h.onMessage(lap(2, 1, 'Piloto 1', 0.002));
    expect(state.lapCount).toBe(0);
    src.disconnect();
  });

  it('nueva manga con carriles rotados y piloto que descansa', async () => {
    const { src, conn } = await connectNew();
    let state!: LiveState;
    const events: SourceEvent[] = [];
    src.onStateChange(s => { state = s; });
    src.onEvent(e => events.push(e));
    src.selectParticipant('#001');
    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"}]}');
    conn.h.onMessage(lap(10, 1, 'Piloto 1', 3.1));
    expect(state.lapCount).toBe(1);

    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 2"},{"laneId":2,"name":"Piloto 1"}]}');
    expect(state.myLane).toBe(2);
    expect(state.lapCount).toBe(0);
    expect(events).toContainEqual({ type: 'manga-changed', newMangaNum: 2, newLane: 2 });

    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 3"},{"laneId":2,"name":"Piloto 2"}]}');
    expect(state.status).toBe('resting');
    expect(state.myLane).toBeNull();
    src.disconnect();
  });

  it('media de carrera: todas las vueltas del piloto, de todas las mangas', async () => {
    const { src, conn } = await connectNew();
    let state!: LiveState;
    src.onStateChange(s => { state = s; });
    src.selectParticipant('#001');
    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"}]}');
    conn.h.onMessage(lap(10, 1, 'Piloto 1', 3.0));
    conn.h.onMessage(lap(11, 1, 'Piloto 1', 3.2));
    expect(state.raceAvgLapMs).toBe(3100);

    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 2"},{"laneId":2,"name":"Piloto 1"}]}');
    conn.h.onMessage(lap(12, 2, 'Piloto 1', 3.4));
    expect(state.avgLapMs).toBe(3400);        // media de carril: solo esta manga
    expect(state.raceAvgLapMs).toBe(3200);    // media de carrera: las tres
    src.disconnect();
  });

  it('secuencia real: tanda libre, CONFIG duplicado y carrera reiniciada', async () => {
    const { src, conn } = await connectNew();
    let state!: LiveState;
    const events: SourceEvent[] = [];
    const snaps: { raceId: string; standings: { name: string }[] }[] = [];
    src.onStateChange(s => { state = s; });
    src.onEvent(e => events.push(e));
    src.onRaceStatsSnapshot(s => snaps.push(s as never));
    src.selectParticipant('#002');

    // Tanda libre: carriles sin piloto, isRace false, sin CONFIG.
    const libre = (frame: number, lane: number, sec: number) =>
      `{"type":"LAP","frame":${frame},"laneId":${lane},"pilotName":"Carril ${lane}","lapTime":${sec},"isFastLap":false,"position":0,"isRace":false,"isFirstLap":false}`;
    conn.h.onMessage(libre(53, 1, 16.0));
    conn.h.onMessage(libre(54, 2, 17.1));
    conn.h.onMessage(libre(55, 1, 15.4));
    expect(events.filter(e => e.type === 'entity-lap')).toHaveLength(0);

    // El TicTac manda RIVALS + CONFIG dos veces al arrancar la carrera.
    const rivals = '{"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 1","vme":0.0,"isRacing":true,"laneId":1,"gap":null},{"position":2,"name":"Piloto 2","vme":0.0,"isRacing":true,"laneId":2,"gap":null}]}';
    const config = '{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"}],"rivals":[]}';
    conn.h.onMessage(rivals); conn.h.onMessage(config);
    conn.h.onMessage(rivals); conn.h.onMessage(config);
    expect(events.filter(e => e.type === 'race-started')).toHaveLength(1);
    expect(events.filter(e => e.type === 'manga-changed')).toEqual([{ type: 'manga-changed', newMangaNum: 1, newLane: 2 }]);
    expect(state.currentMangaNum).toBe(1);
    expect(snaps).toHaveLength(0);   // la tanda libre no va al histórico

    conn.h.onMessage(lap(111, 2, 'Piloto 2', 0));
    conn.h.onMessage(lap(112, 1, 'Piloto 1', 16.2));
    conn.h.onMessage(lap(113, 2, 'Piloto 2', 16.5));
    expect(state.lapCount).toBe(1);
    expect(events.filter(e => e.type === 'entity-lap')).toHaveLength(2);

    // Reinicio: clasificación a cero y CONFIG con los mismos carriles.
    conn.h.onMessage(rivals); conn.h.onMessage(config);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.standings.map(x => x.name).sort()).toEqual(['Piloto 1', 'Piloto 2']);
    expect(state.currentMangaNum).toBe(1);
    expect(state.lapCount).toBe(0);
    expect(events.filter(e => e.type === 'race-started')).toHaveLength(2);

    conn.h.onMessage(lap(120, 2, 'Piloto 2', 16.0));
    src.disconnect();
    expect(snaps).toHaveLength(2);
    expect(snaps[1]!.raceId).not.toBe(snaps[0]!.raceId);   // carrera nueva en el histórico
  });

  it('seguimiento de rivales: solo mangas cerradas por CONFIG de manga nueva', async () => {
    const { src, conn } = await connectNew();
    src.selectParticipant('#001');
    let avisos = 0;
    src.onTrackingChange(() => { avisos++; });
    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"}]}');
    conn.h.onMessage(lap(1, 1, 'Piloto 1', 0));      // salida: cuenta sin tiempo
    conn.h.onMessage(lap(2, 1, 'Piloto 1', 3.0));
    conn.h.onMessage(lap(3, 2, 'Piloto 2', 3.2));
    let d = (await src.getTracking())!;
    expect(d.teams[0]).toMatchObject({ name: 'Piloto 1', isMe: true, laps: 0 });

    conn.h.onMessage('{"type":"CONFIG","mangaPilots":[{"laneId":1,"name":"Piloto 2"},{"laneId":2,"name":"Piloto 1"}]}');
    expect(avisos).toBeGreaterThan(0);
    await src.setTracked(['Piloto 2']);
    d = (await src.getTracking())!;
    expect(d.teams.map(t => [t.name, t.laps, t.avgMs])).toEqual([['Piloto 1', 2, 3000], ['Piloto 2', 1, 3200]]);
    expect(d.teams[0]!.lanes).toEqual([{ lane: 1, laps: 2, bestMs: 3000, avgMs: 3000, avgCleanMs: null }]);

    src.resetTracking();
    expect((await src.getTracking())!.teams[0]!.laps).toBe(0);
    src.disconnect();
  });

  async function connectAntiguo() {
    udp.handlers = {}; ws.opened = [];
    const src = new InfolapSource();
    const p = src.connect();
    for (let i = 0; i < 5 && !udp.handlers.message; i++) await Promise.resolve();
    udp.handlers.message!(new Uint8Array(Buffer.from('OK Piloto 1;#001Piloto 2;#002')), { address: '192.168.10.9' });
    ws.opened[0]!.h.onClose('ECONNREFUSED');
    const info = await p;
    let state!: LiveState;
    const snaps: unknown[] = [];
    src.onStateChange(s => { state = s; });
    src.onRaceStatsSnapshot(s => snaps.push(s));
    src.setMangaDurationMs(5 * 60_000);
    const send = (seq: number, lane: number, name: string, ms: number | null, nueva = true) =>
      udp.handlers.message!(paqueteUdp(seq, lane, name, ms, nueva), { address: '192.168.10.9' });
    const restante = () => { jest.advanceTimersByTime(1_000); return state.remainingMs; };
    return { src, info, snaps, send, restante };
  }

  it('TicTac antiguo: conectado antes de la manga, el reloj arranca con la primera vuelta', async () => {
    jest.useFakeTimers();
    try {
      const { src, info, snaps, send, restante } = await connectAntiguo();
      expect(info.protocoloTicTac).toBe('antiguo');
      send(1, 1, 'Piloto 1', null);
      send(2, 2, 'Piloto 2', null);
      expect(restante()).toBeNull();

      send(3, 1, 'Piloto 1', 4000);
      expect(restante()).toBe(5 * 60_000 - 5_000);

      // Manga nueva (rotan los pilotos) sin piloto seleccionado: se guarda la
      // anterior y el reloj espera; la repetición de la vuelta vieja no cuenta.
      send(3, 1, 'Piloto 2', 4000, false);
      send(2, 2, 'Piloto 1', null);
      expect(snaps).toHaveLength(1);
      expect(restante()).toBeNull();
      send(4, 2, 'Piloto 1', 3000);
      expect(restante()).toBe(5 * 60_000 - 4_000);
      src.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TicTac antiguo: conectado con la manga empezada, el reloj espera a la siguiente', async () => {
    jest.useFakeTimers();
    try {
      const { src, send, restante } = await connectAntiguo();
      // El Gestor repite la última vuelta de cada carril: manga en marcha.
      send(40, 1, 'Piloto 1', 3000, false);
      send(41, 2, 'Piloto 2', 3200, false);
      send(42, 1, 'Piloto 1', 3100);
      expect(restante()).toBeNull();

      // Rotación: la siguiente manga sí se cronometra.
      send(42, 1, 'Piloto 2', 3100, false);
      send(41, 2, 'Piloto 1', 3200, false);
      expect(restante()).toBeNull();
      send(43, 2, 'Piloto 1', 3000);
      expect(restante()).toBe(5 * 60_000 - 4_000);
      src.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });

  it('TicTac antiguo: si el WSS falla sigue con UDP y calcula la clasificación', async () => {
    udp.handlers = {}; ws.opened = [];
    const src = new InfolapSource();
    const p = src.connect();
    for (let i = 0; i < 5 && !udp.handlers.message; i++) await Promise.resolve();
    udp.handlers.message!(new Uint8Array(Buffer.from('OK Piloto 1;#001Piloto 2;#002')), { address: '192.168.10.9' });
    ws.opened[0]!.h.onClose('ECONNREFUSED');
    const info = await p;
    expect(info.capabilities.positions).toBe(true);

    let state!: LiveState;
    const events: SourceEvent[] = [];
    src.onStateChange(s => { state = s; });
    src.onEvent(e => events.push(e));
    src.selectParticipant('#002');
    const send = (seq: number, lane: number, name: string, ms: number) =>
      udp.handlers.message!(paqueteUdp(seq, lane, name, ms), { address: '192.168.10.9' });

    send(1, 1, 'Piloto 1', 3000);
    send(1, 2, 'Piloto 2', 3200);
    expect(state.position).toBe(2);
    expect(state.aheadName).toBe('Piloto 1');
    expect(state.gapAheadMs).toBe(200);

    send(2, 1, 'Piloto 1', 3010);
    send(2, 2, 'Piloto 2', 3100);
    expect(state.gapAheadMs).toBe(290);   // 6300 − 6010 al cerrar la vuelta 2

    send(3, 1, 'Piloto 1', 3500);         // P1 va una vuelta por delante
    expect(state.position).toBe(2);
    send(3, 2, 'Piloto 2', 2900);         // 9200 < 9510 → adelanto
    expect(state.position).toBe(1);
    expect(state.behindName).toBe('Piloto 1');
    expect(state.gapBehindMs).toBe(310);
    expect(events).toContainEqual({ type: 'position-changed', from: 2, to: 1 });

    // Rotación de carriles (otro piloto en el carril 1) → manga cerrada.
    expect((await src.getTracking())!.teams[0]!.laps).toBe(0);
    send(4, 1, 'Piloto 2', 3300);
    const d = (await src.getTracking())!;
    expect(d.teams[0]).toMatchObject({ name: 'Piloto 2', laps: 3, bestMs: 2900 });
    src.disconnect();
  });
});
