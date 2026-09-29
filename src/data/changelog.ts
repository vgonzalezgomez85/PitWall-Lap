// Historial de versiones. Parsea el CHANGELOG.md de la raíz (embebido en
// build por scripts/sync-changelog.js → src/generated/changelog.ts) y lo
// estructura para la pantalla "Novedades".
//
// Mismo formato y convención que PitWall Manager y PitWall Control:
//   ## [X.Y.Z] — fecha   → versión
//   ### Sección          → sección (Añadido / Mejorado / Corregido)
//   - item               → entrada (con **negrita** y `código`)
// Todo lo anterior a la primera versión (título y criterio de numeración del
// fichero) se ignora.

import { CHANGELOG_MD } from '../generated/changelog';

export { CHANGELOG_MD };

/** Fragmento de texto con formato inline (**negrita** o `código`). */
export interface ChangeSpan {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export interface ChangeSection {
  title: string;
  items: ChangeSpan[][];
}

export interface ChangeVersion {
  version: string;
  /** Tal cual viene en el fichero (no se parsea como fecha). */
  date: string;
  /** Líneas sueltas antes de la primera sección (resumen de la versión). */
  notes: ChangeSpan[][];
  sections: ChangeSection[];
}

const RE_VERSION = /^##\s+\[([^\]]+)\]\s*(?:—|-)?\s*(.*)$/;
const RE_SECTION = /^###\s+(.+)$/;
// Toleramos indentación: las sub-viñetas de las entradas largas no se pierden.
const RE_ITEM = /^\s*-\s+(.+)$/;

/**
 * Convierte **negrita** y `código` en spans para pintar en <Text> anidados.
 * Un `**` sin cerrar queda como texto literal (no se come el resto).
 */
export function segmentInline(text: string): ChangeSpan[] {
  const spans: ChangeSpan[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > pos) spans.push({ text: text.slice(pos, m.index) });
    if (m[1] != null) spans.push({ text: m[1], bold: true });
    else if (m[2] != null) spans.push({ text: m[2], code: true });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) spans.push({ text: text.slice(pos) });
  return spans;
}

export function parseChangelog(md: string): ChangeVersion[] {
  const versions: ChangeVersion[] = [];
  let current: ChangeVersion | null = null;
  // Lista de ítems en curso: la sección actual, o las notas si aún no hay.
  let items: ChangeSpan[][] | null = null;
  // ¿La última línea útil fue un ítem/continuación? Una línea en blanco corta
  // la continuación, para no pegar párrafos distintos.
  let continuable = false;

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();

    const mv = RE_VERSION.exec(line);
    if (mv) {
      current = { version: mv[1] ?? '', date: (mv[2] ?? '').trim(), notes: [], sections: [] };
      versions.push(current);
      items = null;
      continuable = false;
      continue;
    }
    if (current == null) continue; // cabecera del fichero

    const ms = RE_SECTION.exec(line);
    if (ms) {
      const section: ChangeSection = { title: (ms[1] ?? '').trim(), items: [] };
      current.sections.push(section);
      items = section.items;
      continuable = false;
      continue;
    }

    const mi = RE_ITEM.exec(line);
    if (mi) {
      const target = items ?? current.notes;
      target.push(segmentInline(mi[1] ?? ''));
      continuable = true;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#') && trimmed !== '---') {
      const target = items ?? current.notes;
      const last = target[target.length - 1];
      if (continuable && last != null) {
        // Línea de continuación de la entrada anterior (no se pierde texto).
        last.push({ text: ' ' }, ...segmentInline(trimmed));
      } else {
        target.push(segmentInline(trimmed));
      }
      continuable = true;
      continue;
    }

    continuable = false; // línea en blanco, separador o encabezado suelto
  }
  return versions;
}

/** Versiones parseadas del changelog embebido (más reciente primero). */
export const CHANGELOG_VERSIONS: ChangeVersion[] = parseChangelog(CHANGELOG_MD);

export function latestVersion(): string | null {
  return CHANGELOG_VERSIONS[0]?.version ?? null;
}
