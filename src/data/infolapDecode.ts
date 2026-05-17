// Decoder del campo "tiempo" del paquete de estado 52-byte de InfoLap
// (Tic Tac Slot). Ingeniería inversa: ver memoria
// project_infolap_protocol.md.
//
// Cada paquete (52 bytes) tiene un sub-campo de 7 chars hex en posiciones
// 30..36 que codifica el tiempo de la última vuelta. Algoritmo:
//
//   digit[i] = encoded[i] XOR template[i]   (nibble por nibble)
//
//   template = "7654321"
//   pos 0 → décimas       (×0.1 s)
//   pos 1 → decenas       (×10 s)
//   pos 2 → milésimas     (×0.001 s)
//   pos 3 → centésimas    (×0.01 s)
//   pos 4 → centenas      (×100 s)
//   pos 5 → unidades      (×1 s)
//   pos 6 → estado interno del servidor (ignorar)
//
// El char 37 del paquete (8º del sub-campo) es un flag F/space sin info de
// tiempo. La cadena literal "EF54AB1" es el centinela de "este carril
// todavía no ha cruzado una vuelta válida".

const TEMPLATE = '7654321';
const NO_LAP_SENTINEL = 'EF54AB1';

function nibble(ch: string): number | null {
  const n = parseInt(ch, 16);
  return Number.isNaN(n) ? null : n;
}

/**
 * Devuelve el tiempo de vuelta en milisegundos, o `null` si el campo es el
 * centinela de "sin vuelta" o si el formato es inválido.
 */
export function decodeLapField(field: string): number | null {
  if (!field || field.length < 7) return null;
  const f = field.slice(0, 7);
  if (f === NO_LAP_SENTINEL) return null;

  const digits: number[] = new Array(7);
  for (let i = 0; i < 7; i++) {
    const e = nibble(f[i]!);
    const t = nibble(TEMPLATE[i]!);
    if (e === null || t === null) return null;
    digits[i] = e ^ t;
  }
  // Cualquier dígito en pos 0..5 fuera de 0-9 → no es un tiempo real
  for (let i = 0; i < 6; i++) {
    if (digits[i]! > 9) return null;
  }

  const tenths     = digits[0]!;
  const tens       = digits[1]!;
  const milesims   = digits[2]!;
  const hundredths = digits[3]!;
  const hundreds   = digits[4]!;
  const units      = digits[5]!;

  return hundreds * 100000 + tens * 10000 + units * 1000
       + tenths * 100 + hundredths * 10 + milesims;
}
