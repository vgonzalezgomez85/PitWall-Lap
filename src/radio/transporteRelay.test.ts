import { crearTransporteRelay, motivoCierre, type SocketMin } from './transporteRelay';

/** WebSocket de mentira: guarda lo enviado y deja simular lo que llega. */
function socketFalso(url: string) {
  const s: SocketMin & { url: string; enviados: string[]; cerrado?: number } = {
    url, enviados: [],
    send(t) { s.enviados.push(t); },
    close(code) { s.cerrado = code ?? 1000; },
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  return s;
}

describe('transporte por el relé', () => {
  it('anfitrión: multiplexa a cada invitado en su canal', async () => {
    const sockets: ReturnType<typeof socketFalso>[] = [];
    const t = crearTransporteRelay('k7m-4qx', url => { const s = socketFalso(url); sockets.push(s); return s; });
    const recibidos: string[] = [];
    const cierres: string[] = [];
    const espera = t.escuchar(canal => {
      canal.onMensaje(m => recibidos.push(m));
      canal.onCerrar(() => cierres.push('cerrado'));
      canal.enviar('{"tipo":"bienvenido"}');
    });
    const ws = sockets[0]!;
    expect(ws.url).toMatch(/\/sala\/K7M4QX\/anfitrion$/);
    ws.onopen!();
    await espera;

    ws.onmessage!({ data: JSON.stringify({ abre: 'g1' }) });
    expect(ws.enviados).toEqual([JSON.stringify({ c: 'g1', t: '{"tipo":"bienvenido"}' })]);
    ws.onmessage!({ data: JSON.stringify({ c: 'g1', t: '{"tipo":"unirse"}' }) });
    expect(recibidos).toEqual(['{"tipo":"unirse"}']);
    ws.onmessage!({ data: JSON.stringify({ cierra: 'g1' }) });
    expect(cierres).toEqual(['cerrado']);
  });

  it('anfitrión: si el código está en uso, falla con un error claro', async () => {
    const t = crearTransporteRelay('K7M4QX', url => {
      const s = socketFalso(url);
      setTimeout(() => s.onclose!({ code: 4409 }), 0);
      return s;
    });
    await expect(t.escuchar(() => {})).rejects.toThrow('ya está en uso');
  });

  it('invitado: líneas tal cual y error legible si la sala no existe', async () => {
    let ws: ReturnType<typeof socketFalso> | null = null;
    const t = crearTransporteRelay('K7M4QX', url => (ws = socketFalso(url)));
    const p = t.conectar('', 0);
    ws!.onopen!();
    const canal = await p;
    const llegados: string[] = [];
    canal.onMensaje(m => llegados.push(m));
    canal.enviar('hola');
    ws!.onmessage!({ data: 'adios' });
    expect(ws!.enviados).toEqual(['hola']);
    expect(llegados).toEqual(['adios']);

    const t2 = crearTransporteRelay('K7M4QX', url => {
      const s = socketFalso(url);
      setTimeout(() => s.onclose!({ code: 4404 }), 0);
      return s;
    });
    await expect(t2.conectar('', 0)).rejects.toThrow('no existe la sala');
  });

  it('traduce los códigos de cierre', () => {
    expect(motivoCierre(4429)).toContain('llena');
    expect(motivoCierre(1006)).toContain('1006');
  });
});
