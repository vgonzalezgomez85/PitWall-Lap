// Capa global de Radio (D12): independiente de la fuente de tiempos. Envuelve
// el protocolo de sala (protocolo.ts), el transporte TCP (tcp.ts) y el
// descubrimiento mDNS (red.ts) en un contexto React, y publica en el bus
// (bus.ts) los mensajes de datos que llegan por la red para que la fuente
// `AsistenteSource` y (en la fase de voz) la coordinación de audio los reciban.
//
// Perfiles:
//   • Asistente: crea la sala (servidor TCP + anuncio mDNS), lleva el
//     cronómetro manual y es la fuente de verdad de las vueltas.
//   • Piloto / Seguidor: descubren la sala, se unen por TCP y reciben los
//     mensajes que el asistente envía a todos.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

import { emitirMensajeRadio } from './bus';
import { generarCodigo } from './codigo';
import { crearCronometro, type Vuelta } from './cronometro';
import type { MensajeRadio, MotivoRechazo, Participante, Rol } from './mensajes';
import { crearClienteRadio, crearServidorRadio } from './protocolo';
import { buscarSalas as buscarSalasEnRed, publicarSala, type SalaDescubierta } from './red';
import { crearTransporteTcp } from './tcp';

interface RadioContextValue {
  // Estado de la sala.
  rol: Rol | null;
  /** ¿Hay una sala activa (asistente escuchando o participante dentro)? */
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

  // Cronómetro del asistente.
  vueltas: Vuelta[];
  mejor: Vuelta | null;
  tandaIniciada: boolean;

  // Acciones.
  crearSala: (nombre: string) => Promise<void>;
  unirse: (sala: SalaDescubierta, rol: Rol, nombre: string) => Promise<MotivoRechazo | null>;
  salir: () => void;
  buscarSalas: () => void;
  detenerBusqueda: () => void;

  // Asistente: cronómetro manual.
  pulsarVuelta: () => void;
  deshacerVuelta: () => void;
  terminarTanda: () => void;

  /** Suscripción a los mensajes de datos entrantes (para las pantallas). */
  onMensaje: (cb: (m: MensajeRadio) => void) => () => void;
}

const Context = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const [rol, setRol] = useState<Rol | null>(null);
  const [conectado, setConectado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [salas, setSalas] = useState<SalaDescubierta[]>([]);
  const [descubriendo, setDescubriendo] = useState(false);

  const [vueltas, setVueltas] = useState<Vuelta[]>([]);
  const [tandaIniciada, setTandaIniciada] = useState(false);

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
    setRol(null);
    setConectado(false);
    setCodigo('');
    setParticipantes([]);
    setVueltas([]);
    setTandaIniciada(false);
  }, [cronometro]);

  /** Mensaje de datos entrante: lo publica en el bus y actualiza el estado. */
  const alMensaje = useCallback((m: MensajeRadio) => {
    emitirMensajeRadio(m);
    switch (m.tipo) {
      case 'participantes':
        setParticipantes(m.lista);
        break;
      case 'salaCerrada':
        // El asistente cerró la sala: nos salimos limpios.
        limpiar();
        setError('salaCerrada');
        break;
      default:
        break;
    }
  }, [limpiar]);

  const onMensaje = useCallback((cb: (m: MensajeRadio) => void) => {
    oyentesRef.current.add(cb);
    return () => { oyentesRef.current.delete(cb); };
  }, []);

  const crearSala = useCallback(async (nombreAsistente: string) => {
    limpiar();
    const codigoNuevo = generarCodigo();
    const transporte = crearTransporteTcp();
    const servidor = crearServidorRadio();
    await servidor.iniciar(transporte, codigoNuevo, lista => setParticipantes(lista));
    transporteRef.current = transporte;
    servidorRef.current = servidor;
    anuncioRef.current = publicarSala(codigoNuevo);
    offDatosRef.current = servidor.onMensaje(alMensaje);
    setRol('asistente');
    setNombre(nombreAsistente);
    setCodigo(codigoNuevo);
    setParticipantes([]);
    setVueltas([]);
    setTandaIniciada(false);
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
    offCierreRef.current = cliente.onCerrar(() => {
      // Se perdió la conexión con el asistente (zona WiFi caída, etc.).
      limpiar();
      setError('sinConexion');
    });
    setRol(rolParticipante);
    setNombre(nombreParticipante);
    setCodigo(sala.codigo);
    setParticipantes(resultado.lista);
    setError(null);
    setConectado(true);
    return null;
  }, [limpiar, alMensaje]);

  const salir = useCallback(() => {
    limpiar();
    setError(null);
  }, [limpiar]);

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

  // ── Cronómetro del asistente ─────────────────────────────────────────────

  const pulsarVuelta = useCallback(() => {
    if (!servidorRef.current) return;
    if (!tandaIniciada) {
      // Primer cruce: reinicia la tanda y manda «inicio» (marca el arranque).
      cronometro.reiniciar();
      cronometro.pulsar();
      setTandaIniciada(true);
      setVueltas(cronometro.vueltas());
      servidorRef.current.enviarATodos({ tipo: 'inicio' });
      return;
    }
    const v = cronometro.pulsar();
    if (v) {
      servidorRef.current.enviarATodos({ tipo: 'vuelta', n: v.n, ms: v.ms, ts: v.ts });
      setVueltas(cronometro.vueltas());
    }
  }, [cronometro, tandaIniciada]);

  const deshacerVuelta = useCallback(() => {
    if (!servidorRef.current) return;
    const borrada = cronometro.deshacer();
    if (borrada) {
      servidorRef.current.enviarATodos({ tipo: 'deshacer', n: borrada.n });
      setVueltas(cronometro.vueltas());
    } else {
      // Se deshizo el marcador de inicio: la tanda vuelve a no estar empezada.
      setTandaIniciada(false);
    }
  }, [cronometro]);

  const terminarTanda = useCallback(() => {
    if (!servidorRef.current) return;
    if (tandaIniciada || cronometro.vueltas().length > 0) {
      servidorRef.current.enviarATodos({ tipo: 'fin' });
    }
    // Dejamos las vueltas visibles en pantalla; el próximo «Vuelta» reinicia.
    setTandaIniciada(false);
  }, [cronometro, tandaIniciada]);

  // La mejor vuelta se deriva de la lista de vueltas (el cronómetro es la
  // fuente, pero su estado interno no dispara re-renders).
  const mejor = useMemo<Vuelta | null>(() => {
    const primera = vueltas[0];
    if (!primera) return null;
    let m = primera;
    for (const v of vueltas) if (v.ms < m.ms) m = v;
    return m;
  }, [vueltas]);

  // Al desmontar (cierre de la app, recarga), liberamos la red.
  const limpiarRef = useRef(limpiar);
  limpiarRef.current = limpiar;
  useEffect(() => {
    return () => limpiarRef.current();
  }, []);

  const value = useMemo<RadioContextValue>(() => ({
    rol, conectado, codigo, nombre, participantes, error,
    salas, descubriendo,
    vueltas, mejor, tandaIniciada,
    crearSala, unirse, salir, buscarSalas, detenerBusqueda,
    pulsarVuelta, deshacerVuelta, terminarTanda,
    onMensaje,
  }), [
    rol, conectado, codigo, nombre, participantes, error,
    salas, descubriendo, vueltas, mejor, tandaIniciada,
    crearSala, unirse, salir, buscarSalas, detenerBusqueda,
    pulsarVuelta, deshacerVuelta, terminarTanda, onMensaje,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useRadio debe usarse dentro de RadioProvider');
  return ctx;
}
