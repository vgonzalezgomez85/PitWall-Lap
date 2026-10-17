// Canal TCP de Radio: el socket entrega texto (setEncoding('utf8')) y el canal
// lo parte en líneas JSON aunque lleguen a trozos.

jest.mock('react-native-tcp-socket', () => ({}));

import { crearCanalTcp } from './tcp';

type Oyente = (arg?: unknown) => void;

function socketFalso() {
  const oyentes = new Map<string, Oyente[]>();
  const socket = {
    encoding: null as string | null,
    escrito: [] as string[],
    setEncoding(e: string) { socket.encoding = e; return socket; },
    write(t: string) { socket.escrito.push(t); },
    end() {},
    destroy() {},
    on(evento: string, cb: Oyente) {
      oyentes.set(evento, [...(oyentes.get(evento) ?? []), cb]);
      return socket;
    },
    emitir(evento: string, arg?: unknown) {
      for (const cb of oyentes.get(evento) ?? []) cb(arg);
    },
  };
  return socket;
}

describe('crearCanalTcp', () => {
  it('pide texto UTF-8 al socket', () => {
    const s = socketFalso();
    crearCanalTcp(s as never);
    expect(s.encoding).toBe('utf8');
  });

  it('entrega cada línea completa aunque llegue partida', () => {
    const s = socketFalso();
    const canal = crearCanalTcp(s as never);
    const recibidos: string[] = [];
    canal.onMensaje(t => recibidos.push(t));

    s.emitir('data', '{"tipo":"uni');
    s.emitir('data', 'rse","nombre":"Íñigo"}\n{"tipo":"vuelta"}\n');

    expect(recibidos).toEqual(['{"tipo":"unirse","nombre":"Íñigo"}', '{"tipo":"vuelta"}']);
  });

  it('termina cada envío con salto de línea', () => {
    const s = socketFalso();
    crearCanalTcp(s as never).enviar('{"tipo":"bienvenido"}');
    expect(s.escrito).toEqual(['{"tipo":"bienvenido"}\n']);
  });
});
