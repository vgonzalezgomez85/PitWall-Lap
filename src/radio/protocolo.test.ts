import { crearClienteRadio, crearServidorRadio } from './protocolo';
import { crearTransporteMemoria } from './transporte';
import type { MensajeRadio, Participante } from './mensajes';

const HOST = 'host';
const PUERTO = 1;

describe('protocolo de sala (loopback en memoria)', () => {
  async function montar(codigo = 'K7M-4QX') {
    const transporte = crearTransporteMemoria();
    const servidor = crearServidorRadio();
    const lista: Participante[][] = [];
    await servidor.iniciar(transporte, codigo, p => lista.push(p));
    return { transporte, servidor, lista };
  }

  it('el asistente acepta a un piloto y rechaza un código malo', async () => {
    const { transporte, servidor, lista } = await montar();

    const piloto = crearClienteRadio();
    const r = await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'k7m-4qx' });
    expect(r.ok).toBe(true);
    expect(r.lista.map(p => p.nombre)).toEqual(['Ana']);

    const intruso = crearClienteRadio();
    const mal = await intruso.unirse(transporte, HOST, PUERTO, { nombre: 'X', rol: 'seguidor', codigo: 'AAAA-AA' });
    expect(mal).toMatchObject({ ok: false, motivo: 'codigo' });

    expect(servidor.sala().participantes.map(p => p.nombre)).toEqual(['Ana']);
    expect(lista[lista.length - 1]!.map(p => p.nombre)).toEqual(['Ana']);
  });

  it('rechaza un segundo piloto', async () => {
    const { transporte } = await montar();
    const a = crearClienteRadio();
    await a.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });
    const b = crearClienteRadio();
    const r = await b.unirse(transporte, HOST, PUERTO, { nombre: 'Bea', rol: 'piloto', codigo: 'K7M-4QX' });
    expect(r).toMatchObject({ ok: false, motivo: 'rol-ocupado' });
  });

  it('el asistente envía a todos y reenvía el estado de un participante', async () => {
    const { transporte, servidor } = await montar();
    const piloto = crearClienteRadio();
    const seguidor = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    const enPiloto: MensajeRadio[] = [];
    const enSeguidor: MensajeRadio[] = [];
    piloto.onMensaje(m => enPiloto.push(m));
    seguidor.onMensaje(m => enSeguidor.push(m));

    servidor.enviarATodos({ tipo: 'inicio' });
    expect(enPiloto).toEqual([{ tipo: 'inicio' }]);
    expect(enSeguidor).toEqual([{ tipo: 'inicio' }]);

    // El piloto avisa de que habla; el asistente lo reenvía a todos.
    piloto.enviar({ tipo: 'estado', hablando: 'piloto' });
    expect(enPiloto).toEqual([{ tipo: 'inicio' }, { tipo: 'estado', hablando: 'piloto' }]);
    expect(enSeguidor).toEqual([{ tipo: 'inicio' }, { tipo: 'estado', hablando: 'piloto' }]);
  });

  it('al irse un participante, la sala se actualiza', async () => {
    const { transporte, servidor, lista } = await montar();
    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });
    const seguidor = crearClienteRadio();
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    seguidor.salir();
    expect(servidor.sala().participantes.map(p => p.nombre)).toEqual(['Ana']);
    expect(lista[lista.length - 1]!.map(p => p.nombre)).toEqual(['Ana']);
  });

  it('difunde la lista de participantes al resto cuando entra alguien', async () => {
    const { transporte } = await montar();
    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });

    const enPiloto: MensajeRadio[] = [];
    piloto.onMensaje(m => enPiloto.push(m));

    const seguidor = crearClienteRadio();
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    expect(enPiloto[enPiloto.length - 1]).toEqual({
      tipo: 'participantes',
      lista: [
        { id: 'p1', nombre: 'Ana', rol: 'piloto' },
        { id: 'p2', nombre: 'Seg', rol: 'seguidor' },
      ],
    });
  });

  it('el asistente recibe los datos que manda un participante', async () => {
    const { transporte, servidor } = await montar();
    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });

    const enAsistente: MensajeRadio[] = [];
    servidor.onMensaje(m => enAsistente.push(m));

    piloto.enviar({ tipo: 'estado', hablando: 'piloto' });
    expect(enAsistente).toEqual([{ tipo: 'estado', hablando: 'piloto' }]);
  });
});
