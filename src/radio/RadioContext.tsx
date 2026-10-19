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

import * as Network from 'expo-network';

import { emitirMensajeRadio } from './bus';
import { generarCodigo } from './codigo';
import { crearCronometro, type Vuelta } from './cronometro';
import type { MensajeRadio, MensajeSenalizacion, MotivoRechazo, Participante, Rol, ClaveAviso } from './mensajes';
import { crearClienteRadio, crearServidorRadio, type ResultadoUnionCliente } from './protocolo';
import { buscarSalas as buscarSalasEnRed, publicarSala, type SalaDescubierta, type DiagnosticoBusqueda, type EstadoAnuncio, type ModoSala } from './red';
import { ID_ASISTENTE } from './sala';
import type { TransporteRadio } from './transporte';
import { crearTransporteRelay, obtenerServidoresIce } from './transporteRelay';
import { fijarServidoresIce } from './voz';
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
  /** Detalle técnico del último fallo al unirse (host y causa), para depurar. */
  diagnostico: string | null;

  // Descubrimiento (participante).
  salas: SalaDescubierta[];
  descubriendo: boolean;
  /** Se perdió la conexión con la sala y se está reintentando entrar. */
  reconectando: boolean;
  /** Cómo está montada la sala: WiFi compartida o por internet (relé). */
  modoSala: ModoSala;
  /** Lo que va oyendo la búsqueda de salas (diagnóstico a distancia). */
  diagBusqueda: DiagnosticoBusqueda | null;
  /** Hub: ¿quedó la sala anunciada en la red? `null` mientras se publica. */
  anuncio: EstadoAnuncio;

  // Cronómetro (solo el hub lo ejecuta; el resto lo recibe por la red).
  vueltas: Vuelta[];
  mejor: Vuelta | null;
  tandaIniciada: boolean;

  // Voz (vive en el proveedor para que sobreviva a salir hacia atrás).
  voz: EstadoVozRadio;

  // Acciones.
  crearSala: (nombre: string, modo?: ModoSala) => Promise<void>;
  unirse: (sala: SalaDescubierta, rol: Rol, nombre: string) => Promise<MotivoRechazo | 'entradaFallida' | null>;
  salir: () => void;
  buscarSalas: () => void;
  detenerBusqueda: () => void;

  // Cambio de rol en vivo (máx. 1 piloto + 1 asistente). Funciona igual en el
  // hub y en los remotos.
  cambiarRol: (rol: Rol) => void;

  // Cronómetro manual (el hub lo ejecuta; el asistente remoto manda el comando).
  pulsarVuelta: () => void;
  /** Asistente: mensaje rápido que todos locutan (Box, Push…). */
  enviarAviso: (clave: ClaveAviso) => void;
  /** Asistente: vuelta objetivo en ms (null la quita). */
  fijarObjetivo: (ms: number | null) => void;
  /** Vuelta objetivo vigente en la sala (ms) o null. */
  objetivoMs: number | null;
  deshacerVuelta: () => void;
  terminarTanda: () => void;

  /** Suscripción a los mensajes de datos entrantes (para las pantallas). */
  onMensaje: (cb: (m: MensajeRadio) => void) => () => void;

  // Señalización WebRTC (voz, Fase 2).
  /** Nuestro id en la sala: `asistente` en el hub, `p1`/`p2`… en el resto. */
  tuId: string;
  /** Recibe la señalización entrante. `de` es el id del emisor. */
  onSenalizacion: (cb: (de: string, sig: MensajeSenalizacion) => void) => () => void;
  /** Envía señalización de voz a un participante concreto. Desde el hub va
   *  directa; desde un participante va al hub con `para` y el hub la reenvía. */
  enviarSenalizacionPara: (para: string, sig: MensajeSenalizacion) => void;
}

/** Transporte de la sala según el modo: TCP local o relé por internet. */
function crearTransporte(modo: ModoSala, codigo: string): TransporteRadio {
  return modo === 'internet' ? crearTransporteRelay(codigo) : crearTransporteTcp();
}

/** Servidores ICE de la voz: por internet, los del relé (con TURN); en local,
 *  STUN y conexión directa. */
async function prepararVoz(modo: ModoSala): Promise<void> {
  fijarServidoresIce(modo === 'internet' ? await obtenerServidoresIce() : null);
}

