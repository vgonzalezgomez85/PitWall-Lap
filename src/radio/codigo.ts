// Código corto de sala de Radio (p. ej. `K7M-4QX`). Lógica pura, sin React
// ni nativos, para poder testearla.
//
// El código se genera en el móvil del asistente al crear la sala y evita que
// se cuele alguien que esté en la misma red WiFi (la sala se anuncia por
// mDNS a todos, pero solo entra quien conoce el código).

// Alfabeto sin caracteres confusos (sin 0/O, 1/I/L, ni vocales que formen
// palabras). En mayúsculas para que se teclee y se lea igual en todos los
// idiomas.
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// Longitud del código: 3 + separador + 3 (p. ej. `K7M-4QX`).
const LONGITUD = 6;

/** Genera un código de sala aleatorio (p. ej. `K7M-4QX`). */
export function generarCodigo(random: () => number = Math.random): string {
  const parte = () => {
    let s = '';
    for (let i = 0; i < LONGITUD / 2; i++) {
      s += ALFABETO[Math.floor(random() * ALFABETO.length)];
    }
    return s;
  };
  return `${parte()}-${parte()}`;
}

/** Normaliza un código tecleado: mayúsculas y sin espacios ni separadores.
 *  `k7m-4qx` → `K7M4QX`. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** ¿Dos códigos son el mismo? Compara normalizados (ignora el guion). */
export function codigosIguales(a: string, b: string): boolean {
  const na = normalizarCodigo(a);
  const nb = normalizarCodigo(b);
  return na.length > 0 && na === nb;
}

/** ¿Un código tecleado tiene la forma válida (6 caracteres del alfabeto)? */
export function codigoValido(codigo: string): boolean {
  const n = normalizarCodigo(codigo);
  if (n.length !== LONGITUD) return false;
  return [...n].every(c => ALFABETO.includes(c));
}

/** Formatea un código para mostrarlo en grande (`K7M4QX` → `K7M-4QX`). */
export function formatearCodigo(codigo: string): string {
  const n = normalizarCodigo(codigo);
  if (n.length < LONGITUD) return codigo.toUpperCase();
  return `${n.slice(0, 3)}-${n.slice(3, 6)}`;
}
