// Protocolo de sala de Radio por encima del transporte (TCP en producción,
// memoria en tests). Puro: no importa React ni módulos nativos.
//
// Lado asistente (`ServidorRadio`): acepta conexiones, valida el código con las
// reglas de sala.ts y, una vez dentro, reenvía los mensajes de datos a todos.
// El asistente es la fuente de verdad de las vueltas.
//
// Lado participante (`ClienteRadio`): se presenta con nombre/rol/código y, si
// le dejan entrar, recibe/envía mensajes de datos.

import { deserializar, deserializarSenalizacion, serializar, serializarSenalizacion } from './mensajes';
import type { MensajeRadio, MensajeSenalizacion, MotivoRechazo, Participante, Rol } from './mensajes';
import { decidirUnion, eliminarParticipante, listaDeParticipantes, registrarParticipante, crearSala, type EstadoSala } from './sala';
import type { Canal, TransporteRadio } from './transporte';

export interface ResultadoUnionCliente {
  ok: boolean;
  tuId: string;
  lista: Participante[];
  motivo?: MotivoRechazo;
}

export interface ServidorRadio {
  /** Empieza a escuchar. `onParticipantes` avisa cada vez que cambia la sala. */
  iniciar(
    transporte: TransporteRadio,
    codigo: string,
    onParticipantes: (lista: Participante[]) => void,
  ): Promise<void>;
  /** Envía un mensaje de datos a todos los participantes. */
  enviarATodos(m: MensajeRadio): void;
  /** Recibe los mensajes de datos que manda un participante (p. ej. `estado`).
   *  Devuelve la función de cancelación. */
  onMensaje(cb: (m: MensajeRadio) => void): () => void;
  /** Sala actual (para que la UI muestre código y conectados). */
  sala(): EstadoSala;
  cerrar(): void;
}

export function crearServidorRadio(
  generarId: () => string = contadorIds(),
): ServidorRadio {
  let sala: EstadoSala = crearSala('');
  let onParticipantes: ((lista: Participante[]) => void) | null = null;
  const canales = new Map<string, Canal>();
  const oyentesDatos = new Set<(m: MensajeRadio) => void>();
  let transporte: TransporteRadio | null = null;
  let cerrado = false;

  const notificar = () => {
    const lista = listaDeParticipantes(sala);
    onParticipantes?.(lista);
    // Además del callback local (asistente), empujamos la lista a todos los
    // participantes para que sus pantallas muestren quién hay conectado.
    const msg = serializar({ tipo: 'participantes', lista });
    for (const canal of canales.values()) {
      try { canal.enviar(msg); } catch { /* canal roto: se cierra solo */ }
    }
  };

  const alCerrar = (id: string) => {
    if (!canales.has(id)) return;
    canales.delete(id);
    sala = eliminarParticipante(sala, id);
    notificar();
  };

  const alMensajeDeDatos = (de: string, m: MensajeRadio) => {
    // El asistente reenvía lo que manda un participante a todos (p. ej. el
    // `estado` de habla del piloto). El emisor lo recibe también: su propio
    // estado es correcto y simplifica la coordinación de voz.
    for (const canal of canales.values()) {
      try { canal.enviar(serializar(m)); } catch { /* canal roto: se cierra solo */ }
    }
    // Y el asistente también lo recibe (para la coordinación locución ↔ voz).
    for (const cb of [...oyentesDatos]) cb(m);
  };

  const presentar = (canal: Canal) => {
    // Esperamos el `unirse`. Antes de eso no hay id asignado.
    let id: string | null = null;

    const offMensaje = canal.onMensaje((texto) => {
      const sig = deserializarSenalizacion(texto);

      if (sig?.tipo === 'unirse' && id === null) {
        id = generarId();
        const resultado = decidirUnion(sala, {
          id, nombre: sig.nombre, rol: sig.rol, codigo: sig.codigo,
        });
        if (!resultado.ok) {
          try { canal.enviar(serializarSenalizacion({ tipo: 'rechazado', motivo: resultado.motivo })); } catch { /* ignore */ }
          canal.cerrar();
          return;
        }
        // Aceptado: registramos, respondemos y pasamos a modo datos.
        sala = registrarParticipante(sala, resultado.participante);
        canales.set(id, canal);
        try {
          canal.enviar(serializarSenalizacion({
            tipo: 'bienvenido', tuId: id, lista: listaDeParticipantes(sala),
          }));
        } catch { /* ignore */ }
        notificar();
        return;
      }

      // Ya presentado: `salir` lo quita; la señalización WebRTC (Fase 2) y el
      // resto se ignoran aquí.
      if (id !== null && sig?.tipo === 'salir') {
        alCerrar(id);
        canal.cerrar();
        return;
      }

      // Mensajes de datos: el asistente los reenvía a todos.
      const dato = deserializar(texto);
      if (id !== null && dato) alMensajeDeDatos(id, dato);
    });

    canal.onCerrar(() => {
      offMensaje();
      if (id !== null) alCerrar(id);
    });
  };

  return {
    async iniciar(t, codigo, cb) {
      transporte = t;
      onParticipantes = cb;
      sala = crearSala(codigo);
      await t.escuchar(presentar);
    },
    enviarATodos(m) {
      for (const canal of canales.values()) {
        try { canal.enviar(serializar(m)); } catch { /* ignore */ }
      }
    },
    onMensaje(cb) {
      oyentesDatos.add(cb);
      return () => oyentesDatos.delete(cb);
    },
    sala() {
      return sala;
    },
    cerrar() {
      cerrado = true;
      for (const canal of canales.values()) {
        try { canal.cerrar(); } catch { /* ignore */ }
      }
      canales.clear();
      transporte?.cerrar();
      sala = crearSala('');
    },
  };
}

