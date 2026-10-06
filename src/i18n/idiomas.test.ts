import { IDIOMAS, idiomaDelSistema, resolverIdioma, localeFechas, vozDe } from './idiomas';
import { ordinalHablado, textosDe } from '.';
import { lapDeltaLabel } from '../ui/lapTone';

jest.mock('react-native-tts', () => ({}));
jest.mock('../../modules/backgroundtts', () => ({}));
import { speakTime } from '../voice/speak';

describe('idiomaDelSistema', () => {
  it('usa el primer idioma soportado, ignorando región', () => {
    expect(idiomaDelSistema(['ca-ES'])).toBe('ca');
    expect(idiomaDelSistema(['pt_BR'])).toBe('pt');
    expect(idiomaDelSistema(['EU'])).toBe('eu');
    expect(idiomaDelSistema(['de-DE', 'nl-NL', 'en'])).toBe('nl');
  });

  it('sin idioma soportado o sin datos, inglés', () => {
    expect(idiomaDelSistema(['de-DE', 'ja'])).toBe('en');
    expect(idiomaDelSistema([])).toBe('en');
    expect(idiomaDelSistema([null, undefined, ''])).toBe('en');
  });
});

describe('resolverIdioma', () => {
  it('automático sigue al sistema; una preferencia manda sobre él', () => {
    expect(resolverIdioma('auto', ['fr-FR'])).toBe('fr');
    expect(resolverIdioma('it', ['fr-FR'])).toBe('it');
    expect(resolverIdioma('auto', ['zh'])).toBe('en');
  });
});

describe('diccionarios', () => {
  it('cada idioma tiene su locale y su voz', () => {
    for (const { codigo } of IDIOMAS) {
      expect(localeFechas(codigo)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(vozDe(codigo)).toBe(localeFechas(codigo));
    }
  });

  it('hay diez ordinales hablados en todos los idiomas, y puesto N después', () => {
    for (const { codigo } of IDIOMAS) {
      const voz = textosDe(codigo).voz;
      expect(voz.ordinales).toHaveLength(10);
      expect(new Set(voz.ordinales).size).toBe(10);
      expect(ordinalHablado(11, voz)).toContain('11');
    }
    expect(ordinalHablado(2, textosDe('es').voz)).toBe('segundo');
    expect(ordinalHablado(1, textosDe('en').voz)).toBe('first');
  });

  it('ningún texto queda vacío (salvo la nota del changelog en castellano)', () => {
    const vacios: string[] = [];
    const recorre = (o: unknown, ruta: string) => {
      if (typeof o === 'string') { if (o === '' && !ruta.endsWith('novedades.notaIdioma')) vacios.push(ruta); }
      else if (Array.isArray(o)) o.forEach((x, i) => recorre(x, `${ruta}[${i}]`));
      else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => recorre(v, ruta ? `${ruta}.${k}` : k));
    };
    for (const { codigo } of IDIOMAS) recorre(textosDe(codigo), codigo);
    expect(vacios).toEqual([]);
  });
});

describe('voz por idioma', () => {
  it('speakTime dice las centésimas exactas con la palabra del idioma', () => {
    expect(speakTime(10_000, textosDe('en').voz)).toBe('10 zero zero');
    expect(speakTime(10_000, textosDe('nl').voz)).toBe('10 nul nul');
    expect(speakTime(12_450, textosDe('fr').voz)).toBe('12 45');
    expect(speakTime(null, textosDe('it').voz)).toBe('nessun tempo');
  });

  it('las frases de gap pluralizan bien', () => {
    expect(textosDe('es').voz.delanteA(1, 'ANA')).toBe('A una vuelta de ANA');
    expect(textosDe('es').voz.delanteA(2, 'ANA')).toBe('A 2 vueltas de ANA');
    expect(textosDe('en').voz.detrasA(1, 'BOB')).toBe('Behind, BOB one lap back');
  });
});

describe('textos de la UI', () => {
  it('lapDeltaLabel respeta el idioma', () => {
    expect(lapDeltaLabel(10_000, 10_000, textosDe('en').ui)).toBe('Best lap');
    expect(lapDeltaLabel(10_100, 10_000, textosDe('en').ui)).toBe('+0.10 vs best');
    expect(lapDeltaLabel(10_100, 10_000)).toBe('+0.10 vs mejor');
  });
});
