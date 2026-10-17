import { crearClienteRadio, crearServidorRadio } from './protocolo';
import { crearTransporteMemoria } from './transporte';
import { ID_ASISTENTE } from './sala';
import type { MensajeRadio, MensajeSenalizacion, Participante } from './mensajes';

const HOST = 'host';
const PUERTO = 1;
const HUB = { id: ID_ASISTENTE, nombre: 'Hub', rol: 'asistente' as const };

describe('protocolo de sala (loopback en memoria)', () => {
  async function montar(codigo = 'K7M-4QX') {
    const transporte = crearTransporteMemoria();
    const servidor = crearServidorRadio();
    const lista: Participante[][] = [];
    await servidor.iniciar(transporte, codigo, { nombre: 'Hub' }, p => lista.push(p));
    return { transporte, servidor, lista };
  }

  it('el hub entra como participante y acepta a un piloto; rechaza un código malo', async () => {
    const { transporte, servidor, lista } = await montar();

    expect(servidor.sala().participantes).toEqual([HUB]);

    const piloto = crearClienteRadio();
    const r = await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'k7m-4qx' });
    expect(r.ok).toBe(true);
    expect(r.lista.map(p => p.nombre)).toEqual(['Hub', 'Ana']);

    const intruso = crearClienteRadio();
    const mal = await intruso.unirse(transporte, HOST, PUERTO, { nombre: 'X', rol: 'seguidor', codigo: 'AAAA-AA' });
    expect(mal).toMatchObject({ ok: false, motivo: 'codigo' });

    expect(servidor.sala().participantes.map(p => p.nombre)).toEqual(['Hub', 'Ana']);
    expect(lista[lista.length - 1]!.map(p => p.nombre)).toEqual(['Hub', 'Ana']);
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

  it('al irse un participante, la sala se actualiza (el hub se queda)', async () => {
    const { transporte, servidor, lista } = await montar();
    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });
    const seguidor = crearClienteRadio();
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    seguidor.salir();
    expect(servidor.sala().participantes.map(p => p.nombre)).toEqual(['Hub', 'Ana']);
    expect(lista[lista.length - 1]!.map(p => p.nombre)).toEqual(['Hub', 'Ana']);
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
        HUB,
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

  it('enruta la señalización WebRTC por participante (unicast, sin difusión)', async () => {
    const { transporte, servidor } = await montar();
    const piloto = crearClienteRadio();
    const seguidor = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    // El asistente recibe la señalización con el id de la conexión emisora.
    const enAsistente: { de: string; sig: MensajeSenalizacion }[] = [];
    servidor.onSenalizacion((de, sig) => enAsistente.push({ de, sig }));

    piloto.enviarSenalizacion({ tipo: 'oferta', de: 'p1', sdp: 'v=0' });
    expect(enAsistente).toEqual([{ de: 'p1', sig: { tipo: 'oferta', de: 'p1', sdp: 'v=0' } }]);

    // El asistente responde solo al piloto (unicast), no al seguidor.
    const enPiloto: MensajeSenalizacion[] = [];
    const enSeguidor: MensajeSenalizacion[] = [];
    piloto.onSenalizacion(sig => enPiloto.push(sig));
    seguidor.onSenalizacion(sig => enSeguidor.push(sig));

    servidor.enviarSenalizacion('p1', { tipo: 'respuesta', de: 'asistente', sdp: 'v=0' });
    expect(enPiloto).toEqual([{ tipo: 'respuesta', de: 'asistente', sdp: 'v=0' }]);
    expect(enSeguidor).toEqual([]);
  });
});

