import {
  ajustesAudioPorDefecto,
  decidirLocucion,
  decidirVoz,
} from './audio';

describe('coordinación locución ↔ voz', () => {
  const def = ajustesAudioPorDefecto();

  describe('decidirLocucion', () => {
    it('callar si la locución automática está desactivada', () => {
      const a = { ...def, locutarTiempos: false };
      expect(decidirLocucion(null, 0, a)).toBe('callar');
      expect(decidirLocucion('asistente', 0, a)).toBe('callar');
    });

    it('espera si habla el asistente y no se ha agotado la espera', () => {
      expect(decidirLocucion('asistente', 0, def)).toBe('esperar');
      expect(decidirLocucion('piloto', 1000, def)).toBe('esperar');
    });

    it('locuta igual si la espera está desactivada', () => {
      const a = { ...def, esperarSiHabla: false };
      expect(decidirLocucion('asistente', 0, a)).toBe('locutar');
    });

    it('locuta cuando se agota la espera máxima', () => {
      expect(decidirLocucion('asistente', 1500, def)).toBe('locutar');
      expect(decidirLocucion('asistente', 2000, def)).toBe('locutar');
    });

    it('locuta enseguida si nadie habla', () => {
      expect(decidirLocucion(null, 0, def)).toBe('locutar');
    });
  });

  describe('decidirVoz', () => {
    it('voz normal si nadie habla o no hay locución', () => {
      expect(decidirVoz(null, true, def)).toBe('normal');
      expect(decidirVoz('asistente', false, def)).toBe('normal');
    });

    it('atenúa la voz si entra durante una locución (por defecto)', () => {
      expect(decidirVoz('asistente', true, def)).toBe('atenuar');
    });

    it('corta la locución si así está configurado', () => {
      const a = { ...def, vozDuranteLocucion: 'cortar' as const };
      expect(decidirVoz('asistente', true, a)).toBe('cortar');
    });
  });
});
