// Vuelta objetivo tecleada por el asistente: «7,85», «7.85» o «7» → ms.
// Puro, para poder testearlo.

/** Convierte el texto a milisegundos, o `null` si no es un tiempo razonable
 *  de vuelta de slot (entre 1 y 600 s). */
export function parsearObjetivo(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(limpio)) return null;
  const ms = Math.round(Number(limpio) * 1000);
  return ms >= 1000 && ms < 600_000 ? ms : null;
}
