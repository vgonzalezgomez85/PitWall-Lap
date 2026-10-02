import { mapTracking } from './PitWallSource';

describe('mapTracking (respuesta del Manager)', () => {
  it('avgAllMs → Media y avgCleanMs → Limpia', () => {
    const d = mapTracking({
      max: 5,
      tracked: ['Rojo'],
      candidates: [{ name: 'Rojo', color: '#f00' }],
      teams: [
        { name: 'Azul', isMe: true, color: '#00f', laps: 40, bestMs: 15_400, avgAllMs: 16_100, avgCleanMs: 15_900,
          lanes: [{ lane: 1, laps: 40, bestMs: 15_400, avgAllMs: 16_100, avgCleanMs: 15_900 }] },
        { name: 'Rojo', isMe: false, color: '#f00', laps: 0, bestMs: null, avgAllMs: null, avgCleanMs: null, lanes: [] },
      ],
      pinRequired: true,
    });
    expect(d).toMatchObject({ hasClean: true, local: false, pinRequired: true, tracked: ['Rojo'] });
    expect(d.teams[0]).toMatchObject({ avgMs: 16_100, avgCleanMs: 15_900 });
    expect(d.teams[0]!.lanes[0]).toEqual({ lane: 1, laps: 40, bestMs: 15_400, avgMs: 16_100, avgCleanMs: 15_900 });
  });
});
