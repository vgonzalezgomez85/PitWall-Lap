// Tests del parser del changelog + guardas de sincronía y versión.
//
// El último bloque protege las dos invariantes del versionado: el fichero
// generado (src/generated/changelog.ts) está sincronizado con CHANGELOG.md,
// y la versión de app.json / package.json coincide con la primera entrada
// del changelog. Si falla, ejecuta `npm run changelog:sync` y commitea el
// generado.

import * as fs from 'fs';
import * as path from 'path';

import {
  CHANGELOG_MD,
  CHANGELOG_VERSIONS,
  latestVersion,
  parseChangelog,
  segmentInline,
  type ChangeSpan,
} from './changelog';

const ROOT = path.join(__dirname, '..', '..');

/** Texto plano de unos spans (para asserts legibles). */
const plain = (spans: ChangeSpan[]): string => spans.map(s => s.text).join('');

function normalize(md: string): string {
  return md.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

describe('parseChangelog', () => {
  it('ignora la cabecera previa a la primera versión', () => {
    const md = [
      '# Historial de versiones',
      'Criterio: bla bla',
      '- viñeta suelta de la cabecera',
      '',
      '## [1.2.0] — 2026-01-01',
      '### Añadido',
      '- item',
    ].join('\n');
    const vs = parseChangelog(md);
    expect(vs).toHaveLength(1);
    expect(vs[0]?.version).toBe('1.2.0');
    expect(vs[0]?.notes).toHaveLength(0);
    expect(vs[0]?.sections[0]?.items).toHaveLength(1);
  });

  it('parsea versión, fecha, secciones e ítems', () => {
    const md = [
      '## [1.36.2] — 2026-09-13',
      '',
      '### Corregido',
      '- **Vuelta fantasma** asignada al carril equivocado.',
      '',
      '### Mejorado',
      '- Algo más.',
    ].join('\n');
    const vs = parseChangelog(md);
    expect(vs).toHaveLength(1);
    expect(vs[0]?.version).toBe('1.36.2');
    expect(vs[0]?.date).toBe('2026-09-13');
    expect(vs[0]?.sections.map(s => s.title)).toEqual(['Corregido', 'Mejorado']);
  });

  it('acepta guion simple y fecha vacía', () => {
    const vs = parseChangelog('## [1.0.0]\n- nota suelta\n');
    expect(vs[0]?.version).toBe('1.0.0');
    expect(vs[0]?.date).toBe('');
    expect(vs[0]?.notes).toHaveLength(1);
    expect(plain(vs[0]?.notes[0] ?? [])).toBe('nota suelta');
  });

  it('no pierde viñetas indentadas', () => {
    const md = '## [1.0.0]\n### Añadido\n  - sub-viñeta\n';
    const vs = parseChangelog(md);
    expect(vs[0]?.sections[0]?.items).toHaveLength(1);
    expect(plain(vs[0]?.sections[0]?.items[0] ?? [])).toBe('sub-viñeta');
  });

  it('concatena líneas de continuación al último ítem', () => {
    const md = '## [1.0.0]\n### Añadido\n- Primera parte\n  y su continuación.\n';
    const vs = parseChangelog(md);
    const items = vs[0]?.sections[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(plain(items[0] ?? [])).toBe('Primera parte y su continuación.');
  });

  it('una línea en blanco no une párrafos distintos', () => {
    const md = '## [1.0.0]\n- item uno\n\npárrafo aparte\n';
    const vs = parseChangelog(md);
    const notes = vs[0]?.notes ?? [];
    expect(notes).toHaveLength(2);
    expect(plain(notes[0] ?? [])).toBe('item uno');
    expect(plain(notes[1] ?? [])).toBe('párrafo aparte');
  });

  it('devuelve [] con md vacío', () => {
    expect(parseChangelog('')).toEqual([]);
  });
});

describe('segmentInline', () => {
  it('negrita en medio', () => {
    expect(segmentInline('a **b** c')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
  });

  it('negrita al inicio y al final', () => {
    expect(segmentInline('**a** y **b**')).toEqual([
      { text: 'a', bold: true },
      { text: ' y ' },
      { text: 'b', bold: true },
    ]);
  });

  it('código', () => {
    expect(segmentInline('usa `npm test` ya')).toEqual([
      { text: 'usa ' },
      { text: 'npm test', code: true },
      { text: ' ya' },
    ]);
  });

  it('** sin cerrar queda literal', () => {
    expect(segmentInline('esto **no cierra')).toEqual([{ text: 'esto **no cierra' }]);
  });

  it('sin marcado devuelve un solo span', () => {
    expect(segmentInline('texto plano')).toEqual([{ text: 'texto plano' }]);
  });
});

describe('CHANGELOG.md ↔ src/generated/changelog.ts', () => {
  it('el generado está sincronizado (ejecuta `npm run changelog:sync` y commitea src/generated/changelog.ts)', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(CHANGELOG_MD).toBe(normalize(raw));
  });

  it('la versión del changelog casa con app.json y package.json', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(CHANGELOG_VERSIONS.length).toBeGreaterThan(0);
    expect(latestVersion()).toBe(appJson.expo.version);
    expect(pkg.version).toBe(appJson.expo.version);
  });
});
