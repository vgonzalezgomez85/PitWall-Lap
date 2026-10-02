import {
  buildProjection, buildSnapshot, catchUpPaceMs, clasificacionLocal, gapMsToLaps, type PilotStats,
} from './infolapRace';
import type { InfolapRival } from './infolapWss';

const stats = (name: string, laps: number, avg: number, best = avg - 100): PilotStats =>
  ({ name, laps, sumMs: laps * avg, bestMs: best, mangas: new Set([1]) });

const rival = (position: number, name: string, gapMs: number | null, vmeMs: number | null = 3000): InfolapRival =>
  ({ position, laneId: position, name, gapMs, vmeMs, isRacing: true });

describe('gapMsToLaps', () => {
  it('redondea al número de vueltas', () => {
    expect(gapMsToLaps(4500, 3000)).toBe(2);
    expect(gapMsToLaps(1000, 3000)).toBe(0);
    expect(gapMsToLaps(null, 3000)).toBeNull();
    expect(gapMsToLaps(1000, null)).toBeNull();
  });
});

describe('catchUpPaceMs', () => {
  it('rival corriendo: p = pa·R/(R+gap)', () => {
    // 3 s de gap, quedan 60 s, él va a 3,0 s/vuelta.
    expect(catchUpPaceMs({
      remainingMs: 60_000, gapMs: 3000, aheadPaceMs: 3000, aheadRacing: true, myPaceMs: 3100, myBestMs: 2500,
    })).toBe(Math.round((3000 * 60_000) / 63_000));
  });
  it('rival descansando: basta cubrir el gap', () => {
    // gap de 3 s a mi ritmo de 3 s = 1 vuelta en 60 s → 60 s/vuelta.
    expect(catchUpPaceMs({
      remainingMs: 60_000, gapMs: 3000, aheadPaceMs: 2900, aheadRacing: false, myPaceMs: 3000, myBestMs: 2500,
    })).toBe(60_000);
  });
  it('inalcanzable (más rápido que mi mejor vuelta) o sin tiempo → null', () => {
    expect(catchUpPaceMs({
      remainingMs: 10_000, gapMs: 9000, aheadPaceMs: 3000, aheadRacing: true, myPaceMs: 3000, myBestMs: 2900,
    })).toBeNull();
    expect(catchUpPaceMs({
      remainingMs: 0, gapMs: 1000, aheadPaceMs: 3000, aheadRacing: true, myPaceMs: 3000, myBestMs: 2000,
    })).toBeNull();
  });
});

describe('buildProjection', () => {
  it('proyecta los que corren y deja fijos los que descansan', () => {
    const st = new Map([
      ['alfa', stats('Alfa', 20, 3000)],
      ['beta', stats('Beta', 18, 3000)],
    ]);
    const rows = buildProjection(
      [rival(1, 'Alfa', 0), rival(2, 'Beta', 5000), rival(3, 'Gamma', 9000, 3500)],
      st, new Set(['alfa', 'gamma']), 30_000,
    );
    expect(rows.map(r => [r.name, r.total, r.projectedTotal])).toEqual([
      ['Alfa', 20, 30],        // 20 + 30 s / 3 s
      ['Beta', 18, 18],        // descansa
      ['Gamma', 0, 8.6],       // sin vueltas vistas: ritmo = vme
    ]);
    expect(rows[1]!.gapV).toBe(12);
    expect(rows[0]!.avgLapMs).toBe(3000);
  });
});

describe('buildSnapshot', () => {
  it('ordena por la clasificación oficial y rellena medias', () => {
    const st = new Map([
      ['alfa', stats('Alfa', 10, 3000, 2800)],
      ['beta', stats('Beta', 12, 2900, 2700)],
    ]);
    const snap = buildSnapshot({
      raceId: 'tictac-1', name: 'TicTac', startedAt: 'a', finishedAt: 'b',
      stats: st, rivals: [rival(1, 'Alfa', 0), rival(2, 'Beta', 1000)],
    });
    expect(snap?.standings.map(s => [s.position, s.name, s.totalLaps, s.avgLapMs, s.bestLapMs]))
      .toEqual([[1, 'Alfa', 10, 3000, 2800], [2, 'Beta', 12, 2900, 2700]]);
  });
  it('sin vueltas → null', () => {
    expect(buildSnapshot({
      raceId: 'x', name: 'x', startedAt: 'a', finishedAt: 'b', stats: new Map(), rivals: [],
    })).toBeNull();
  });
});

describe('clasificacionLocal (TicTac antiguo)', () => {
  it('ordena por vueltas y tiempo, con gap en meta respecto al líder', () => {
    const r = clasificacionLocal([
      { name: 'B', laneId: 2, cumMs: [3200, 6300] },
      { name: 'A', laneId: 1, cumMs: [3000, 6010, 9510] },
      { name: 'C', laneId: null, cumMs: [3100, 6200] },
      { name: 'Sin vueltas', laneId: 3, cumMs: [] },
    ]);
    expect(r.map(x => [x.position, x.name, x.gapMs])).toEqual([
      [1, 'A', 0],
      [2, 'C', 190],   // 6200 − 6010: cuando A cerró su vuelta 2
      [3, 'B', 290],
    ]);
    expect(r[1]).toMatchObject({ isRacing: false, laneId: 0, vmeMs: 3100 });
    expect(r[2]).toMatchObject({ isRacing: true, laneId: 2, vmeMs: 3150 });
  });

  it('sin vueltas no hay clasificación', () => {
    expect(clasificacionLocal([{ name: 'A', laneId: 1, cumMs: [] }])).toEqual([]);
  });
});
