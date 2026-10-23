import { vecinosGap } from './PitWallSource';
import type { ProjectionRow } from './types';

const fila = (name: string, entityId: number, gapV: number | null): ProjectionRow => ({
  position: 0, entityId, entityType: 'team', name, total: 0,
  projectedTotal: null, gapV, avgToCatch: null, avgLapMs: null,
});

// En la manga: A (carril 1) delante, YO (carril 2), C (carril 3) detrás.
const manga = [
  { lane: 1, name: 'A', lapCount: 30, position: 1 },
  { lane: 2, name: 'YO', lapCount: 28, position: 2 },
  { lane: 3, name: 'C', lapCount: 25, position: 3 },
];
const yo = { lane: 2, lapCount: 28 };

describe('vecinosGap', () => {
  it('usa la clasificación estimada cuando hay valor', () => {
    const proj = [fila('X', 9, null), fila('YO', 2, 1.6), fila('Z', 8, 2.4)];
    expect(vecinosGap(proj, 1, manga, yo)).toEqual({
      gapAheadLaps: 2, aheadName: 'X', gapBehindLaps: 2, behindName: 'Z',
    });
  });

  it('primero en la estimada: sin gap de delante, aunque en la manga haya alguien', () => {
    const proj = [fila('YO', 2, null), fila('Z', 8, 3.2)];
    expect(vecinosGap(proj, 0, manga, yo)).toMatchObject({ gapAheadLaps: null, aheadName: null });
  });

  it('último en la estimada: sin gap de detrás', () => {
    const proj = [fila('X', 9, null), fila('YO', 2, 1.2)];
    expect(vecinosGap(proj, 1, manga, yo)).toMatchObject({ gapBehindLaps: null, behindName: null });
  });

  it('sin proyección: cae al orden de manga', () => {
    expect(vecinosGap([], -1, manga, yo)).toEqual({
      gapAheadLaps: 2, aheadName: 'A', gapBehindLaps: 3, behindName: 'C',
    });
  });

  it('en la proyección pero sin gapV (sin media): cae a la manga', () => {
    const proj = [fila('X', 9, null), fila('YO', 2, null), fila('Z', 8, null)];
    expect(vecinosGap(proj, 1, manga, yo)).toEqual({
      gapAheadLaps: 2, aheadName: 'A', gapBehindLaps: 3, behindName: 'C',
    });
  });
});
