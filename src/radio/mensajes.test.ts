import {
  deserializar,
  deserializarSenalizacion,
  serializar,
  serializarSenalizacion,
  validarMensaje,
  validarSenalizacion,
} from './mensajes';
import type { MensajeRadio, MensajeSenalizacion } from './mensajes';

describe('mensajes de datos', () => {
  const casos: MensajeRadio[] = [
    { tipo: 'vuelta', n: 3, ms: 7846, ts: 1_700_000_000_000 },
    { tipo: 'deshacer', n: 3 },
    { tipo: 'estado', hablando: 'piloto' },
    { tipo: 'estado', hablando: null },
    { tipo: 'participantes', lista: [{ id: 'a', nombre: 'Ana', rol: 'piloto' }] },
    { tipo: 'inicio' },
    { tipo: 'fin' },
    { tipo: 'ajustes', locutarTiempos: false },
    { tipo: 'salaCerrada' },
  ];

  it('serializa y deserializa sin pérdida', () => {
    for (const m of casos) {
      expect(deserializar(serializar(m))).toEqual(m);
    }
  });

  it('ignora JSON roto', () => {
    expect(deserializar('{no es json')).toBeNull();
    expect(deserializar('')).toBeNull();
    expect(deserializar('null')).toBeNull();
  });

  it('rechaza mensajes con campos de tipo incorrecto', () => {
    expect(validarMensaje({ tipo: 'vuelta', n: '3', ms: 1, ts: 1 })).toBeNull();
    expect(validarMensaje({ tipo: 'vuelta', n: 3, ms: 1 })).toBeNull();
    expect(validarMensaje({ tipo: 'estado', hablando: 'entrenador' })).toBeNull();
    expect(
      validarMensaje({ tipo: 'participantes', lista: [{ id: 1, nombre: 2 }] }),
    ).toBeNull();
    expect(validarMensaje({ tipo: 'ajustes', locutarTiempos: 'no' })).toBeNull();
    expect(validarMensaje({ tipo: 'desconocido' })).toBeNull();
    expect(validarMensaje({})).toBeNull();
    expect(validarMensaje('vuelta')).toBeNull();
  });

  it('valida el campo hablando solo con los dos roles que hablan', () => {
    expect(validarMensaje({ tipo: 'estado', hablando: 'asistente' })).toEqual({
      tipo: 'estado',
      hablando: 'asistente',
    });
    expect(validarMensaje({ tipo: 'estado', hablando: 'seguidor' })).toBeNull();
  });
});

describe('mensajes de señalización', () => {
  const casos: MensajeSenalizacion[] = [
    { tipo: 'unirse', nombre: 'Ana', rol: 'piloto', codigo: 'K7M-4QX' },
    { tipo: 'bienvenido', tuId: 'p1', lista: [{ id: 'p1', nombre: 'Ana', rol: 'piloto' }] },
    { tipo: 'rechazado', motivo: 'codigo' },
    { tipo: 'rechazado', motivo: 'rol-ocupado' },
    { tipo: 'rechazado', motivo: 'sala-llena' },
    { tipo: 'oferta', de: 'asistente', sdp: 'v=0' },
    { tipo: 'respuesta', de: 'p1', sdp: 'v=0' },
    { tipo: 'candidato', de: 'p1', candidate: 'candidate:1' },
    { tipo: 'salir', id: 'p1' },
  ];

  it('serializa y deserializa sin pérdida', () => {
    for (const m of casos) {
      expect(deserializarSenalizacion(serializarSenalizacion(m))).toEqual(m);
    }
  });

  it('rechaza motivos y roles desconocidos', () => {
    expect(validarSenalizacion({ tipo: 'rechazado', motivo: 'otro' })).toBeNull();
    expect(
      validarSenalizacion({ tipo: 'unirse', nombre: 'A', rol: 'entrenador', codigo: 'X' }),
    ).toBeNull();
    expect(validarSenalizacion({ tipo: 'bienvenido', tuId: 'a' })).toBeNull();
  });
});
