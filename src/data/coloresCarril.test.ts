import { carrilEnTanda, colorDeCarril, COLORES_CARRIL_FABRICA } from './coloresCarril';
import type { ParticipantPlan } from './types';

const plan: ParticipantPlan = {
  id: '1',
  name: '123',
  mangas: [
    { tandaNum: 1, mangaNum: 1, lane: 3, isRest: false },
    { tandaNum: 1, mangaNum: 2, lane: 4, isRest: false },
    { tandaNum: 1, mangaNum: 3, lane: 5, isRest: true },
    { tandaNum: 2, mangaNum: 4, lane: 1, isRest: false },
  ],
};

describe('colorDeCarril', () => {
  it('usa los colores del servidor', () => {
    expect(colorDeCarril(2, ['#111111', '#222222'])).toBe('#222222');
  });

  it('cae a la paleta de fábrica sin colores del servidor', () => {
    expect(colorDeCarril(1)).toBe('#e63946');
    expect(colorDeCarril(6, [])).toBe('#00bcd4');
  });

  it('cae a la paleta de fábrica si el servidor manda menos carriles', () => {
    expect(colorDeCarril(3, ['#111111'])).toBe(COLORES_CARRIL_FABRICA[2]);
  });
});

describe('carrilEnTanda', () => {
  it('toma el carril de la manga en curso si es de la tanda', () => {
    expect(carrilEnTanda(plan, 1, 2)).toBe(4);
  });

  it('sin manga en curso de la tanda, toma la primera manga', () => {
    expect(carrilEnTanda(plan, 1, null)).toBe(3);
    expect(carrilEnTanda(plan, 1, 4)).toBe(3);
  });

  it('ignora descansos y tandas en las que no corre', () => {
    expect(carrilEnTanda(plan, 1, 3)).toBe(3);
    expect(carrilEnTanda(plan, 9, null)).toBeNull();
  });
});
