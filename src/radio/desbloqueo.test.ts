import { createHash } from 'crypto';

import { claveRadioValida, sha256Hex } from './desbloqueo';

describe('desbloqueo de Radio', () => {
  it('SHA-256 igual que el de Node (ASCII, UTF-8 y varios bloques)', () => {
    for (const t of ['', 'abc', 'Víctor ñ 🏁', 'x'.repeat(200)]) {
      expect(sha256Hex(t)).toBe(createHash('sha256').update(t, 'utf8').digest('hex'));
    }
  });

  it('acepta la contraseña y rechaza lo demás', () => {
    expect(claveRadioValida('dzero*2026')).toBe(true);
    expect(claveRadioValida('  dzero*2026 ')).toBe(true);
    expect(claveRadioValida('dzero2026')).toBe(false);
    expect(claveRadioValida('DZERO*2026')).toBe(false);
    expect(claveRadioValida('')).toBe(false);
  });
});
