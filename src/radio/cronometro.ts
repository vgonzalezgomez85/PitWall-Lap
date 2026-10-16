// Cronómetro manual del asistente. Lógica pura (reloj inyectado) para poder
// testearla.
//
// El asistente pulsa «Vuelta» cada vez que el coche cruza meta. El tiempo de
// una vuelta es la diferencia entre dos pulsaciones consecutivas; la primera
// pulsación de la tanda marca el inicio (aún no hay tiempo de vuelta).

export interface Vuelta {
  /** Número de vuelta (empezando en 1). */
  n: number;
  /** Tiempo de la vuelta en ms. */
  ms: number;
  /** Instante del cruce (epoch ms del reloj inyectado). */
  ts: number;
}

export interface CronometroAsistente {
  /** Registra un cruce. Devuelve la vuelta o `null` si es el primer cruce. */
  pulsar(): Vuelta | null;
  /** Borra la última vuelta (pulsación por error). Devuelve la borrada o null. */
  deshacer(): Vuelta | null;
  /** Lista de vueltas registradas (ordenadas por nº de vuelta). */
  vueltas(): Vuelta[];
  /** Número de vueltas registradas. */
  total(): number;
  /** Mejor vuelta (la de menor `ms`) o `null` si no hay. */
  mejor(): Vuelta | null;
  /** Reinicia la tanda (borra vueltas y deja el reloj listo). */
  reiniciar(): void;
}

/**
 * Crea un cronómetro. `now` es el reloj (epoch ms); por defecto `Date.now`.
 */
export function crearCronometro(
  now: () => number = Date.now,
): CronometroAsistente {
  let lista: Vuelta[] = [];
  // Instante de la pulsación anterior (o del inicio de la tanda).
  let previo: number | null = null;

  return {
    pulsar() {
      const ts = now();
      if (previo === null) {
        previo = ts;
        return null;
      }
      const v: Vuelta = { n: lista.length + 1, ms: ts - previo, ts };
      lista.push(v);
      previo = ts;
      return v;
    },

    deshacer() {
      if (lista.length === 0) {
        // Sin vueltas: quitar la marca de inicio para que la siguiente
        // pulsación vuelva a ser el arranque (y no mida desde una meta falsa).
        previo = null;
        return null;
      }
      const borrada = lista[lista.length - 1];
      lista = lista.slice(0, -1);
      // La pulsación anterior a la borrada vuelve a ser la referencia.
      const anterior = lista[lista.length - 1];
      previo = anterior ? anterior.ts : null;
      return borrada ?? null;
    },

    vueltas() {
      return lista.slice();
    },

    total() {
      return lista.length;
    },

    mejor() {
      const primera = lista[0];
      if (!primera) return null;
      let m = primera;
      for (const v of lista) {
        if (v.ms < m.ms) m = v;
      }
      return m;
    },

    reiniciar() {
      lista = [];
      previo = null;
    },
  };
}
