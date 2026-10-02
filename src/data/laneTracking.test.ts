import { LaneTracker, MAX_TRACKED, SILENCE_CLOSE_MS, buildLocalTracking } from './laneTracking';

describe('LaneTracker', () => {
  it('solo cuenta las mangas cerradas', () => {
    const t = new LaneTracker();
    t.addCrossing('Piloto 1', 1, null, 1000);   // salida: vuelta sin tiempo
    t.addCrossing('Piloto 1', 1, 16_000, 2000);
    t.addCrossing('Piloto 1', 1, 15_500, 3000);
    expect(t.stats().size).toBe(0);

    expect(t.closeManga()).toBe(true);
    expect(t.stats().get('piloto 1')).toEqual({
      name: 'Piloto 1', laps: 3, bestMs: 15_500, avgMs: 15_750,
      lanes: [{ lane: 1, laps: 3, bestMs: 15_500, avgMs: 15_750 }],
    });

    t.addCrossing('piloto 1', 2, 17_000, 4000);   // otra manga, otro carril
    expect(t.stats().get('piloto 1')!.laps).toBe(3);
    t.closeManga();
    const s = t.stats().get('piloto 1')!;
    expect(s.lanes.map(l => [l.lane, l.laps])).toEqual([[1, 3], [2, 1]]);
    expect(s).toMatchObject({ laps: 4, bestMs: 15_500, avgMs: Math.round(48_500 / 3) });
    expect(t.closeManga()).toBe(false);   // nada abierto
  });

  it('cierre provisional por silencio que se reabre si vuelven las vueltas', () => {
    const t = new LaneTracker();
    t.addCrossing('A', 1, 3000, 10_000);
    expect(t.checkSilence(10_000 + SILENCE_CLOSE_MS - 1)).toBe(false);
    expect(t.checkSilence(10_000 + SILENCE_CLOSE_MS)).toBe(true);
    expect(t.stats().get('a')!.laps).toBe(1);
    expect(t.checkSilence(10_000 + 2 * SILENCE_CLOSE_MS)).toBe(false);   // ya estaba

    t.addCrossing('A', 1, 3100, 200_000);   // era una pausa
    expect(t.openIncluded).toBe(false);
    expect(t.stats().size).toBe(0);
    t.softClose();
    expect(t.stats().get('a')!.laps).toBe(2);
  });

  it('se serializa y se recupera', () => {
    const t = new LaneTracker();
    t.addCrossing('A', 1, 3000, 5000);
    t.closeManga();
    t.addCrossing('A', 2, 2900, 6000);
    const back = LaneTracker.fromJSON(JSON.parse(JSON.stringify(t.toJSON())))!;
    expect(back.stats()).toEqual(t.stats());
    expect(back.lastActivityAt).toBe(6000);
    back.closeManga();
    expect(back.stats().get('a')!.laps).toBe(2);
    expect(LaneTracker.fromJSON({ v: 2 })).toBeNull();
  });
});

describe('buildLocalTracking', () => {
  it('el propio primero, luego los seguidos en orden; candidatos sin el propio', () => {
    const t = new LaneTracker();
    t.addCrossing('Piloto 1', 1, 3000);
    t.addCrossing('Piloto 3', 2, 3100);
    t.closeManga();
    const d = buildLocalTracking({
      stats: t.stats(),
      selfName: 'piloto 1',
      tracked: ['Piloto 3', 'Piloto 2', 'Piloto 1'],
      participants: ['Piloto 1', 'Piloto 2'],
    });
    expect(d.teams.map(x => [x.name, x.isMe, x.laps])).toEqual([
      ['Piloto 1', true, 1], ['Piloto 3', false, 1], ['Piloto 2', false, 0],
    ]);
    expect(d.candidates.map(c => c.name)).toEqual(['Piloto 2', 'Piloto 3']);
    expect(d).toMatchObject({ local: true, hasClean: false, pinRequired: false, max: MAX_TRACKED });
    expect(d.teams[0]!.lanes[0]).toMatchObject({ lane: 1, avgMs: 3000, avgCleanMs: null });
  });
});
