import {
  hasTireControl, findTeam, ownTireInfo, resolveTireInputs,
} from './serverTires';
import { computeTireStrategy } from './computeTireStrategy';
import type { TireControlState } from '../data/types';

function control(allowance: number, teams: { name: string; used: number; changes?: number }[]): TireControlState {
  return {
    allowance,
    teams: teams.map(t => ({
      name: t.name,
      used: t.used,
      available: allowance - t.used,
      changes: Array.from({ length: t.changes ?? t.used }, (_, i) => ({
        setNumber: i + 1,
        mangaNumber: i + 1,
        raceElapsedMs: (i + 1) * 60_000,
        createdAtMs: (i + 1) * 1000,
      })),
    })),
  };
}

describe('hasTireControl', () => {
  it('null / dotación 0 → sin control', () => {
    expect(hasTireControl(null)).toBe(false);
    expect(hasTireControl(control(0, [{ name: 'Alfa', used: 0 }]))).toBe(false);
  });
  it('dotación > 0 → con control', () => {
    expect(hasTireControl(control(4, [{ name: 'Alfa', used: 0 }]))).toBe(true);
  });
});

describe('findTeam / ownTireInfo', () => {
  const tc = control(4, [{ name: 'Alfa', used: 2 }, { name: 'Beta', used: 0 }]);

  it('casa el equipo por nombre', () => {
    expect(findTeam(tc, 'Beta')?.name).toBe('Beta');
    expect(findTeam(tc, 'Ninguno')).toBeNull();
    expect(findTeam(tc, null)).toBeNull();
  });

  it('ownTireInfo devuelve dotación/usados/restantes y el último cambio', () => {
    const own = ownTireInfo(tc, 'Alfa')!;
    expect(own.allowance).toBe(4);
    expect(own.used).toBe(2);
    expect(own.available).toBe(2);
    expect(own.lastChange?.setNumber).toBe(2);   // el más reciente
  });

  it('null cuando no hay control o no casa el equipo', () => {
    expect(ownTireInfo(null, 'Alfa')).toBeNull();
    expect(ownTireInfo(control(0, [{ name: 'Alfa', used: 0 }]), 'Alfa')).toBeNull();
    expect(ownTireInfo(tc, 'Zeta')).toBeNull();
  });
});

describe('resolveTireInputs', () => {
  it('sin control usa los valores manuales (fallback)', () => {
    const r = resolveTireInputs(null, 'Alfa', 4, 1);
    expect(r).toEqual({ serverDriven: false, setsTotal: 4, changesMade: 1 });
  });

  it('con control mapea setsTotal = allowance + 1 y changesMade = used', () => {
    const tc = control(4, [{ name: 'Alfa', used: 1 }]);
    const r = resolveTireInputs(tc, 'Alfa', 99, 99);
    expect(r.serverDriven).toBe(true);
    expect(r.setsTotal).toBe(5);
    expect(r.changesMade).toBe(1);
  });

  it('el mapeo reproduce el `available` del servidor en computeTireStrategy', () => {
    const tc = control(4, [{ name: 'Alfa', used: 1 }]);   // available = 3
    const r = resolveTireInputs(tc, 'Alfa', 0, 0);
    const res = computeTireStrategy({
      stintLaps: [], pitCostMs: 25_000,
      setsTotal: r.setsTotal, changesMade: r.changesMade,
      followed: null, ahead: null, behind: null,
    });
    expect(res.setsAvailable).toBe(3);       // == available del Manager
    expect(res.changesRemaining).toBe(3);
  });

  it('sin juegos restantes → changesRemaining 0 (dotación agotada)', () => {
    const tc = control(2, [{ name: 'Alfa', used: 2 }]);   // available = 0
    const r = resolveTireInputs(tc, 'Alfa', 0, 0);
    const res = computeTireStrategy({
      stintLaps: [], pitCostMs: 25_000,
      setsTotal: r.setsTotal, changesMade: r.changesMade,
      followed: null, ahead: null, behind: null,
    });
    expect(res.setsAvailable).toBe(0);
  });
});
