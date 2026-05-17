// Decoder del campo "tiempo" del paquete de estado 52-byte de InfoLap.
//
// Cada paquete (52 bytes) tiene un sub-campo de 7 chars en posiciones 30..36
// (el char 37 es un flag F/space sin info temporal). Esos 7 chars son hex
// digits que se decodifican como TEMPLATE XOR digit, donde la posición indica
// el componente del tiempo:
//
//   pos 0 → décimas       (×0.1)
//   pos 1 → decenas       (×10)
//   pos 2 → milésimas     (×0.001)
//   pos 3 → centésimas    (×0.01)
//   pos 4 → centenas      (×100)
//   pos 5 → unidades      (×1)
//   pos 6 → desconocido   (varía con estado interno del servidor — ignorar)
//
// Si cualquier dígito decodificado queda fuera de 0-9 → el carril no ha
// completado una vuelta válida todavía (estado default "EF54AB1").

const TEMPLATE = '7654321';

function hexNibble(ch) {
  const n = parseInt(ch, 16);
  return Number.isNaN(n) ? null : n;
}

// Valor literal centinela que el servidor envía mientras un carril aún no
// ha completado ninguna vuelta válida.
const NO_LAP_SENTINEL = 'EF54AB1';

function decodeLapField(field) {
  if (!field || field.length < 7) return null;
  const f = field.slice(0, 7);
  if (f === NO_LAP_SENTINEL) return null;
  const digits = new Array(7);
  for (let i = 0; i < 7; i++) {
    const e = hexNibble(f[i]);
    const t = hexNibble(TEMPLATE[i]);
    if (e === null) return null;
    digits[i] = e ^ t;
  }
  // Si cualquier dígito real (pos 0..5) cae fuera de 0-9 → no es un tiempo válido
  for (let i = 0; i < 6; i++) {
    if (digits[i] > 9) return null;
  }
  const tenths     = digits[0];
  const tens       = digits[1];
  const milesims   = digits[2];
  const hundredths = digits[3];
  const hundreds   = digits[4];
  const units      = digits[5];
  const ms = hundreds * 100000 + tens * 10000 + units * 1000
          + tenths * 100 + hundredths * 10 + milesims;
  return ms;
}

// Smoke tests con valores reales capturados durante la reverse-engineering session
if (require.main === module) {
  const cases = [
    ['7654331', 1000],     // 1.000s
    ['7754321', 10000],    // 10.000s
    ['76543A1', 8000],     // 8.000s
    ['76543B1', 9000],     // 9.000s
    ['415D333', 71390],    // 71.39s
    ['E634368', 4906],     // 4.906s (lap announced as "4,90")
    ['16DC305', 2688],     // 2.688s (lap announced as "2,68")
    ['6666371', 5123],     // 5.123s
    ['2654371', 5500],     // 5.500s
    ['EF54AB1', null],     // default — no lap yet
  ];
  let pass = 0, fail = 0;
  for (const [field, expected] of cases) {
    const got = decodeLapField(field);
    const ok = got === expected;
    console.log(`${ok ? 'OK ' : 'FAIL'}  ${field}  →  ${got}ms  (expected ${expected})`);
    if (ok) pass++; else fail++;
  }
  console.log(`\n${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

module.exports = { decodeLapField, TEMPLATE };
