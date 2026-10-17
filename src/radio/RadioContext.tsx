// Capa global de Radio (D12): independiente de la fuente de tiempos. Envuelve
// el protocolo de sala (protocolo.ts), el transporte TCP (tcp.ts) y el
// descubrimiento mDNS (red.ts) en un contexto React, y publica en el bus
// (bus.ts) los mensajes de datos que llegan por la red para que la fuente
// `AsistenteSource` y (en la fase de voz) la coordinación de audio los reciban.
//
// Perfiles:
//   • Hub (quien crea la sala): servidor TCP + anuncio mDNS, lleva el cronómetro
//     y es la fuente de verdad de las vueltas. Es un participante más (id
//     `asistente`) con rol cambiable: puede ser piloto, asistente o seguidor.
//   • Piloto / Asistente / Seguidor remotos: descubren la sala, se unen por TCP y
//     reciben los mensajes que el hub envía a todos. El rol se puede cambiar en
//     vivo (máx. 1 piloto + 1 asistente); el cronómetro siempre vive en el hub y
//     un asistente remoto lo gobierna con `pulso`/`deshacerPulso`/`terminarPulso`.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

import { emitirMensajeRadio } from './bus';
import { generarCodigo } from './codigo';
import { crearCronometro, type Vuelta } from './cronometro';
import type { MensajeRadio, MensajeSenalizacion, MotivoRechazo, Participante, Rol } from './mensajes';
import { crearClienteRadio, crearServidorRadio } from './protocolo';
import { buscarSalas as buscarSalasEnRed, publicarSala, type SalaDescubierta } from './red';
import { ID_ASISTENTE } from './sala';
import { crearTransporteTcp } from './tcp';
import { useVozRadioMotor, type EstadoVozRadio } from './useVozRadio';

interface RadioContextValue {
  // Estado de la sala.
  /** Nuestro rol actual (derivado de la lista de participantes que manda el hub). */
  rol: Rol | null;
  /** ¿Somos el hub (creador de la sala)? */
  esHub: boolean;
  /** ¿Hay una sala activa (hub escuchando o participante dentro)? */
  conectado: boolean;
  codigo: string;
  /** Nombre con el que entramos (lo muestra la pantalla y el resto de la sala). */
  nombre: string;
  participantes: Participante[];
  /** Último error (rechazo al unirse, sala cerrada…). null = sin error. */
  error: string | null;

  // Descubrimiento (participante).
  salas: SalaDescubierta[];
  descubriendo: boolean;

  // Cronómetro (solo el hub lo ejecuta; el resto lo recibe por la red).
  vueltas: Vuelta[];
  mejor: Vuelta | null;
  tandaIniciada: boolean;

  // Voz (vive en el proveedor para que sobreviva a salir hacia atrás).
  voz: EstadoVozRadio;

  // Acciones.
  crearSala: (nombre: string) => Promise<void>;
  unirse: (sala: SalaDescubierta, rol: Rol, nombre: string) => Promise<MotivoRechazo | null>;
  salir: () => void;
  buscarSalas: () => void;
  detenerBusqueda: () => void;

  // Cambio de rol en vivo (máx. 1 piloto + 1 asistente). Funciona igual en el
  // hub y en los remotos.
  cambiarRol: (rol: Rol) => void;

  // Cronómetro manual (el hub lo ejecuta; el asistente remoto manda el comando).
  pulsarVuelta: () => void;
  deshacerVuelta: () => void;
  terminarTanda: () => void;

  /** Suscripción a los mensajes de datos entrantes (para las pantallas). */
  onMensaje: (cb: (m: MensajeRadio) => void) => () => void;

  // Señalización WebRTC (voz, Fase 2).
  /** Nuestro id en la sala: `asistente` en el hub, `p1`/`p2`… en el resto. */
  tuId: string;
  /** Recibe la señalización entrante. `de` es el id del emisor. */
  onSenalizacion: (cb: (de: string, sig: MensajeSenalizacion) => void) => () => void;
  /** Envía señalización al asistente (lado participante). */
  enviarSenalizacion: (sig: MensajeSenalizacion) => void;
  /** Envía señalización a un participante concreto (lado asistente). */
  enviarSenalizacionA: (destinoId: string, sig: MensajeSenalizacion) => void;
}

