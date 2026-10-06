// Punto de entrada de los textos traducidos. Puro (sin React): lo usan tanto
// las pantallas (vía `useIdioma`) como la lógica de voz y los tests.

import type { Idioma } from './idiomas';
import es, { type Textos } from './textos/es';
import ca from './textos/ca';
import eu from './textos/eu';
import en from './textos/en';
import it from './textos/it';
import fr from './textos/fr';
import pt from './textos/pt';
import nl from './textos/nl';

export type { Textos };
export type TextosVoz = Textos['voz'];

const TEXTOS: Record<Idioma, Textos> = { es, ca, eu, en, it, fr, pt, nl };

export function textosDe(idioma: Idioma): Textos {
  return TEXTOS[idioma];
}

/** Posición hablada: "segundo", "fourth"… y a partir del 11, "puesto 11". */
export function ordinalHablado(n: number, voz: TextosVoz): string {
  return voz.ordinales[n - 1] ?? voz.puesto(n);
}
