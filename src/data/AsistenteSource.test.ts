import { AsistenteSource } from './AsistenteSource';
import { emitirMensajeRadio } from '../radio/bus';
import type { LiveState, SourceEvent, RaceStatsSnapshot } from './types';

describe('AsistenteSource', () => {
  function montar(nombre = 'Piloto') {
    const src = new AsistenteSource(nombre);
    const estados: LiveState[] = [];
    const eventos: SourceEvent[] = [];
    const snaps: RaceStatsSnapshot[] = [];
    src.onStateChange(s => estados.push(s));
    src.onEvent(e => eventos.push(e));
    src.onRaceStatsSnapshot(s => snaps.push(s));
    return { src, estados, eventos, snaps };
  }

  it('connect devuelve la fuente asistente con un solo participante', async () => {
    const { src } = montar();
    const info = await src.connect();
    expect(info.source).toBe('asistente');
    expect(info.format).toBe('individual');
    expect(info.name).toBe('Radio');
    expect(info.participants).toEqual([{ id: 'piloto', name: 'Piloto' }]);
    expect(info.capabilities.lapTimes).toBe(true);
    expect(info.capabilities.positions).toBe(false);
  });

  it('traduce vuelta a estado y evento lap-completed', async () => {
    const { src, estados, eventos } = montar();
    await src.connect();

    emitirMensajeRadio({ tipo: 'inicio' });
    emitirMensajeRadio({ tipo: 'vuelta', n: 1, ms: 7000, ts: 1 });
    emitirMensajeRadio({ tipo: 'vuelta', n: 2, ms: 6500, ts: 2 });

    const s = estados[estados.length - 1]!;
    expect(s.lapCount).toBe(2);
    expect(s.lastLapMs).toBe(6500);
    expect(s.bestLapMs).toBe(6500);
    expect(s.avgLapMs).toBe(6750);
    expect(s.status).toBe('my-turn');

    const laps = eventos.filter(e => e.type === 'lap-completed');
    expect(laps).toEqual([
      { type: 'lap-completed', lapTimeMs: 7000, lapCount: 1 },
      { type: 'lap-completed', lapTimeMs: 6500, lapCount: 2 },
    ]);
    expect(eventos[0]).toEqual({ type: 'race-started' });
  });

  it('deshacer borra la vuelta y recalcula', async () => {
    const { src, estados } = montar();
    await src.connect();

    emitirMensajeRadio({ tipo: 'inicio' });
    emitirMensajeRadio({ tipo: 'vuelta', n: 1, ms: 9000, ts: 1 });
    emitirMensajeRadio({ tipo: 'vuelta', n: 2, ms: 6000, ts: 2 });
    emitirMensajeRadio({ tipo: 'deshacer', n: 2 });

    const s = estados[estados.length - 1]!;
    expect(s.lapCount).toBe(1);
    expect(s.lastLapMs).toBe(9000);
    expect(s.bestLapMs).toBe(9000);
  });

  it('fin marca la carrera terminada y emite snapshot', async () => {
    const { src, estados, eventos, snaps } = montar();
    await src.connect();

    emitirMensajeRadio({ tipo: 'inicio' });
    emitirMensajeRadio({ tipo: 'vuelta', n: 1, ms: 7000, ts: 1 });
    emitirMensajeRadio({ tipo: 'fin' });

    expect(estados[estados.length - 1]!.status).toBe('race-finished');
    expect(eventos.some(e => e.type === 'race-finished')).toBe(true);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.standings[0]!.totalLaps).toBe(1);
    expect(snaps[0]!.standings[0]!.bestLapMs).toBe(7000);
  });

  it('no emite snapshot si no hubo vueltas', async () => {
    const { src, snaps } = montar();
    await src.connect();
    emitirMensajeRadio({ tipo: 'fin' });
    expect(snaps).toHaveLength(0);
  });

  it('ignora mensajes tras disconnect', async () => {
    const { src, estados } = montar();
    await src.connect();
    src.disconnect();
    const antes = estados.length;
    emitirMensajeRadio({ tipo: 'inicio' });
    emitirMensajeRadio({ tipo: 'vuelta', n: 1, ms: 7000, ts: 1 });
    expect(estados.length).toBe(antes);
  });
});
