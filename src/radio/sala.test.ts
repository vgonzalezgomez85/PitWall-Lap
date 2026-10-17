import {
  cambiarRolSala,
  crearSala,
  decidirUnion,
  eliminarParticipante,
  ID_ASISTENTE,
  MAX_SEGUIDORES,
  registrarParticipante,
} from './sala';

const sala = crearSala('K7M-4QX');

describe('reglas de sala de Radio', () => {
  it('rechaza un código incorrecto', () => {
    const r = decidirUnion(sala, { id: 'a', nombre: 'Ana', rol: 'piloto', codigo: 'AAAA-AA' });
    expect(r).toEqual({ ok: false, motivo: 'codigo' });
  });

  it('acepta un piloto con el código correcto (ignorando el guion)', () => {
    const r = decidirUnion(sala, { id: 'a', nombre: 'Ana', rol: 'piloto', codigo: 'k7m4qx' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.participante).toEqual({ id: 'a', nombre: 'Ana', rol: 'piloto' });
  });

  it('no deja entrar a un segundo piloto', () => {
    const conPiloto = registrarParticipante(sala, { id: 'p', nombre: 'Ana', rol: 'piloto' });
    const r = decidirUnion(conPiloto, { id: 'q', nombre: 'Bea', rol: 'piloto', codigo: 'K7M-4QX' });
    expect(r).toEqual({ ok: false, motivo: 'rol-ocupado' });
  });

  it('el papel de asistente queda libre si el hub no lo ocupa', () => {
    // El hub se registra como participante con rol 'asistente'; si cambia a
    // otro papel, un remoto puede tomar el de asistente.
    const hub = registrarParticipante(sala, { id: ID_ASISTENTE, nombre: 'Hub', rol: 'asistente' });
    const ocupado = decidirUnion(hub, { id: 'b', nombre: 'Bea', rol: 'asistente', codigo: 'K7M-4QX' });
    expect(ocupado).toEqual({ ok: false, motivo: 'rol-ocupado' });

    const hubComoPiloto = cambiarRolSala(hub, ID_ASISTENTE, 'piloto');
    expect(hubComoPiloto.ok).toBe(true);
    if (hubComoPiloto.ok) {
      const libre = decidirUnion(hubComoPiloto.sala, { id: 'b', nombre: 'Bea', rol: 'asistente', codigo: 'K7M-4QX' });
      expect(libre.ok).toBe(true);
    }
  });

  it('limita el número de seguidores', () => {
    let s = sala;
    for (let i = 0; i < MAX_SEGUIDORES; i++) {
      s = registrarParticipante(s, { id: `s${i}`, nombre: `Seg ${i}`, rol: 'seguidor' });
    }
    const r = decidirUnion(s, { id: 'x', nombre: 'X', rol: 'seguidor', codigo: 'K7M-4QX' });
    expect(r).toEqual({ ok: false, motivo: 'sala-llena' });
  });

  it('elimina un participante por id', () => {
    const s = registrarParticipante(sala, { id: 'p', nombre: 'Ana', rol: 'piloto' });
    expect(eliminarParticipante(s, 'p').participantes).toEqual([]);
  });
});

describe('cambiarRolSala', () => {
  const conHub = registrarParticipante(sala, { id: ID_ASISTENTE, nombre: 'Hub', rol: 'asistente' });

  it('cambia el rol de un participante', () => {
    const r = cambiarRolSala(conHub, ID_ASISTENTE, 'piloto');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sala.participantes).toEqual([
        { id: ID_ASISTENTE, nombre: 'Hub', rol: 'piloto' },
      ]);
    }
  });

  it('no cambia si el rol destino ya está ocupado por otro', () => {
    const conPiloto = registrarParticipante(conHub, { id: 'p1', nombre: 'Ana', rol: 'piloto' });
    const r = cambiarRolSala(conPiloto, ID_ASISTENTE, 'piloto');
    expect(r).toEqual({ ok: false, motivo: 'rol-ocupado' });
  });

  it('mantiene la sala si se pide el mismo rol que ya tiene', () => {
    const r = cambiarRolSala(conHub, ID_ASISTENTE, 'asistente');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sala).toBe(conHub);
  });

  it('rechaza un id desconocido', () => {
    const r = cambiarRolSala(conHub, 'nadie', 'piloto');
    expect(r).toEqual({ ok: false, motivo: 'codigo' });
  });

  it('permite pasarse a seguidor aunque el rol piloto esté ocupado', () => {
    const conPiloto = registrarParticipante(conHub, { id: 'p1', nombre: 'Ana', rol: 'piloto' });
    const r = cambiarRolSala(conPiloto, ID_ASISTENTE, 'seguidor');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sala.participantes.find(p => p.id === ID_ASISTENTE)!.rol).toBe('seguidor');
    }
  });
});