/** Esperas entre reintentos de reconexión (≈ 1 min en total). */
const ESPERAS_RECONEXION_MS = [1000, 2000, 3000, 5000, 8000, 12000, 15000, 15000];

const Context = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diagnostico, setDiagnostico] = useState<string | null>(null);

  const [salas, setSalas] = useState<SalaDescubierta[]>([]);
  const [descubriendo, setDescubriendo] = useState(false);

  const [vueltas, setVueltas] = useState<Vuelta[]>([]);
  const [tandaIniciada, setTandaIniciada] = useState(false);
  const [tuId, setTuId] = useState('');
  const [diagBusqueda, setDiagBusqueda] = useState<DiagnosticoBusqueda | null>(null);
  const [anuncio, setAnuncio] = useState<EstadoAnuncio>(null);

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
  const rolActualRef = useRef<Rol | null>(rol);
  if (rol) rolActualRef.current = rol;

  // ── Reconexión automática ──
  /** Última sala a la que nos unimos, para volver a entrar si se cae. */
  const ultimaUnionRef = useRef<{ sala: SalaDescubierta; nombre: string } | null>(null);
  /** Reconexión en curso (para poder cancelarla al salir). */
  const reconexionRef = useRef<{ cancelada: boolean } | null>(null);
  const [reconectando, setReconectando] = useState(false);
  const [objetivoMs, setObjetivoMs] = useState<number | null>(null);
  const [modoSala, setModoSala] = useState<ModoSala>('local');
  const reconectarRef = useRef<() => void>(() => {});
  const esHub = tuId === ID_ASISTENTE;

  /** Cierra todo lo abierto y deja el estado como al empezar (sin error). */
  const limpiar = useCallback(() => {
    if (reconexionRef.current) reconexionRef.current.cancelada = true;
    reconexionRef.current = null;
    setReconectando(false);
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
    setDiagnostico(null);
    setObjetivoMs(null);
    setModoSala('local');
    fijarServidoresIce(null);
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
      case 'objetivo':
        setObjetivoMs(m.ms);
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

  // El servidor/cliente se suscriben UNA vez (al crear o unirse), pero
  // `alMensaje` cambia con `esHub`, `tandaIniciada`… Se suscribe este puente
  // estable, que llama siempre a la versión actual. Antes se registraba
  // `alMensaje` directamente y quedaba congelado con `esHub = false` (se crea
  // antes de `setTuId`): el hub ignoraba los pulsos del asistente remoto.
  const alMensajeRef = useRef(alMensaje);
  alMensajeRef.current = alMensaje;
  const alMensajeActual = useCallback((m: MensajeRadio) => alMensajeRef.current(m), []);

  const onMensaje = useCallback((cb: (m: MensajeRadio) => void) => {
    oyentesRef.current.add(cb);
    return () => { oyentesRef.current.delete(cb); };
  }, []);

  const onSenalizacion = useCallback((cb: (de: string, sig: MensajeSenalizacion) => void) => {
    oyentesSenalizacionRef.current.add(cb);
    return () => { oyentesSenalizacionRef.current.delete(cb); };
  }, []);

  const enviarSenalizacionPara = useCallback((para: string, sig: MensajeSenalizacion) => {
    if (servidorRef.current) {
      // Somos el hub: unicast directo al participante.
      servidorRef.current.enviarSenalizacion(para, sig);
    } else {
      // Participante: al hub, que la reenvía a `para` (o la consume si es él).
      // Solo la señalización de voz lleva destinatario.
      if (sig.tipo === 'oferta' || sig.tipo === 'respuesta' || sig.tipo === 'candidato' || sig.tipo === 'renegociar') {
        clienteRef.current?.enviarSenalizacion({ ...sig, para });
      }
    }
  }, []);

  const crearSala = useCallback(async (nombreHub: string, modo: ModoSala = 'local') => {
    limpiar();
    const codigoNuevo = generarCodigo();
    const transporte = crearTransporte(modo, codigoNuevo);
    await prepararVoz(modo);
    const servidor = crearServidorRadio();
    // `iniciar` registra el hub como participante (rol asistente inicial) y
    // notifica a `setParticipantes` con la lista ya completa.
    try {
      await servidor.iniciar(transporte, codigoNuevo, { nombre: nombreHub }, lista => setParticipantes(lista));
    } catch (e) {
      // No se pudo abrir el servidor TCP (puerto ocupado, permiso de red…):
      // liberamos lo abierto y dejamos que la UI muestre el error.
      try { servidor.cerrar(); } catch { /* ignore */ }
      throw e;
    }
    transporteRef.current = transporte;
    servidorRef.current = servidor;
    setModoSala(modo);
    if (modo === 'local') {
      setAnuncio(null);
      anuncioRef.current = publicarSala(codigoNuevo, setAnuncio);
    } else {
      // Por internet no hay anuncio en la red: se entra con el código.
      setAnuncio({ ok: true });
    }
    offDatosRef.current = servidor.onMensaje(alMensajeActual);
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
  }, [limpiar, alMensajeActual]);

  /** Deja enganchado un cliente ya aceptado por el hub (unirse o reconexión). */
  const enlazarCliente = useCallback((
    cliente: ReturnType<typeof crearClienteRadio>,
    transporte: TransporteRadio,
    resultado: ResultadoUnionCliente,
  ) => {
    transporteRef.current = transporte;
    clienteRef.current = cliente;
    offDatosRef.current = cliente.onMensaje(alMensajeActual);
    cliente.onSenalizacion((sig) => {
      // `de` lo pone el hub: es él (`asistente`) o el participante que la envió.
      const de = 'de' in sig && typeof sig.de === 'string' ? sig.de : ID_ASISTENTE;
      for (const cb of [...oyentesSenalizacionRef.current]) cb(de, sig);
    });
    offCierreRef.current = cliente.onCerrar(() => reconectarRef.current());
    setParticipantes(resultado.lista);
    setTuId(resultado.tuId);
  }, [alMensajeActual]);

  const unirse = useCallback(async (
    sala: SalaDescubierta,
    rolParticipante: Rol,
    nombreParticipante: string,
  ) => {
    limpiar();
    const modo = sala.modo ?? 'local';
    const transporte = crearTransporte(modo, sala.codigo);
    await prepararVoz(modo);
    const cliente = crearClienteRadio();
    let resultado: ResultadoUnionCliente;
    try {
      resultado = await cliente.unirse(transporte, sala.host, sala.puerto, {
        nombre: nombreParticipante,
        rol: rolParticipante,
        codigo: sala.codigo,
      });
    } catch (e) {
      // Conexión fallida o timeout: no hay sala a la que entrar. Guardamos el
      // detalle (host al que íbamos y la causa) para poder depurar a distancia.
      try { transporte.cerrar(); } catch { /* ignore */ }
      setError('entradaFallida');
      let miIp = '';
      try { miIp = await Network.getIpAddressAsync(); } catch { /* ignore */ }
      setDiagnostico(
        modo === 'internet'
          ? `por internet · sala ${sala.codigo} · ${e instanceof Error ? e.message : String(e)}`
          : `destino ${sala.host}:${sala.puerto} · mi IP ${miIp || '?'} · ${e instanceof Error ? e.message : String(e)}`,
      );
      return 'entradaFallida';
    }
    if (!resultado.ok) {
      try { transporte.cerrar(); } catch { /* ignore */ }
      setError(resultado.motivo ?? 'codigo');
      return resultado.motivo ?? null;
    }
    enlazarCliente(cliente, transporte, resultado);
    ultimaUnionRef.current = { sala, nombre: nombreParticipante };
    setModoSala(modo);
    setNombre(nombreParticipante);
    setCodigo(sala.codigo);
    setError(null);
    setConectado(true);
    return null;
  }, [limpiar, enlazarCliente]);

  // Se perdió la conexión con el hub (WiFi caída un momento, móvil del
  // asistente que se bloqueó…): en vez de sacarnos de la sala, se reintenta
  // entrar con el mismo nombre y papel. El hub reconoce que somos los mismos
  // (`participanteObsoleto`) y nos devuelve el papel. Si tras ~1 min no hay
  // forma, se sale con «Se perdió la conexión».
  reconectarRef.current = () => {
    const union = ultimaUnionRef.current;
    if (!union) {
      limpiar();
      setError('sinConexion');
      return;
    }
    try { offDatosRef.current?.(); } catch { /* ignore */ }
    try { offCierreRef.current?.(); } catch { /* ignore */ }
    offDatosRef.current = null;
    offCierreRef.current = null;
    try { transporteRef.current?.cerrar(); } catch { /* ignore */ }
    clienteRef.current = null;
    transporteRef.current = null;
    const rolDeseado = rolActualRef.current ?? 'seguidor';
    setTuId(''); // apaga la voz; vuelve con el id nuevo
    setReconectando(true);
    const estado = { cancelada: false };
    reconexionRef.current = estado;

    void (async () => {
      for (const espera of ESPERAS_RECONEXION_MS) {
        await new Promise(r => setTimeout(r, espera));
        if (estado.cancelada) return;
        const modo = union.sala.modo ?? 'local';
        // Por internet, credenciales TURN nuevas (caducan a las pocas horas).
        await prepararVoz(modo);
        const transporte = crearTransporte(modo, union.sala.codigo);
        const cliente = crearClienteRadio();
        try {
          const r = await cliente.unirse(transporte, union.sala.host, union.sala.puerto, {
            nombre: union.nombre, rol: rolDeseado, codigo: union.sala.codigo,
          });
          if (estado.cancelada) {
            try { transporte.cerrar(); } catch { /* ignore */ }
            return;
          }
          if (r.ok) {
            enlazarCliente(cliente, transporte, r);
            reconexionRef.current = null;
            setReconectando(false);
            return;
          }
          try { transporte.cerrar(); } catch { /* ignore */ }
        } catch {
          try { transporte.cerrar(); } catch { /* ignore */ }
        }
      }
      if (estado.cancelada) return;
      reconexionRef.current = null;
      limpiar();
      setError('sinConexion');
    })();
  };

  const salir = useCallback(() => {
    ultimaUnionRef.current = null;
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

  /** Asistente → todos: el hub lo difunde; un asistente remoto lo manda al
   *  hub, que lo reenvía a todos (incluido él). */
  const enviarDatoAsistente = useCallback((m: MensajeRadio) => {
    if (esHub) difundir(m);
    else clienteRef.current?.enviar(m);
  }, [esHub, difundir]);

  const enviarAviso = useCallback((clave: ClaveAviso) => {
    enviarDatoAsistente({ tipo: 'aviso', clave });
  }, [enviarDatoAsistente]);

  const fijarObjetivo = useCallback((ms: number | null) => {
    setObjetivoMs(ms);
    enviarDatoAsistente({ tipo: 'objetivo', ms });
  }, [enviarDatoAsistente]);

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
    setDiagBusqueda({ oidos: 0, resueltos: 0, error: null });
    busquedaRef.current = buscarSalasEnRed(sala => {
      setSalas(prev => {
        if (prev.some(s => s.host === sala.host && s.codigo === sala.codigo)) return prev;
        return [...prev, sala];
      });
    }, setDiagBusqueda);
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
    rol, tuId, participantes, onSenalizacion, enviarSenalizacionPara, enSala: conectado,
  });

  // Al desmontar (cierre de la app, recarga), liberamos la red.
  const limpiarRef = useRef(limpiar);
  limpiarRef.current = limpiar;
  useEffect(() => {
    return () => limpiarRef.current();
  }, []);

  const value = useMemo<RadioContextValue>(() => ({
    rol, esHub, conectado, codigo, nombre, participantes, error, diagnostico,
    salas, descubriendo, diagBusqueda, anuncio, reconectando, modoSala,
    vueltas, mejor, tandaIniciada,
    voz,
    crearSala, unirse, salir, buscarSalas, detenerBusqueda,
    cambiarRol,
    pulsarVuelta, deshacerVuelta, terminarTanda, enviarAviso, fijarObjetivo, objetivoMs,
    onMensaje,
    tuId, onSenalizacion, enviarSenalizacionPara,
  }), [
    rol, esHub, conectado, codigo, nombre, participantes, error, diagnostico,
    salas, descubriendo, diagBusqueda, anuncio, reconectando, modoSala, vueltas, mejor, tandaIniciada,
    voz,
    crearSala, unirse, salir, buscarSalas, detenerBusqueda,
    cambiarRol,
    pulsarVuelta, deshacerVuelta, terminarTanda, enviarAviso, fijarObjetivo, objetivoMs, onMensaje,
    tuId, onSenalizacion, enviarSenalizacionPara,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useRadio debe usarse dentro de RadioProvider');
  return ctx;
}
