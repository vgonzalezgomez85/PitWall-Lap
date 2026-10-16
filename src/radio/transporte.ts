// Abstracción del transporte de red de Radio. Permite testear el protocolo de
// sala (protocolo.ts) sin los módulos nativos: en producción se usa TCP
// (tcp.ts) y en los tests `crearTransporteMemoria`, un loopback en memoria.
//
// Un `Canal` es una conexión punto a punto con el asistente: cada participante
// tiene uno, y sobre él viajan primero la señalización (unirse/bienvenido) y
// luego los mensajes de datos.

export interface Canal {
  /** Envía una línea de texto (un mensaje JSON) al otro extremo. */
  enviar(texto: string): void;
  /** Se suscribe a los mensajes entrantes. Devuelve la cancelación. */
  onMensaje(cb: (texto: string) => void): () => void;
  /** Se suscribe al cierre de la conexión. */
  onCerrar(cb: () => void): () => void;
  cerrar(): void;
}

export interface TransporteRadio {
  /** Lado asistente: empieza a aceptar conexiones. `onConexion` recibe cada
   *  nuevo canal entrante. */
  escuchar(onConexion: (canal: Canal) => void): Promise<void>;
  /** Lado participante: abre un canal hacia el asistente en `host`:`puerto`. */
  conectar(host: string, puerto: number): Promise<Canal>;
  /** Libera el transporte (cierra el servidor y/o los canales). */
  cerrar(): void;
}

// ── Transporte en memoria (solo tests) ─────────────────────────────────────

/** Crea dos canales enlazados: lo que `a.enviar` entrega a los oyentes de `b`
 *  y viceversa. Cerrar cualquiera de los dos avisa a los oyentes de ambos. */
function crearParCanales(): { a: Canal; b: Canal } {
  const oyentesA = new Set<(t: string) => void>();
  const oyentesB = new Set<(t: string) => void>();
  const cierresA = new Set<() => void>();
  const cierresB = new Set<() => void>();
  let cerrado = false;

  const cerrarAmbos = () => {
    if (cerrado) return;
    cerrado = true;
    for (const cb of [...cierresA, ...cierresB]) cb();
  };

  const a: Canal = {
    enviar: (texto) => {
      if (!cerrado) for (const cb of [...oyentesB]) cb(texto);
    },
    onMensaje: (cb) => {
      oyentesA.add(cb);
      return () => oyentesA.delete(cb);
    },
    onCerrar: (cb) => {
      cierresA.add(cb);
      return () => cierresA.delete(cb);
    },
    cerrar: cerrarAmbos,
  };

  const b: Canal = {
    enviar: (texto) => {
      if (!cerrado) for (const cb of [...oyentesA]) cb(texto);
    },
    onMensaje: (cb) => {
      oyentesB.add(cb);
      return () => oyentesB.delete(cb);
    },
    onCerrar: (cb) => {
      cierresB.add(cb);
      return () => cierresB.delete(cb);
    },
    cerrar: cerrarAmbos,
  };

  return { a, b };
}

/**
 * Loopback en memoria: `conectar()` crea un canal de cliente enlazado con un
 * canal de servidor entregado a `onConexion`. Útil para probar el protocolo
 * completo sin red.
 */
export function crearTransporteMemoria(): TransporteRadio {
  let onConexion: ((canal: Canal) => void) | null = null;

  return {
    async escuchar(cb) {
      onConexion = cb;
    },
    async conectar() {
      if (!onConexion) throw new Error('sin servidor escuchando');
      const { a, b } = crearParCanales();
      onConexion(b); // lado servidor
      return a;      // lado cliente
    },
    cerrar() {
      onConexion = null;
    },
  };
}
