import {
  codigoValido,
  codigosIguales,
  formatearCodigo,
  generarCodigo,
  normalizarCodigo,
} from './codigo';

describe('código de sala', () => {
  it('genera un código con la forma XXX-XXX del alfabeto', () => {
    const c = generarCodigo(() => 0); // siempre el primer carácter del alfabeto
    expect(c).toBe('222-222');
    expect(codigoValido(c)).toBe(true);
  });

  it('usa todo el alfabeto cuando el azar lo pide', () => {
    const c = generarCodigo(() => 0.9999); // último carácter
    expect(c).toBe('ZZZ-ZZZ');
  });

  it('normaliza minúsculas, espacios y guiones', () => {
    expect(normalizarCodigo('k7m-4qx')).toBe('K7M4QX');
    expect(normalizarCodigo('  k 7 m 4 q x  ')).toBe('K7M4QX');
  });

  it('compara ignorando el separador', () => {
    expect(codigosIguales('K7M-4QX', 'k7m4qx')).toBe(true);
    expect(codigosIguales('K7M-4QX', 'K7M-4QY')).toBe(false);
    expect(codigosIguales('', '')).toBe(false);
  });

  it('valida longitud y caracteres del alfabeto', () => {
    expect(codigoValido('K7M-4QX')).toBe(true);
    expect(codigoValido('K7M4QX')).toBe(true);
    expect(codigoValido('K7M4Q')).toBe(false); // corto
    expect(codigoValido('K7M4QXYZ')).toBe(false); // largo
    expect(codigoValido('K7M-4O0')).toBe(false); // 0/O no están en el alfabeto
    expect(codigoValido('K7M-4QI')).toBe(false); // I tampoco
  });

  it('formatea para mostrar en grande', () => {
    expect(formatearCodigo('K7M4QX')).toBe('K7M-4QX');
    expect(formatearCodigo('k7m-4qx')).toBe('K7M-4QX');
  });
});
