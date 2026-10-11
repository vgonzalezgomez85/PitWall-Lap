// Entreno de competición: los equipos rotan de carril en cada heat, así que la
// app sigue al participante por nombre y no se queda fija en un carril. En el
// entreno libre, en cambio, se sigue el carril.

jest.mock('socket.io-client', () => {
  const { EventEmitter } = require('events');
  const socket = new EventEmitter();
  (socket as { disconnect: () => void }).disconnect = () => {};
  return { io: () => socket, __socket: socket };
});

import { PitWallSource } from './PitWallSource';
import type { LiveState, SourceEvent } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const socket = require('socket.io-client').__socket as import('events').EventEmitter;

const lane = (n: number, participantName: string | null) => ({
  lane: n, participantName, color: '#fff', count: 0, avgMs: null, bestMs: null, lastMs: null,
});

function respuestaTraining(competition: boolean) {
  return {
    active: true,
    competition,
    durationMs: 300000,
    lanes: competition
      ? [lane(1, 'Rojo'), lane(2, 'Circuit Nocturn')]
      : [lane(1, null), lane(2, null)],
    participants: competition
      ? [
          { name: 'Rojo', color: '#f00', lane: 1 },
          { name: 'Circuit Nocturn', color: '#00f', lane: 2 },
          { name: 'Verde', color: '#0f0', lane: null },
        ]
      : [],
  };
}

async function conectar(competition: boolean) {
  socket.removeAllListeners();
  (global as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => respuestaTraining(competition),
  });
  const src = new PitWallSource({ host: '1.2.3.4', port: 3000 }, { mode: 'training' });
  let estado: LiveState | null = null;
  const eventos: SourceEvent[] = [];
  src.onStateChange(s => { estado = s; });
  src.onEvent(e => { eventos.push(e); });
  await src.connect();
  return { src, eventos, estado: () => estado as LiveState | null };
}

const vuelta = (laneN: number, name: string | null, count: number, ms: number) => ({
  lane: laneN, participantName: name, lapTimeMs: ms, bestMs: ms, avgMs: ms, count,
});

describe('entreno de competición: seguimiento por participante', () => {
  it('los participantes son equipos (también el que descansa), no carriles', async () => {
    const { src } = await conectar(true);
    src.selectParticipant('Circuit Nocturn');
    // @ts-expect-error acceso al estado interno para el test
    expect(src.participants.map(p => p.id)).toEqual(['Rojo', 'Circuit Nocturn', 'Verde']);
  });

  it('empieza en su carril y cuenta sus vueltas', async () => {
    const { src, estado } = await conectar(true);
    src.selectParticipant('Circuit Nocturn');
    expect(estado()).toMatchObject({ status: 'my-turn', myLane: 2, lapCount: 0 });
    socket.emit('training:lap', vuelta(2, 'Circuit Nocturn', 1, 8100));
    expect(estado()).toMatchObject({ status: 'my-turn', myLane: 2, lapCount: 1, lastLapMs: 8100 });
  });

  it('cuando rotan, sigue al equipo al carril nuevo y deja de oír al que ocupa el viejo', async () => {
    const { src, estado, eventos } = await conectar(true);
    src.selectParticipant('Circuit Nocturn');
    socket.emit('training:lap', vuelta(2, 'Circuit Nocturn', 3, 8100));

    // Nuevo heat: Rojo pasa al 2 y Circuit Nocturn al 3.
    socket.emit('training:standby', [lane(1, 'Verde'), lane(2, 'Rojo'), lane(3, 'Circuit Nocturn')]);
    socket.emit('competition:heat', { heat: 2, resting: [] });
    expect(estado()).toMatchObject({ status: 'my-turn', myLane: 3, lapCount: 0, lastLapMs: null });
    expect(eventos.find(e => e.type === 'manga-changed')).toEqual({
      type: 'manga-changed', newMangaNum: 2, newLane: 3,
    });

    // Una vuelta de Rojo en el carril 2 (el que tenía yo) no es mía.
    socket.emit('training:lap', vuelta(2, 'Rojo', 1, 7900));
    expect(estado()).toMatchObject({ myLane: 3, lapCount: 0 });

    // Una vuelta mía en el carril 3 sí.
    socket.emit('training:lap', vuelta(3, 'Circuit Nocturn', 1, 8200));
    expect(estado()).toMatchObject({ myLane: 3, lapCount: 1, lastLapMs: 8200 });
  });

  it('si en el heat siguiente descansa, pasa a descanso y no avisa de carril', async () => {
    const { src, estado, eventos } = await conectar(true);
    src.selectParticipant('Circuit Nocturn');
    socket.emit('training:standby', [lane(1, 'Verde'), lane(2, 'Rojo')]);
    socket.emit('competition:heat', { heat: 2, resting: [{ restNum: 1, name: 'Circuit Nocturn' }] });
    expect(estado()).toMatchObject({ status: 'resting', myLane: null });
    expect(eventos.some(e => e.type === 'manga-changed')).toBe(false);

    // Y cuando vuelve a correr, vuelve a 'my-turn' en su carril nuevo.
    socket.emit('training:standby', [lane(1, 'Rojo'), lane(2, 'Circuit Nocturn')]);
    socket.emit('competition:heat', { heat: 3, resting: [] });
    expect(estado()).toMatchObject({ status: 'my-turn', myLane: 2 });
    expect(eventos.filter(e => e.type === 'manga-changed')).toHaveLength(1);
  });

  it('el que empieza descansando se engancha al carril cuando le toca', async () => {
    const { src, estado } = await conectar(true);
    src.selectParticipant('Verde');   // en el heat 1 descansa
    socket.emit('training:standby', [lane(1, 'Verde'), lane(2, 'Rojo')]);
    expect(estado()).toMatchObject({ status: 'my-turn', myLane: 1 });
  });
});

describe('entreno libre: sigue el carril', () => {
  it('no cambia de carril aunque cambien los datos del carril', async () => {
    const { src, estado } = await conectar(false);
    src.selectParticipant('2');
    socket.emit('training:lap', vuelta(2, null, 1, 9000));
    expect(estado()).toMatchObject({ status: 'my-turn', myLane: 2, lapCount: 1 });
    socket.emit('training:lap', vuelta(1, null, 1, 9100));
    expect(estado()).toMatchObject({ myLane: 2, lapCount: 1 });
  });
});
