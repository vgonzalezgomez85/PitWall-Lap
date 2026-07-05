// Tests del cálculo puro de estrategia de neumáticos.
// Cubren: sin degradación → hold/scheduled (con y sin mínimo obligatorio),
// con degradación → change-in por √(2P/d), normalización por carril (Mejora 1),
// capa de posición (change/hold/neutral) y niveles de confianza.

import {
  computeTireStrategy,
  fitDegradation,
  MIN_CONFIDENCE_LAPS,
  type StrategyInputs,
} from './computeTireStrategy';
import type { ProjectionRow } from '../data/types';

function mkRow(over: Partial<ProjectionRow>): ProjectionRow {
  return {
    position: 1, entityId: 1, entityType: 'team', name: 'X',
    total: 0, projectedTotal: null, gapV: null, avgToCatch: null, avgLapMs: null,
    ...over,
  };
}

/** Stint perfectamente lineal: lap[i] = t0 + d·i (la 1ª es la out-lap que se salta). */
const linStint = (t0: number, d: number, n: number) =>
  Array.from({ length: n }, (_, i) => t0 + d * i);

const base: Omit<StrategyInputs, 'stintLaps'> = {
  pitCostMs: 25000, setsTotal: 4, changesMade: 0,
  followed: null, ahead: null, behind: null,
};

describe('MIN_CONFIDENCE_LAPS', () => {
  it('es 8', () => expect(MIN_CONFIDENCE_LAPS).toBe(8));
});

describe('recomendación temporal', () => {
  it('sin juegos disponibles → hold-to-end', () => {
    const r = computeTireStrategy({ ...base, setsTotal: 1, stintLaps: linStint(9700, 0, 10) });
    expect(r.recommendation.kind).toBe('hold-to-end');
    expect(r.setsAvailable).toBe(0);
  });

  it('sin degradación y sin cambios obligatorios → hold-to-end (no regalar tiempo)', () => {
    const r = computeTireStrategy({ ...base, mandatoryChanges: 0, stintLaps: linStint(9700, 0, 10) });
    expect(r.recommendation.kind).toBe('hold-to-end');
    expect(r.degradationMsPerLap).toBeLessThanOrEqual(0);
  });

  it('sin degradación pero con mínimo obligatorio → cambio pautado lo más tarde posible', () => {
    const r = computeTireStrategy({
      ...base,
      mandatoryChanges: 1,
      stintLaps: linStint(9700, 0, 10),
      followed: mkRow({ total: 100, projectedTotal: 200, avgLapMs: 9700 }),
    });
    expect(r.recommendation).toEqual({ kind: 'change-in', laps: 99, basis: 'scheduled' });
  });

  it('con degradación → change-in por √(2P/d), basis degradation', () => {
    // d=100, out-lap+11 → confianza ok. Sin followed → óptimo = L* = √(2·25000/100) ≈ 22.36.
    const r = computeTireStrategy({ ...base, stintLaps: linStint(9700, 100, 12) });
    expect(r.degradationMsPerLap).toBeCloseTo(100, 5);
    expect(r.recommendation).toEqual({ kind: 'change-in', laps: 10, basis: 'degradation' });
  });

  it('pocas vueltas → insufficient-data', () => {
    const r = computeTireStrategy({ ...base, stintLaps: linStint(9700, 50, 5) });
    expect(r.confidence).toBe('low');
    expect(r.recommendation.kind).toBe('insufficient-data');
  });
});

describe('normalización por carril (Mejora 1)', () => {
  it('misma goma en dos carriles NO genera degradación falsa', () => {
    // Goma plana, pero rueda 6 vueltas en carril rápido (9300) y luego 6 en
    // lento (9700). En bruto la recta sube (falsa degradación); normalizada ≈ 0.
    const laps = [...Array(6).fill(9300), ...Array(6).fill(9700)];
    const refs = [...Array(6).fill(9300), ...Array(6).fill(9700)];

    const raw = fitDegradation(laps);
    expect(raw.normalized).toBe(false);
    expect(raw.d!).toBeGreaterThan(0); // el bruto inventa degradación

    const norm = fitDegradation(laps, refs);
    expect(norm.normalized).toBe(true);
    expect(Math.abs(norm.d!)).toBeLessThan(1); // aislada la goma: sin desgaste
  });

  it('cae al ajuste bruto si falta cobertura de carril', () => {
    const laps = linStint(9700, 30, 10);
    const refs = [9700, null, null, null, null, null, null, null, null, null];
    expect(fitDegradation(laps, refs).normalized).toBe(false);
  });

  it('detecta degradación real bajo normalización (misma referencia de carril)', () => {
    const laps = linStint(9700, 40, 12);
    const refs = Array(12).fill(9700);
    const fit = fitDegradation(laps, refs);
    expect(fit.normalized).toBe(true);
    expect(fit.d!).toBeCloseTo(40, 5);
  });
});

describe('capa de posición', () => {
  const stint = linStint(9700, 60, 12); // d=60, currentAvg=10030, stintLap=12

  it('change → adelantas al de delante', () => {
    const r = computeTireStrategy({
      ...base,
      stintLaps: stint,
      followed: mkRow({ total: 200, projectedTotal: 300, avgLapMs: 10030 }),
      ahead: mkRow({ name: 'RIVAL-A', total: 200, projectedTotal: 276, avgLapMs: 10030 }),
    });
    expect(r.position?.action).toBe('change');
    expect(r.position?.text).toContain('RIVAL-A');
  });

  it('hold → si paras te adelanta el de detrás', () => {
    // d suave (20): parar cuesta más de lo que gana → no conviene parar.
    const r = computeTireStrategy({
      ...base,
      stintLaps: linStint(9700, 20, 12), // currentAvg=9810
      followed: mkRow({ total: 200, projectedTotal: 300, avgLapMs: 9810 }),
      behind: mkRow({ name: 'RIVAL-B', total: 200, projectedTotal: 289.5, avgLapMs: 9810 }),
    });
    expect(r.position?.action).toBe('hold');
    expect(r.position?.text).toContain('RIVAL-B');
  });

  it('neutral → sin cambio de posición previsto', () => {
    const r = computeTireStrategy({
      ...base,
      stintLaps: stint,
      followed: mkRow({ total: 200, projectedTotal: 300, avgLapMs: 10030 }),
      ahead: mkRow({ name: 'A', total: 200, projectedTotal: 1000, avgLapMs: 10030 }),
      behind: mkRow({ name: 'B', total: 200, projectedTotal: 0, avgLapMs: 10030 }),
    });
    expect(r.position?.action).toBe('neutral');
  });
});
