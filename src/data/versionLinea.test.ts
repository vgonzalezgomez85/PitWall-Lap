// eslint-disable-next-line @typescript-eslint/no-var-requires
const linea = require('../../scripts/version-linea') as {
  versionInternet(v: string): string;
  versionPublica(v: string): string;
  versionDelBuild(v: string, url?: string): string;
};

describe('líneas de versiones (pública 2.x / con Radio por internet 1.x)', () => {
  it('la 1.x sigue tras la 1.24.2 y respeta el orden', () => {
    expect(linea.versionInternet('2.0.0')).toBe('1.25.0');
    expect(linea.versionInternet('2.0.1')).toBe('1.25.1');
    expect(linea.versionInternet('2.3.4')).toBe('1.28.4');
  });

  it('de un build 1.x se vuelve a su versión pública (para el CHANGELOG)', () => {
    expect(linea.versionPublica('1.28.4')).toBe('2.3.4');
    expect(linea.versionPublica('2.3.4')).toBe('2.3.4');
    // Las 1.x de antes de la separación son las suyas.
    expect(linea.versionPublica('1.24.2')).toBe('1.24.2');
  });

  it('solo cambia la versión si el build trae el relé', () => {
    expect(linea.versionDelBuild('2.0.0', undefined)).toBe('2.0.0');
    expect(linea.versionDelBuild('2.0.0', '  ')).toBe('2.0.0');
    expect(linea.versionDelBuild('2.0.0', 'wss://rele')).toBe('1.25.0');
  });

  it('rechaza una línea pública que no sea 2.x', () => {
    expect(() => linea.versionInternet('1.24.2')).toThrow();
  });
});
