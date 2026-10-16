import { emitirMensajeRadio, onMensajeRadio, oyentesRadio } from './bus';
import type { MensajeRadio } from './mensajes';

describe('bus de mensajes de radio', () => {
  it('reparte un mensaje a todos los oyentes', () => {
    const recibidos: MensajeRadio[] = [];
    const off1 = onMensajeRadio(m => recibidos.push(m));
    const off2 = onMensajeRadio(m => recibidos.push(m));

    const msg: MensajeRadio = { tipo: 'vuelta', n: 1, ms: 7000, ts: 1 };
    emitirMensajeRadio(msg);

    expect(recibidos).toEqual([msg, msg]);
    expect(oyentesRadio()).toBe(2);

    off1();
    off2();
    expect(oyentesRadio()).toBe(0);
  });

  it('un oyente que lanza no impide que los demás reciban', () => {
    const recibidos: number[] = [];
    onMensajeRadio(() => {
      throw new Error('boom');
    });
    onMensajeRadio(() => recibidos.push(1));

    emitirMensajeRadio({ tipo: 'inicio' });
    expect(recibidos).toEqual([1]);
  });

  it('la cancelación deja de entregar', () => {
    const recibidos: MensajeRadio[] = [];
    const off = onMensajeRadio(m => recibidos.push(m));
    off();
    emitirMensajeRadio({ tipo: 'inicio' });
    expect(recibidos).toEqual([]);
  });
});
