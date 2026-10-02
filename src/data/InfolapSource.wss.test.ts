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

      jest.advanceTimersByTime(90_000);
      expect(events).toContainEqual({ type: 'half-manga' });
      jest.advanceTimersByTime(30_000);
      expect(events).toContainEqual({ type: 'last-minute' });
      jest.advanceTimersByTime(30_000);
      expect(events).toContainEqual({ type: 'last-30s' });
      jest.advanceTimersByTime(31_000);
      expect(events).toContainEqual({ type: 'race-finished' });
      expect(state.remainingMs).toBe(0);
      expect(state.avgToCatchMs).toBeNull();
      expect(snaps).toHaveLength(1);

      src.disconnect();
      expect(snaps).toHaveLength(2);   // al desconectar se vuelve a guardar
      const last = snaps[1] as { standings: { name: string; totalLaps: number }[] };
      expect(last.standings.map(s => [s.name, s.totalLaps])).toEqual([['Piloto 1', 1], ['Piloto 2', 2]]);
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

  it('TicTac antiguo: si el WSS falla sigue con UDP', async () => {
    udp.handlers = {}; ws.opened = [];
    const src = new InfolapSource();
    const p = src.connect();
    for (let i = 0; i < 5 && !udp.handlers.message; i++) await Promise.resolve();
    udp.handlers.message!(new Uint8Array(Buffer.from('OK Piloto 1;#001')), { address: '192.168.10.9' });
    ws.opened[0]!.h.onClose('ECONNREFUSED');
    const info = await p;
    expect(info.capabilities.positions).toBe(false);
    src.disconnect();
  });
});
