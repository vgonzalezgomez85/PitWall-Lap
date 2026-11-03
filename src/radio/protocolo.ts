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
import type { MensajeRadio, MensajeSenalizacion, MotivoRechazo, Participante, Rol, TipoSala } from './mensajes';
import { codigosIguales } from './codigo';
import { cambiarRolSala, decidirUnion, eliminarParticipante, ID_ASISTENTE, listaDeParticipantes, registrarParticipante, crearSala, type EstadoSala, participanteObsoleto, rolEfectivo } from './sala';
import type { Canal, TransporteRadio } from './transporte';

/** Tiempo máximo que el participante espera la respuesta del asistente
 *  (`bienvenido`/`rechazado`) tras presentarse. */
const BIENVENIDA_TIMEOUT_MS = 8000;

/** Tiempo máximo de la consulta del tipo de sala. */
const CONSULTA_TIMEOUT_MS = 5000;

export interface ResultadoUnionCliente {
  ok: boolean;
  tuId: string;
  lista: Participante[];
  /** Tipo de sala que dice el hub (carrera si no lo dice). */
  tipoSala: TipoSala;
  motivo?: MotivoRechazo;
}

export interface ServidorRadio {
  /** Empieza a escuchar y registra el hub como participante (`ID_ASISTENTE`).
   *  `onParticipantes` avisa cada vez que cambia la sala. Sin `tipo`, carrera. */
  iniciar(
    transporte: TransporteRadio,
    codigo: string,
    hub: { nombre: string; tipo?: TipoSala },
    onParticipantes: (lista: Participante[]) => void,
  ): Promise<void>;
  /** Envía un mensaje de datos a todos los participantes. */
  enviarATodos(m: MensajeRadio): void;
  /** Cambia el rol del hub (id `ID_ASISTENTE`). Devuelve si se aplicó. */
  cambiarRol(id: string, rol: Rol): boolean;
  /** Recibe los mensajes de datos que manda un participante (p. ej. `estado`,
   *  `pulso`). Devuelve la función de cancelación. */
  onMensaje(cb: (m: MensajeRadio) => void): () => void;
  /** Recibe la señalización WebRTC (oferta/respuesta/candidato) de un
   *  participante. `de` es el id del participante emisor. Devuelve la
   *  cancelación. */
  onSenalizacion(cb: (de: string, sig: MensajeSenalizacion) => void): () => void;
  /** Envía señalización WebRTC a un participante concreto (unicast). */
  enviarSenalizacion(destinoId: string, sig: MensajeSenalizacion): void;
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
  const oyentesSenalizacion = new Set<(de: string, sig: MensajeSenalizacion) => void>();
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
    switch (m.tipo) {
      // Cambio de rol: lo consume el servidor (valida + actualiza la sala y
      // difunde `participantes`). No se reenvía el comando crudo.
      case 'cambiarRol': {
        const r = cambiarRolSala(sala, de, m.rol);
        if (r.ok) {
          sala = r.sala;
          notificar();
        }
        return;
      }
      // Comandos de cronómetro del asistente remoto: se entregan solo al hub
      // (que es quien tiene el cronómetro) y no se reenvían a los demás; el hub
      // difunde el resultado (`inicio`/`vuelta`/`deshacer`/`fin`).
      case 'pulso':
      case 'deshacerPulso':
      case 'terminarPulso': {
        const emisor = sala.participantes.find(p => p.id === de);
        if (emisor?.rol !== 'asistente') return;
        for (const cb of [...oyentesDatos]) cb(m);
        return;
      }
      default: {
        // El resto (p. ej. el `estado` de habla del piloto) se reenvía a todos.
        for (const canal of canales.values()) {
          try { canal.enviar(serializar(m)); } catch { /* canal roto: se cierra solo */ }
        }
        // Y el asistente también lo recibe (para la coordinación locución ↔ voz).
        for (const cb of [...oyentesDatos]) cb(m);
      }
    }
  };

  const presentar = (canal: Canal) => {
    // Esperamos el `unirse`. Antes de eso no hay id asignado.
    let id: string | null = null;

    const offMensaje = canal.onMensaje((texto) => {
      const sig = deserializarSenalizacion(texto);

      // Consulta del tipo de sala: se contesta y se cierra, sin alta.
      if (sig?.tipo === 'consultar' && id === null) {
        const respuesta: MensajeSenalizacion = codigosIguales(sala.codigo, sig.codigo)
          ? { tipo: 'info', tipoSala: sala.tipo }
          : { tipo: 'rechazado', motivo: 'codigo' };
        try { canal.enviar(serializarSenalizacion(respuesta)); } catch { /* ignore */ }
        canal.cerrar();
        return;
      }

      if (sig?.tipo === 'unirse' && id === null) {
        // Él mismo reconectando: se descarta su conexión vieja (medio muerta)
        // para que su papel quede libre.
        const viejo = participanteObsoleto(sala, sig.nombre, sig.rol);
        if (viejo) {
          const canalViejo = canales.get(viejo);
          alCerrar(viejo);
          try { canalViejo?.cerrar(); } catch { /* ignore */ }
        }
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
            tipo: 'bienvenido', tuId: id, lista: listaDeParticipantes(sala), tipoSala: sala.tipo,
          }));
        } catch { /* ignore */ }
        notificar();
        return;
      }

      // Ya presentado: `salir` lo quita.
      if (id !== null && sig?.tipo === 'salir') {
        alCerrar(id);
        canal.cerrar();
        return;
      }

      // Señalización WebRTC (oferta/respuesta/candidato): no es ni `unirse` ni
      // `salir`; se entrega al asistente con el id del emisor para que negocie
      // el peer 1:1 (nunca se reenvía a otros participantes).
      if (
        id !== null && sig !== null &&
        (sig.tipo === 'oferta' || sig.tipo === 'respuesta' || sig.tipo === 'candidato' || sig.tipo === 'renegociar')
      ) {
        // Voz en malla: si va para otro participante, el hub solo la reenvía,
        // poniendo como emisor al id real (no se fía del `de` que trae).
        if (sig.para && sig.para !== ID_ASISTENTE) {
          const destino = canales.get(sig.para);
          try { destino?.enviar(serializarSenalizacion({ ...sig, de: id })); } catch { /* canal roto */ }
          return;
        }
        for (const cb of [...oyentesSenalizacion]) cb(id, { ...sig, de: id });
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
    async iniciar(t, codigo, hub, cb) {
      transporte = t;
      onParticipantes = cb;
      // El hub (creador) entra como participante con id estable y rol asistente
      // inicial (en entrenos, `libre`); en carrera podrá cambiarlo después con
      // `cambiarRol`.
      const nueva = crearSala(codigo, hub.tipo ?? 'carrera');
      sala = registrarParticipante(nueva, {
        id: ID_ASISTENTE, nombre: hub.nombre, rol: rolEfectivo(nueva, 'asistente'),
      });
      notificar();
      await t.escuchar(presentar);
    },
    enviarATodos(m) {
      for (const canal of canales.values()) {
        try { canal.enviar(serializar(m)); } catch { /* ignore */ }
      }
    },
    cambiarRol(id, rol) {
      const r = cambiarRolSala(sala, id, rol);
      if (r.ok) {
        sala = r.sala;
        notificar();
        return true;
      }
      return false;
    },
    onMensaje(cb) {
      oyentesDatos.add(cb);
      return () => oyentesDatos.delete(cb);
    },
    onSenalizacion(cb) {
      oyentesSenalizacion.add(cb);
      return () => oyentesSenalizacion.delete(cb);
    },
    enviarSenalizacion(destinoId, sig) {
      const canal = canales.get(destinoId);
      if (!canal) return;
      try { canal.enviar(serializarSenalizacion(sig)); } catch { /* ignore */ }
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
  /** Se suscribe a la señalización WebRTC del asistente (oferta/respuesta/
   *  candidato). */
  onSenalizacion(cb: (sig: MensajeSenalizacion) => void): () => void;
  /** Se suscribe al cierre de la conexión (asistente caído o sala cerrada). */
  onCerrar(cb: () => void): () => void;
  /** Envía un mensaje de datos al asistente (p. ej. `estado`). */
  enviar(m: MensajeRadio): void;
  /** Envía señalización WebRTC al asistente. */
  enviarSenalizacion(sig: MensajeSenalizacion): void;
  /** Se va de la sala. */
  salir(): void;
}

export function crearClienteRadio(): ClienteRadio {
  let canal: Canal | null = null;
  let tuId = '';
  const oyentes = new Set<(m: MensajeRadio) => void>();
  const oyentesSenalizacion = new Set<(sig: MensajeSenalizacion) => void>();
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
        // Señalización WebRTC del asistente.
        const sig = deserializarSenalizacion(texto);
        if (
          sig !== null &&
          (sig.tipo === 'oferta' || sig.tipo === 'respuesta' || sig.tipo === 'candidato' || sig.tipo === 'renegociar')
        ) {
          for (const cb of [...oyentesSenalizacion]) cb(sig);
        }
      });
      offs.push(offMensaje);

      return new Promise<ResultadoUnionCliente>((resolve, reject) => {
        let asentado = false;
        const temporizador = setTimeout(() => {
          if (asentado) return;
          asentado = true;
          try { c.cerrar(); } catch { /* ignore */ }
          reject(new Error('timeout esperando la respuesta de la sala'));
        }, BIENVENIDA_TIMEOUT_MS);

        // Si la conexión cae durante la presentación, no hay respuesta que esperar.
        const offCierreEntrada = c.onCerrar(() => {
          if (asentado) return;
          asentado = true;
          clearTimeout(temporizador);
          reject(new Error('conexión cerrada durante la entrada'));
        });
        offs.push(offCierreEntrada);

        const offRespuesta = c.onMensaje((texto) => {
          const sig = deserializarSenalizacion(texto);
          if (!sig) return;
          if (sig.tipo === 'bienvenido') {
            if (asentado) return;
            asentado = true;
            clearTimeout(temporizador);
            offCierreEntrada();
            offRespuesta();
            tuId = sig.tuId;
            resolve({ ok: true, tuId: sig.tuId, lista: sig.lista, tipoSala: sig.tipoSala ?? 'carrera' });
          } else if (sig.tipo === 'rechazado') {
            if (asentado) return;
            asentado = true;
            clearTimeout(temporizador);
            offCierreEntrada();
            offRespuesta();
            resolve({ ok: false, tuId: '', lista: [], tipoSala: 'carrera', motivo: sig.motivo });
          }
        });
        offs.push(offRespuesta);

        try {
          c.enviar(serializarSenalizacion({ tipo: 'unirse', ...peticion }));
        } catch {
          if (asentado) return;
          asentado = true;
          clearTimeout(temporizador);
          offCierreEntrada();
          offRespuesta();
          resolve({ ok: false, tuId: '', lista: [], tipoSala: 'carrera', motivo: 'codigo' });
        }
      });
    },

    onMensaje(cb) {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },

    onSenalizacion(cb) {
      oyentesSenalizacion.add(cb);
      return () => oyentesSenalizacion.delete(cb);
    },

    onCerrar(cb) {
      oyentesCierre.add(cb);
      return () => oyentesCierre.delete(cb);
    },

    enviar(m) {
      try { canal?.enviar(serializar(m)); } catch { /* ignore */ }
    },

    enviarSenalizacion(sig) {
      try { canal?.enviar(serializarSenalizacion(sig)); } catch { /* ignore */ }
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

/**
 * Pregunta al hub de qué tipo es su sala sin entrar en ella (entrada con IP o
 * por internet, donde no hay anuncio que lo diga). Devuelve `null` si el código
 * no es el de la sala; lanza si no hay conexión o no contesta a tiempo.
 */
export async function consultarTipoSala(
  transporte: TransporteRadio,
  host: string,
  puerto: number,
  codigo: string,
): Promise<TipoSala | null> {
  const c = await transporte.conectar(host, puerto);
  return new Promise<TipoSala | null>((resolve, reject) => {
    let asentado = false;
    const offs: (() => void)[] = [];
    const terminar = (fn: () => void) => {
      if (asentado) return;
      asentado = true;
      clearTimeout(temporizador);
      for (const off of offs) off();
      try { c.cerrar(); } catch { /* ignore */ }
      fn();
    };
    const temporizador = setTimeout(
      () => terminar(() => reject(new Error('timeout esperando la respuesta de la sala'))),
      CONSULTA_TIMEOUT_MS,
    );
    offs.push(c.onMensaje((texto) => {
      const sig = deserializarSenalizacion(texto);
      if (sig?.tipo === 'info') terminar(() => resolve(sig.tipoSala));
      else if (sig?.tipo === 'rechazado') terminar(() => resolve(null));
    }));
    offs.push(c.onCerrar(() => terminar(() => reject(new Error('conexión cerrada durante la consulta')))));
    try {
      c.enviar(serializarSenalizacion({ tipo: 'consultar', codigo }));
    } catch (e) {
      terminar(() => reject(e instanceof Error ? e : new Error(String(e))));
    }
  });
}

/** Generador de ids cortos y únicos (`p1`, `p2`, …). */
function contadorIds(): () => string {
  let n = 0;
  return () => `p${++n}`;
}
