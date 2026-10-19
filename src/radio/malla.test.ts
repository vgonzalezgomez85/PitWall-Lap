import type { Participante } from './mensajes';
import { firmaPar, planificarMalla, soyOferente, tieneMicro } from './malla';

const p = (id: string, rol: Participante['rol']): Participante => ({ id, nombre: id, rol });

describe('malla de voz', () => {
  it('habla quien es piloto o asistente', () => {
    expect(tieneMicro('piloto')).toBe(true);
    expect(tieneMicro('asistente')).toBe(true);
    expect(tieneMicro('seguidor')).toBe(false);
    expect(tieneMicro(null)).toBe(false);
  });

  it('en cada pareja ofrece uno solo', () => {
    expect(soyOferente('a', 'b')).toBe(true);
    expect(soyOferente('b', 'a')).toBe(false);
  });

  it('el piloto llega a todos y dos seguidores no se conectan entre sí', () => {
    const sala = [p('asistente', 'asistente'), p('b', 'piloto'), p('c', 'seguidor'), p('d', 'seguidor')];
    // El piloto «b» ofrece a «c» y «d» (ids mayores); a «asistente» le responde.
    expect(planificarMalla('b', sala, new Map())).toEqual({ cerrar: [], ofrecer: ['c', 'd'] });
    // Un seguidor no ofrece a otro seguidor ni a los que tienen id menor.
    expect(planificarMalla('c', sala, new Map())).toEqual({ cerrar: [], ofrecer: [] });
  });

  it('no toca lo que ya está bien y cierra lo que sobra', () => {
    const sala = [p('a', 'asistente'), p('b', 'piloto')];
    const actuales = new Map([['b', firmaPar('asistente', 'piloto')], ['z', 'm-']]);
    expect(planificarMalla('a', sala, actuales)).toEqual({ cerrar: ['z'], ofrecer: [] });
  });

  it('rehace la conexión si alguien deja de tener micro', () => {
    // «b» pasa de piloto a seguidor: la firma cambia y «a» la rehace.
    const sala = [p('a', 'asistente'), p('b', 'seguidor')];
    const actuales = new Map([['b', 'mm']]);
    expect(planificarMalla('a', sala, actuales)).toEqual({ cerrar: ['b'], ofrecer: ['b'] });
  });

  it('cierra si ninguno de los dos habla', () => {
    const sala = [p('a', 'seguidor'), p('b', 'seguidor')];
    expect(planificarMalla('a', sala, new Map([['b', 'm-']]))).toEqual({ cerrar: ['b'], ofrecer: [] });
  });
});
