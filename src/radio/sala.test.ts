import {
  crearSala,
  decidirUnion,
  eliminarParticipante,
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

  it('reserva el papel de asistente (solo el móvil que crea la sala)', () => {
    // Aunque la sala esté vacía, nadie puede entrar como asistente.
    const r = decidirUnion(sala, { id: 'a', nombre: 'A', rol: 'asistente', codigo: 'K7M-4QX' });
    expect(r).toEqual({ ok: false, motivo: 'rol-ocupado' });
  });

  it('no deja entrar a un segundo asistente', () => {
    const conAsist = registrarParticipante(sala, { id: 'a', nombre: 'A', rol: 'asistente' });
    const r = decidirUnion(conAsist, { id: 'b', nombre: 'B', rol: 'asistente', codigo: 'K7M-4QX' });
    expect(r).toEqual({ ok: false, motivo: 'rol-ocupado' });
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
