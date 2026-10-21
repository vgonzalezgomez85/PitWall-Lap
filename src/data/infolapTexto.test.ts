import { Buffer } from 'buffer';

import { decodificarTextoTicTac } from './infolapDecode';

describe('texto del TicTac', () => {
  it('UTF-8, como lo manda el Gestor (captura real)', () => {
    const bytes = Buffer.from('ESQUADRÓ DIABÒLIC C1', 'utf8');
    expect(decodificarTextoTicTac(bytes)).toBe('ESQUADRÓ DIABÒLIC C1');
  });

  it('Latin-1 si no es UTF-8 válido', () => {
    const bytes = Buffer.from('PALMARÉS', 'latin1');
    expect(decodificarTextoTicTac(bytes)).toBe('PALMARÉS');
  });

  it('UTF-8 cortado a mitad de la última letra (nombre de 20 bytes)', () => {
    const bytes = Buffer.from('SLOTMANIA PALMARÉS', 'utf8').subarray(0, 17);   // parte la «É»
    expect(decodificarTextoTicTac(bytes)).toBe('SLOTMANIA PALMAR');
  });

  it('ASCII tal cual', () => {
    expect(decodificarTextoTicTac(Buffer.from('OK Piloto 1;#001', 'ascii'))).toBe('OK Piloto 1;#001');
  });
});
