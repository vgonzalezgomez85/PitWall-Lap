import { cambiarRolSala, crearSala, decidirUnion, eliminarParticipante, ID_ASISTENTE, MAX_ENTRENOS, MAX_SEGUIDORES, registrarParticipante, participanteObsoleto } from './sala';

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

describe('participanteObsoleto', () => {
  const sala = [
    { id: ID_ASISTENTE, nombre: 'Ana', rol: 'asistente' as const },
    { id: 'p1', nombre: 'Luis', rol: 'piloto' as const },
    { id: 'p2', nombre: 'Eva', rol: 'seguidor' as const },
  ].reduce((s, p) => registrarParticipante(s, p), crearSala('K7M4QX'));

  it('reconoce al mismo piloto que vuelve', () => {
    expect(participanteObsoleto(sala, 'Luis', 'piloto')).toBe('p1');
  });

  it('no confunde a otro con el mismo papel ni toca al hub ni a seguidores', () => {
    expect(participanteObsoleto(sala, 'Marta', 'piloto')).toBeNull();
    expect(participanteObsoleto(sala, 'Ana', 'asistente')).toBeNull();
    expect(participanteObsoleto(sala, 'Eva', 'seguidor')).toBeNull();
  });
});

describe('sala de entrenos (sin perfiles)', () => {
  const entrenos = crearSala('K7M-4QX', 'entrenos');

  it('todos entran como libre, pidan el papel que pidan', () => {
    let s = registrarParticipante(entrenos, { id: ID_ASISTENTE, nombre: 'Hub', rol: 'libre' });
    for (const [id, rol] of [['a', 'piloto'], ['b', 'piloto'], ['c', 'asistente'], ['d', 'seguidor']] as const) {
      const r = decidirUnion(s, { id, nombre: id, rol, codigo: 'K7M-4QX' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.participante.rol).toBe('libre');
        s = registrarParticipante(s, r.participante);
      }
    }
  });

  it('limita el total de participantes (contando al hub)', () => {
    let s = entrenos;
    for (let i = 0; i < MAX_ENTRENOS; i++) {
      const r = decidirUnion(s, { id: `p${i}`, nombre: `P${i}`, rol: 'libre', codigo: 'K7M-4QX' });
      expect(r.ok).toBe(true);
      if (r.ok) s = registrarParticipante(s, r.participante);
    }
    const r = decidirUnion(s, { id: 'x', nombre: 'X', rol: 'libre', codigo: 'K7M-4QX' });
    expect(r).toEqual({ ok: false, motivo: 'sala-llena' });
  });

  it('no deja cambiar de papel', () => {
    const s = registrarParticipante(entrenos, { id: 'a', nombre: 'Ana', rol: 'libre' });
    expect(cambiarRolSala(s, 'a', 'piloto').ok).toBe(false);
  });

  it('reconoce a quien vuelve tras perder la conexión', () => {
    const s = registrarParticipante(entrenos, { id: 'p3', nombre: 'Ana', rol: 'libre' });
    expect(participanteObsoleto(s, 'Ana', 'libre')).toBe('p3');
    expect(participanteObsoleto(s, 'Bea', 'libre')).toBeNull();
  });

  it('en carrera, libre no existe: se entra como seguidor', () => {
    const r = decidirUnion(sala, { id: 'a', nombre: 'Ana', rol: 'libre', codigo: 'K7M-4QX' });
    expect(r.ok && r.participante.rol).toBe('seguidor');
    const conAna = registrarParticipante(sala, { id: 'a', nombre: 'Ana', rol: 'seguidor' });
    expect(cambiarRolSala(conAna, 'a', 'libre').ok).toBe(false);
  });
});
