jest.mock('react-native-webrtc', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

import { decidirSalida } from './salidaAudio';

const base = { modoAsistente: 'walkie' as const, cascos: false, altavozPedido: null };

describe('decidirSalida', () => {
  it('piloto: nunca altavoz y aviso si no lleva cascos', () => {
    expect(decidirSalida({ ...base, rol: 'piloto', altavozPedido: true })).toEqual({
      altavoz: false, permiteAltavoz: false, avisoCascos: true, semiduplex: false,
    });
    expect(decidirSalida({ ...base, rol: 'piloto', cascos: true }).avisoCascos).toBe(false);
  });

  it('asistente en micro abierto: igual que el piloto', () => {
    const d = decidirSalida({ ...base, rol: 'asistente', modoAsistente: 'abierto', altavozPedido: true });
    expect(d.altavoz).toBe(false);
    expect(d.avisoCascos).toBe(true);
  });

  it('asistente en walkie: altavoz si lo pide, con semidúplex sin cascos', () => {
    expect(decidirSalida({ ...base, rol: 'asistente' }).altavoz).toBe(false);
    const d = decidirSalida({ ...base, rol: 'asistente', altavozPedido: true });
    expect(d).toEqual({ altavoz: true, permiteAltavoz: true, avisoCascos: false, semiduplex: true });
    expect(decidirSalida({ ...base, rol: 'asistente', altavozPedido: true, cascos: true }).semiduplex).toBe(false);
  });

  it('seguidor: altavoz por defecto, sin semidúplex', () => {
    expect(decidirSalida({ ...base, rol: 'seguidor' })).toEqual({
      altavoz: true, permiteAltavoz: true, avisoCascos: false, semiduplex: false,
    });
    expect(decidirSalida({ ...base, rol: 'seguidor', altavozPedido: false }).altavoz).toBe(false);
  });
});
