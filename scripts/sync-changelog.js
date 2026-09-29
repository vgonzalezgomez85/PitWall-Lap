#!/usr/bin/env node
// Embebe CHANGELOG.md (raíz) en src/generated/changelog.ts.
//
// React Native no puede leer un .md del bundle sin tocar Metro (y bajo jest
// el transformer de assets devolvería `module.exports = 1`), así que el
// contenido se genera como string TS y se commitea. Un test verifica que el
// generado sigue sincronizado con el .md: si editas el changelog, ejecuta
// `npm run changelog:sync` y commitea ambos.
//
// Uso: npm run changelog:sync

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'CHANGELOG.md');
const OUT = path.join(ROOT, 'src', 'generated', 'changelog.ts');

const HEADER = `// AUTO-GENERADO por scripts/sync-changelog.js — NO editar a mano.
// Fuente: CHANGELOG.md (raíz del repo). Regenerar con: npm run changelog:sync

`;

/** BOM fuera y saltos de línea normalizados (el test compara igual). */
function normalize(md) {
  return md.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const md = normalize(fs.readFileSync(SRC, 'utf8'));
const out = HEADER + `export const CHANGELOG_MD: string = ${JSON.stringify(md)};\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (prev === out) {
  console.log('src/generated/changelog.ts — sin cambios');
} else {
  fs.writeFileSync(OUT, out);
  console.log('src/generated/changelog.ts — actualizado');
}

// Aviso (no error) si la versión del binario no casa con la primera entrada.
try {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const first = /^##\s+\[([^\]]+)\]/m.exec(md);
  const appVersion = appJson && appJson.expo && appJson.expo.version;
  if (first && appVersion && first[1] !== appVersion) {
    console.warn(
      `aviso: app.json version (${appVersion}) ≠ primera entrada del CHANGELOG (${first[1]}). ` +
      'Recuerda subir la versión en app.json y package.json.',
    );
  }
} catch { /* best-effort */ }
