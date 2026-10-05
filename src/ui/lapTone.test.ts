import { fmtDelta, lapDeltaLabel, lapTone } from './lapTone';

describe('lapTone', () => {
  it('sin datos es neutral', () => {
    expect(lapTone(null, 5000)).toBe('neutral');
    expect(lapTone(5000, null)).toBe('neutral');
    expect(lapTone(5000, 0)).toBe('neutral');
  });

  it('igual o por debajo de la mejor es mejor vuelta', () => {
    expect(lapTone(5000, 5000)).toBe('best');
    expect(lapTone(4990, 5000)).toBe('best');
  });

  it('dentro del 2 % es buena; por encima, lenta', () => {
    expect(lapTone(5100, 5000)).toBe('good');
    expect(lapTone(5101, 5000)).toBe('slow');
  });
});

describe('fmtDelta', () => {
  it('formatea con signo y centésimas', () => {
    expect(fmtDelta(230)).toBe('+0.23');
    expect(fmtDelta(-50)).toBe('−0.05');
    expect(fmtDelta(1234)).toBe('+1.23');
    expect(fmtDelta(4)).toBe('0.00');
  });
});

describe('lapDeltaLabel', () => {
  it('indica la mejor vuelta o el delta', () => {
    expect(lapDeltaLabel(5000, 5000)).toBe('Mejor vuelta');
    expect(lapDeltaLabel(5230, 5000)).toBe('+0.23 vs mejor');
    expect(lapDeltaLabel(null, 5000)).toBeNull();
  });
});