describe('cambio de rol y cronómetro remoto', () => {
  async function montar() {
    const transporte = crearTransporteMemoria();
    const servidor = crearServidorRadio();
    const lista: Participante[][] = [];
    await servidor.iniciar(transporte, 'K7M-4QX', { nombre: 'Hub' }, p => lista.push(p));
    return { transporte, servidor, lista };
  }

  it('el hub cambia su propio rol y lo difunde', async () => {
    const { transporte, servidor, lista } = await montar();
    const seguidor = crearClienteRadio();
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    const enSeguidor: MensajeRadio[] = [];
    seguidor.onMensaje(m => enSeguidor.push(m));

    const ok = servidor.cambiarRol(ID_ASISTENTE, 'piloto');
    expect(ok).toBe(true);
    expect(servidor.sala().participantes).toEqual([
      { id: ID_ASISTENTE, nombre: 'Hub', rol: 'piloto' },
      { id: 'p1', nombre: 'Seg', rol: 'seguidor' },
    ]);
    expect(lista[lista.length - 1]!.find(p => p.id === ID_ASISTENTE)!.rol).toBe('piloto');
    expect(enSeguidor[enSeguidor.length - 1]).toEqual({
      tipo: 'participantes',
      lista: [
        { id: ID_ASISTENTE, nombre: 'Hub', rol: 'piloto' },
        { id: 'p1', nombre: 'Seg', rol: 'seguidor' },
      ],
    });
  });

  it('rechaza un cambio de rol a un papel ya ocupado', async () => {
    const { transporte, servidor } = await montar();
    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });

    // El hub (asistente) intenta pasarse a piloto, pero ya hay un piloto.
    expect(servidor.cambiarRol(ID_ASISTENTE, 'piloto')).toBe(false);
    expect(servidor.sala().participantes.find(p => p.id === ID_ASISTENTE)!.rol).toBe('asistente');
  });

  it('un participante remoto cambia de rol con el mensaje cambiarRol', async () => {
    const { transporte, servidor, lista } = await montar();
    // El hub deja libre el papel de asistente.
    servidor.cambiarRol(ID_ASISTENTE, 'seguidor');

    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });

    // Ana se pasa a asistente.
    piloto.enviar({ tipo: 'cambiarRol', rol: 'asistente' });

    expect(servidor.sala().participantes.find(p => p.id === 'p1')!.rol).toBe('asistente');
    expect(lista[lista.length - 1]!.find(p => p.id === 'p1')!.rol).toBe('asistente');
  });

  it('solo el asistente puede mandar comandos de cronómetro', async () => {
    const { transporte, servidor } = await montar();
    const piloto = crearClienteRadio();
    await piloto.unirse(transporte, HOST, PUERTO, { nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' });
    const seguidor = crearClienteRadio();
    await seguidor.unirse(transporte, HOST, PUERTO, { nombre: 'Seg', rol: 'seguidor', codigo: 'K7M-4QX' });

    const enHub: MensajeRadio[] = [];
    servidor.onMensaje(m => enHub.push(m));
    const enPiloto: MensajeRadio[] = [];
    piloto.onMensaje(m => enPiloto.push(m));

    // El hub (asistente) deja el papel libre; Ana (piloto) lo toma.
    servidor.cambiarRol(ID_ASISTENTE, 'seguidor');
    piloto.enviar({ tipo: 'cambiarRol', rol: 'asistente' });

    // Un seguidor no puede cronometrar: su pulso no llega al hub.
    seguidor.enviar({ tipo: 'pulso' });
    expect(enHub).toEqual([]);

    // El asistente remoto sí: el pulso llega al hub y no se reenvía a otros.
    piloto.enviar({ tipo: 'pulso' });
    expect(enHub).toEqual([{ tipo: 'pulso' }]);
    // Ana recibe los `participantes` de su propio cambio de rol, pero nunca
    // el comando de cronómetro crudo.
    expect(enPiloto.some(m => m.tipo === 'pulso')).toBe(false);

    piloto.enviar({ tipo: 'deshacerPulso' });
    piloto.enviar({ tipo: 'terminarPulso' });
    expect(enHub).toEqual([
      { tipo: 'pulso' },
      { tipo: 'deshacerPulso' },
      { tipo: 'terminarPulso' },
    ]);
    // Ningún comando de cronómetro se difunde a los demás participantes.
    expect(
      enPiloto.some(m => m.tipo === 'pulso' || m.tipo === 'deshacerPulso' || m.tipo === 'terminarPulso'),
    ).toBe(false);
  });
});