// ── Lado participante ──────────────────────────────────────────────────────

export interface ClienteRadio {
  /** Se presenta y espera el veredicto del asistente. */
  unirse(
    transporte: TransporteRadio,
    host: string,
    puerto: number,
    peticion: { nombre: string; rol: Rol; codigo: string },
  ): Promise<ResultadoUnionCliente>;
  /** Se suscribe a los mensajes de datos reenviados por el asistente. */
  onMensaje(cb: (m: MensajeRadio) => void): () => void;
  /** Se suscribe al cierre de la conexión (asistente caído o sala cerrada). */
  onCerrar(cb: () => void): () => void;
  /** Envía un mensaje de datos al asistente (p. ej. `estado`). */
  enviar(m: MensajeRadio): void;
  /** Se va de la sala. */
  salir(): void;
}

export function crearClienteRadio(): ClienteRadio {
  let canal: Canal | null = null;
  let tuId = '';
  const oyentes = new Set<(m: MensajeRadio) => void>();
  const oyentesCierre = new Set<() => void>();
  const offs: (() => void)[] = [];

  const avisarCierre = () => {
    for (const cb of [...oyentesCierre]) cb();
  };

  return {
    async unirse(transporte, host, puerto, peticion) {
      canal = await transporte.conectar(host, puerto);
      const c = canal;

      const offCierre = c.onCerrar(avisarCierre);
      offs.push(offCierre);

      const offMensaje = c.onMensaje((texto) => {
        // Mensajes de datos (ya dentro de la sala).
        const dato = deserializar(texto);
        if (dato) {
          for (const cb of [...oyentes]) cb(dato);
          return;
        }
      });
      offs.push(offMensaje);

      return new Promise<ResultadoUnionCliente>((resolve) => {
        const offRespuesta = c.onMensaje((texto) => {
          const sig = deserializarSenalizacion(texto);
          if (!sig) return;
          if (sig.tipo === 'bienvenido') {
            tuId = sig.tuId;
            offRespuesta();
            resolve({ ok: true, tuId: sig.tuId, lista: sig.lista });
          } else if (sig.tipo === 'rechazado') {
            offRespuesta();
            resolve({ ok: false, tuId: '', lista: [], motivo: sig.motivo });
          }
        });
        offs.push(offRespuesta);

        try {
          c.enviar(serializarSenalizacion({ tipo: 'unirse', ...peticion }));
        } catch {
          offRespuesta();
          resolve({ ok: false, tuId: '', lista: [], motivo: 'codigo' });
        }
      });
    },

    onMensaje(cb) {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },

    onCerrar(cb) {
      oyentesCierre.add(cb);
      return () => oyentesCierre.delete(cb);
    },

    enviar(m) {
      try { canal?.enviar(serializar(m)); } catch { /* ignore */ }
    },

    salir() {
      if (canal && tuId) {
        try {
          canal.enviar(serializarSenalizacion({ tipo: 'salir', id: tuId }));
        } catch { /* ignore */ }
      }
      for (const off of offs) off();
      offs.length = 0;
      try { canal?.cerrar(); } catch { /* ignore */ }
      canal = null;
      tuId = '';
    },
  };
}

/** Generador de ids cortos y únicos (`p1`, `p2`, …). */
function contadorIds(): () => string {
  let n = 0;
  return () => `p${++n}`;
}