const Context = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [salas, setSalas] = useState<SalaDescubierta[]>([]);
  const [descubriendo, setDescubriendo] = useState(false);

  const [vueltas, setVueltas] = useState<Vuelta[]>([]);
  const [tandaIniciada, setTandaIniciada] = useState(false);
  const [tuId, setTuId] = useState('');

  // Recursos vivos de la conexión actual (se cierran al salir o al crear otra).
  const servidorRef = useRef<ReturnType<typeof crearServidorRadio> | null>(null);
  const clienteRef = useRef<ReturnType<typeof crearClienteRadio> | null>(null);
  const transporteRef = useRef<ReturnType<typeof crearTransporteTcp> | null>(null);
  const anuncioRef = useRef<{ detener: () => void } | null>(null);
  const busquedaRef = useRef<{ detener: () => void } | null>(null);
  const offDatosRef = useRef<(() => void) | null>(null);
  const offCierreRef = useRef<(() => void) | null>(null);

  const cronometro = useMemo(() => crearCronometro(), []);
  const oyentesRef = useRef<Set<(m: MensajeRadio) => void>>(new Set());
  const oyentesSenalizacionRef = useRef<Set<(de: string, sig: MensajeSenalizacion) => void>>(new Set());

  // El rol se deriva de la lista de participantes que el hub difunde (fuente
  // única de verdad): así un cambio de rol en vivo fluye solo, sin setRol manual.
  const rol = useMemo<Rol | null>(
    () => participantes.find(p => p.id === tuId)?.rol ?? null,
    [participantes, tuId],
  );
  const esHub = tuId === ID_ASISTENTE;

  /** Cierra todo lo abierto y deja el estado como al empezar (sin error). */
  const limpiar = useCallback(() => {
    try { offDatosRef.current?.(); } catch { /* ignore */ }
    try { offCierreRef.current?.(); } catch { /* ignore */ }
    offDatosRef.current = null;
    offCierreRef.current = null;
    try { clienteRef.current?.salir(); } catch { /* ignore */ }
    try { servidorRef.current?.cerrar(); } catch { /* ignore */ }
    try { transporteRef.current?.cerrar(); } catch { /* ignore */ }
    try { anuncioRef.current?.detener(); } catch { /* ignore */ }
    clienteRef.current = null;
    servidorRef.current = null;
    transporteRef.current = null;
    anuncioRef.current = null;
    cronometro.reiniciar();
    setConectado(false);
    setCodigo('');
    setParticipantes([]);
    setVueltas([]);
    setTandaIniciada(false);
    setTuId('');
  }, [cronometro]);

  /** Difunde un resultado a los remotos (TCP) y a nuestro propio bus local
   *  (`AsistenteSource` del hub). Así el hub muestra tiempos como los demás. */
  const difundir = useCallback((m: MensajeRadio) => {
    servidorRef.current?.enviarATodos(m);
    emitirMensajeRadio(m);
  }, []);

  // ── Cronómetro (siempre en el hub) ──────────────────────────────────────

  const ejecutarPulso = useCallback(() => {
    if (!tandaIniciada) {
      // Primer cruce: reinicia la tanda y manda «inicio» (marca el arranque).
      cronometro.reiniciar();
      cronometro.pulsar();
      setTandaIniciada(true);
      setVueltas(cronometro.vueltas());
      difundir({ tipo: 'inicio' });
      return;
    }
    const v = cronometro.pulsar();
    if (v) {
      difundir({ tipo: 'vuelta', n: v.n, ms: v.ms, ts: v.ts });
      setVueltas(cronometro.vueltas());
    }
  }, [cronometro, tandaIniciada, difundir]);

  const ejecutarDeshacer = useCallback(() => {
    const borrada = cronometro.deshacer();
    if (borrada) {
      difundir({ tipo: 'deshacer', n: borrada.n });
      setVueltas(cronometro.vueltas());
    } else {
      // Se deshizo el marcador de inicio: la tanda vuelve a no estar empezada.
      setTandaIniciada(false);
    }
  }, [cronometro, difundir]);

  const ejecutarTerminar = useCallback(() => {
    if (tandaIniciada || cronometro.vueltas().length > 0) {
      difundir({ tipo: 'fin' });
    }
    // Dejamos las vueltas visibles en pantalla; el próximo «Vuelta» reinicia.
    setTandaIniciada(false);
  }, [cronometro, tandaIniciada, difundir]);

  /** Mensaje de datos entrante: lo publica en el bus y actualiza el estado. */
  const alMensaje = useCallback((m: MensajeRadio) => {
    emitirMensajeRadio(m);
    switch (m.tipo) {
      case 'participantes':
        setParticipantes(m.lista);
        break;
      case 'salaCerrada':
        // El hub cerró la sala: nos salimos limpios.
        limpiar();
        setError('salaCerrada');
        break;
      // Comandos de un asistente remoto: el hub ejecuta el cronómetro y difunde
      // el resultado (el protocolo ya valida que vienen del asistente).
      case 'pulso':
        if (esHub) ejecutarPulso();
        break;
      case 'deshacerPulso':
        if (esHub) ejecutarDeshacer();
        break;
      case 'terminarPulso':
        if (esHub) ejecutarTerminar();
        break;
      default:
        break;
    }
  }, [limpiar, esHub, ejecutarPulso, ejecutarDeshacer, ejecutarTerminar]);

  const onMensaje = useCallback((cb: (m: MensajeRadio) => void) => {
    oyentesRef.current.add(cb);
    return () => { oyentesRef.current.delete(cb); };
  }, []);

  const onSenalizacion = useCallback((cb: (de: string, sig: MensajeSenalizacion) => void) => {
    oyentesSenalizacionRef.current.add(cb);
    return () => { oyentesSenalizacionRef.current.delete(cb); };
  }, []);

  const enviarSenalizacion = useCallback((sig: MensajeSenalizacion) => {
    // Lado participante: el mensaje ya lleva `de` = nuestro id.
    clienteRef.current?.enviarSenalizacion(sig);
  }, []);

  const enviarSenalizacionA = useCallback((destinoId: string, sig: MensajeSenalizacion) => {
    // Lado hub: unicast al participante concreto.
    servidorRef.current?.enviarSenalizacion(destinoId, sig);
  }, []);

  const crearSala = useCallback(async (nombreHub: string) => {
    limpiar();
    const codigoNuevo = generarCodigo();
    const transporte = crearTransporteTcp();
    const servidor = crearServidorRadio();
    // `iniciar` registra el hub como participante (rol asistente inicial) y
    // notifica a `setParticipantes` con la lista ya completa.
    await servidor.iniciar(transporte, codigoNuevo, { nombre: nombreHub }, lista => setParticipantes(lista));
    transporteRef.current = transporte;
    servidorRef.current = servidor;
    anuncioRef.current = publicarSala(codigoNuevo);
    offDatosRef.current = servidor.onMensaje(alMensaje);
    servidor.onSenalizacion((de, sig) => {
      for (const cb of [...oyentesSenalizacionRef.current]) cb(de, sig);
    });
    setNombre(nombreHub);
    setCodigo(codigoNuevo);
    setVueltas([]);
    setTandaIniciada(false);
    setTuId(ID_ASISTENTE);
    setError(null);
    setConectado(true);
  }, [limpiar, alMensaje]);

  const unirse = useCallback(async (
    sala: SalaDescubierta,
    rolParticipante: Rol,
    nombreParticipante: string,
  ) => {
    limpiar();
    const transporte = crearTransporteTcp();
    const cliente = crearClienteRadio();
    const resultado = await cliente.unirse(transporte, sala.host, sala.puerto, {
      nombre: nombreParticipante,
      rol: rolParticipante,
      codigo: sala.codigo,
    });
    if (!resultado.ok) {
      try { transporte.cerrar(); } catch { /* ignore */ }
      setError(resultado.motivo ?? 'codigo');
      return resultado.motivo ?? null;
    }
    transporteRef.current = transporte;
    clienteRef.current = cliente;
    offDatosRef.current = cliente.onMensaje(alMensaje);
    cliente.onSenalizacion((sig) => {
      for (const cb of [...oyentesSenalizacionRef.current]) cb('asistente', sig);
    });
    offCierreRef.current = cliente.onCerrar(() => {
      // Se perdió la conexión con el hub (zona WiFi caída, etc.).
      limpiar();
      setError('sinConexion');
    });
    setNombre(nombreParticipante);
    setCodigo(sala.codigo);
    setParticipantes(resultado.lista);
    setTuId(resultado.tuId);
    setError(null);
    setConectado(true);
    return null;
  }, [limpiar, alMensaje]);

  const salir = useCallback(() => {
    limpiar();
    setError(null);
  }, [limpiar]);

  const cambiarRol = useCallback((rolNuevo: Rol) => {
    if (esHub) {
      servidorRef.current?.cambiarRol(ID_ASISTENTE, rolNuevo);
    } else {
      clienteRef.current?.enviar({ tipo: 'cambiarRol', rol: rolNuevo });
    }
    // El rol se actualiza solo cuando el hub difunde la nueva lista de
    // participantes (el servidor valida el cupo y descarta lo ocupado).
  }, [esHub]);

  const pulsarVuelta = useCallback(() => {
    if (esHub) ejecutarPulso();
    else clienteRef.current?.enviar({ tipo: 'pulso' });
  }, [esHub, ejecutarPulso]);

  const deshacerVuelta = useCallback(() => {
    if (esHub) ejecutarDeshacer();
    else clienteRef.current?.enviar({ tipo: 'deshacerPulso' });
  }, [esHub, ejecutarDeshacer]);

  const terminarTanda = useCallback(() => {
    if (esHub) ejecutarTerminar();
    else clienteRef.current?.enviar({ tipo: 'terminarPulso' });
  }, [esHub, ejecutarTerminar]);

  const buscarSalas = useCallback(() => {
    setSalas([]);
    setDescubriendo(true);
    try { busquedaRef.current?.detener(); } catch { /* ignore */ }
    busquedaRef.current = buscarSalasEnRed(sala => {
      setSalas(prev => {
        if (prev.some(s => s.host === sala.host && s.codigo === sala.codigo)) return prev;
        return [...prev, sala];
      });
    });
  }, []);

  const detenerBusqueda = useCallback(() => {
    try { busquedaRef.current?.detener(); } catch { /* ignore */ }
    busquedaRef.current = null;
    setDescubriendo(false);
  }, []);

  // La mejor vuelta se deriva de la lista de vueltas (el cronómetro es la
  // fuente, pero su estado interno no dispara re-renders).
  const mejor = useMemo<Vuelta | null>(() => {
    const primera = vueltas[0];
    if (!primera) return null;
    let m = primera;
    for (const v of vueltas) if (v.ms < m.ms) m = v;
    return m;
  }, [vueltas]);

  // Voz: vive aquí (no en la pantalla) para que la sala siga viva al salir atrás.
  const voz = useVozRadioMotor({
    rol, tuId, esHub, onSenalizacion, enviarSenalizacion, enviarSenalizacionA,
  });

  // Al desmontar (cierre de la app, recarga), liberamos la red.
  const limpiarRef = useRef(limpiar);
  limpiarRef.current = limpiar;
  useEffect(() => {
    return () => limpiarRef.current();
  }, []);

  const value = useMemo<RadioContextValue>(() => ({
    rol, esHub, conectado, codigo, nombre, participantes, error,
    salas, descubriendo,
    vueltas, mejor, tandaIniciada,
    voz,
    crearSala, unirse, salir, buscarSalas, detenerBusqueda,
    cambiarRol,
    pulsarVuelta, deshacerVuelta, terminarTanda,
    onMensaje,
    tuId, onSenalizacion, enviarSenalizacion, enviarSenalizacionA,
  }), [
    rol, esHub, conectado, codigo, nombre, participantes, error,
    salas, descubriendo, vueltas, mejor, tandaIniciada,
    voz,
    crearSala, unirse, salir, buscarSalas, detenerBusqueda,
    cambiarRol,
    pulsarVuelta, deshacerVuelta, terminarTanda, onMensaje,
    tuId, onSenalizacion, enviarSenalizacion, enviarSenalizacionA,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useRadio debe usarse dentro de RadioProvider');
  return ctx;
}
