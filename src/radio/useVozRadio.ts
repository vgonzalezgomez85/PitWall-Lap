// Ciclo de vida de los pares WebRTC de voz según el rol (Fase 2). Sobre la
// señalización ya enrutada por `RadioContext` (onSenalizacion/enviarSenalizacion),
// gestiona:
//
//   • Hub (quien creó la sala, D6): un peer respondedor por participante, con su
//     micro compartido entre todos. Su papel solo cambia el modo de micro
//     (walkie PTT, micro abierto o silencio), nunca la topología.
//   • Piloto/asistente remotos: un peer oferente hacia el hub. Piloto con el
//     micro abierto; asistente remoto con walkie (PTT); seguidor solo escucha.
//
// La topología (respondedor vs oferente) depende de si somos el hub; el micro
// depende de si el rol necesita enviar voz. Se separan en dos efectos para que
// cambiar de rol en el hub no tumbe los peers. Devuelve los flujos remotos (para
// montar el `RTCView` que los reproduce), el nivel de audio (medidor) y el
// control PTT. No re-encodifica: el reenvío piloto→seguidor se aplaza.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaStream } from 'react-native-webrtc';

import type { MensajeSenalizacion, Rol } from './mensajes';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { activarAudioVoz, restaurarAudio } from './audioSesion';
import { crearPar, obtenerMicro, soltarMicro, type ParVoz } from './voz';
import { crearPuertaVoz, UMBRAL_PUERTA, type SensibilidadPuerta } from './vozPura';
import { estaLocutando, onLocucion } from '../voice/locucion';
import {
  diagnosticoAudio, fijarAltavoz as fijarAltavozNativo, onRuta, rutaSalida, type RutaSalida,
} from '../../modules/backgroundtts';
import { decidirSalida, type DecisionSalida } from './salidaAudio';

export interface EstadoVozRadio {
  /** Flujos de audio remotos a reproducir (RTCView). */
  pistas: MediaStream[];
  /** Nivel de audio actual (0..1), máximo de todos los pares. */
  nivel: number;
  /** ¿Está enviando el micro ahora? (micro abierto en piloto; PTT en asistente). */
  hablando: boolean;
  /** Asistente: pulsar-para-hablar. En el resto de roles solo activa/desactiva. */
  fijarMicro(activo: boolean): void;
  /** ¿Micro obtenido y al menos un peer levantado? */
  listo: boolean;
  /** Nivel del micro propio (0..1), para calibrar la puerta de voz. */
  nivelMicro: number;
  /** Sensibilidad de la puerta de voz del micro abierto (se guarda). */
  puerta: SensibilidadPuerta;
  fijarPuerta(s: SensibilidadPuerta): void;
  /** Micro abierto: ¿está transmitiendo ahora mismo? (puerta abierta y sin
   *  locución sonando). En walkie siempre coincide con `hablando`. */
  transmitiendo: boolean;
  /** Asistente: walkie (pulsar para hablar) o micro abierto (se guarda). */
  modoAsistente: ModoMicroAsistente;
  fijarModoAsistente(m: ModoMicroAsistente): void;
  /** Por dónde sale ahora el sonido (cascos, auricular, altavoz). */
  ruta: RutaSalida;
  /** Qué toca según el papel: altavoz, aviso de cascos, semidúplex… */
  salida: DecisionSalida;
  /** Preferencia de altavoz del papel actual (se guarda por papel). */
  fijarAltavoz(activo: boolean): void;
  /** Rehace micro y conexiones de voz (también se pide a los demás). */
  reiniciarVoz(): void;
  /** Diagnóstico de voz en pantalla (sesión de audio + WebRTC). */
  verDiagnostico: boolean;
  fijarVerDiagnostico(v: boolean): void;
  diagnostico: string;
}

/** Cómo habla el asistente: walkie o micro abierto, como el piloto. */
export type ModoMicroAsistente = 'walkie' | 'abierto';

const CLAVE_MODO_ASISTENTE = 'radio.modoAsistente';
const CLAVE_ALTAVOZ = 'radio.altavozPorRol';

const CLAVE_PUERTA = 'radio.puertaVoz';
/** Cada cuánto se evalúa la puerta de voz (ms). Corto para no comerse el
 *  arranque de las frases. */
const MUESTREO_PUERTA_MS = 80;

/** Configuración que `RadioContext` entrega al motor de voz. */
export interface ConfigVozRadio {
  rol: Rol | null;
  tuId: string;
  esHub: boolean;
  onSenalizacion: (cb: (de: string, sig: MensajeSenalizacion) => void) => () => void;
  enviarSenalizacion: (sig: MensajeSenalizacion) => void;
  enviarSenalizacionA: (destinoId: string, sig: MensajeSenalizacion) => void;
}

/** Cuántas veces por segundo se refresca el medidor de nivel. */
const MUESTREO_MS = 400;

/**
 * Motor de voz parametrizado. Vive en el `RadioProvider` (no en las pantallas)
 * para que la voz siga viva al salir hacia atrás de la sala; las pantallas leen
 * el resultado vía contexto.
 */
export function useVozRadioMotor(config: ConfigVozRadio): EstadoVozRadio {
  const { rol, tuId, esHub, onSenalizacion, enviarSenalizacion, enviarSenalizacionA } = config;

  const [pistas, setPistas] = useState<MediaStream[]>([]);
  const [nivel, setNivel] = useState(0);
  const [hablando, setHablando] = useState(false);
  const [listo, setListo] = useState(false);

  const microRef = useRef<MediaStream | null>(null);
  const paresRef = useRef<Map<string, ParVoz>>(new Map());
  /** Hub: ids de los participantes con voz. No se borra al reiniciar, para
   *  poder pedirles que renegocien (`renegociar`). */
  const idsConVozRef = useRef<Set<string>>(new Set());
  /** Sube para reiniciar la voz (botón, cascos conectados/desconectados o
   *  petición del asistente): fuerza micro y conexiones nuevos. */
  const [reinicio, setReinicio] = useState(0);
  const reiniciarVoz = useCallback(() => setReinicio(r => r + 1), []);
  const hablandoRef = useRef(false);
  const rolRef = useRef(rol);
  rolRef.current = rol;

  const [modoAsistente, setModoAsistente] = useState<ModoMicroAsistente>('walkie');
  const modoAsistenteRef = useRef(modoAsistente);
  modoAsistenteRef.current = modoAsistente;

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_MODO_ASISTENTE).then(v => {
      if (v === 'walkie' || v === 'abierto') setModoAsistente(v);
    }).catch(() => { /* ignore */ });
  }, []);

  const fijarModoAsistente = useCallback((m: ModoMicroAsistente) => {
    setModoAsistente(m);
    AsyncStorage.setItem(CLAVE_MODO_ASISTENTE, m).catch(() => { /* ignore */ });
  }, []);

  // El hub siempre tiene micro (compartido); el remoto lo necesita salvo que sea
  // seguidor (solo escucha).
  const necesitaMicro = esHub || (rol != null && rol !== 'seguidor');

  const cerrarTodo = useCallback(() => {
    for (const par of paresRef.current.values()) par.cerrar();
    paresRef.current.clear();
    soltarMicro(microRef.current);
    microRef.current = null;
    setPistas([]);
    setListo(false);
    setNivel(0);
  }, []);

  /** Aplica el modo de micro del rol actual (micro abierto solo en piloto). */
  const aplicarModoMicro = useCallback(() => {
    const r = rolRef.current;
    const activo = r === 'piloto' || (r === 'asistente' && modoAsistenteRef.current === 'abierto');
    const pista = microRef.current?.getAudioTracks()[0];
    if (pista) pista.enabled = activo;
    hablandoRef.current = activo;
    setHablando(activo);
  }, []);

  // ── Topología: arranca al entrar en sala y si cambia quiénes somos ──
  useEffect(() => {
    if (!tuId) {
      idsConVozRef.current.clear();
      return;
    }
    cerrarTodo();
    void activarAudioVoz();

    let desechado = false;
    // Un flujo remoto por participante: al rehacer su conexión, el nuevo
    // sustituye al viejo (antes se acumulaban flujos muertos).
    const flujosRemotos = new Map<string, MediaStream>();
    // Señales (oferta y sus candidatos) que llegan al hub antes de tener el
    // micro listo: se guardan en orden y se procesan al obtenerlo. Antes solo
    // se guardaban las ofertas y los candidatos de esa ráfaga se perdían.
    const senalesPendientes: { de: string; sig: MensajeSenalizacion }[] = [];

    const publicarPistas = () => {
      if (!desechado) setPistas([...flujosRemotos.values()]);
    };

    const hacerPar = (id: string, micro: MediaStream | null, modo: 'oferente' | 'respondedor') => {
      const par = crearPar({
        modo,
        micro,
        cb: {
          onSdp(sdp) {
            const sig: MensajeSenalizacion =
              modo === 'oferente'
                ? { tipo: 'oferta', de: tuId || id, sdp }
                : { tipo: 'respuesta', de: 'asistente', sdp };
            if (esHub) enviarSenalizacionA(id, sig);
            else enviarSenalizacion(sig);
          },
          onCandidato(candidate) {
            const sig: MensajeSenalizacion = {
              tipo: 'candidato', de: esHub ? 'asistente' : tuId, candidate,
            };
            if (esHub) enviarSenalizacionA(id, sig);
            else enviarSenalizacion(sig);
          },
          onPistaRemota(flujo) {
            flujosRemotos.set(id, flujo);
            publicarPistas();
          },
          onEstado(estado) {
            if (estado === 'connected') setListo(true);
            else if (estado === 'failed' || estado === 'closed') setListo(false);
          },
        },
      });
      paresRef.current.set(id, par);
      if (esHub) idsConVozRef.current.add(id);
      return par;
    };

    /** Hub: una oferta nueva de alguien que ya tenía conexión es que reinició
     *  su voz: se descarta la conexión vieja (reusarla no se recuperaba). */
    const parParaSenal = (de: string, sig: MensajeSenalizacion): ParVoz | undefined => {
      const existente = paresRef.current.get(de);
      if (sig.tipo !== 'oferta') return existente;
      if (existente) {
        existente.cerrar();
        paresRef.current.delete(de);
        flujosRemotos.delete(de);
        publicarPistas();
      }
      return hacerPar(de, microRef.current, 'respondedor');
    };

    // Suscripción a la señalización entrante (se cancela al desmontar).
    const offSenal = onSenalizacion((de, sig) => {
      if (esHub) {
        // Sin micro todavía (o con señales anteriores en espera): a la cola,
        // para no adelantar un candidato a su oferta.
        if (!microRef.current || senalesPendientes.length > 0) {
          senalesPendientes.push({ de, sig });
          return;
        }
        void parParaSenal(de, sig)?.recibir(sig);
      } else if (de === 'asistente') {
        if (sig.tipo === 'renegociar') {
          reiniciarVoz();
          return;
        }
        const par = [...paresRef.current.values()][0];
        void par?.recibir(sig);
      }
    });

    // Arranque según la topología (hub respondedor / remoto oferente).
    (async () => {
      try {
        if (esHub) {
          // El hub adquiere el micro una vez y lo comparte entre peers.
          microRef.current = await obtenerMicro();
          // Procesa, en orden, lo que llegó mientras esperábamos el permiso.
          while (senalesPendientes.length > 0) {
            const { de, sig } = senalesPendientes.shift()!;
            await parParaSenal(de, sig)?.recibir(sig);
          }
          aplicarModoMicro();
          // Si es un reinicio, los participantes siguen atados a conexiones
          // que ya no existen: se les pide una oferta nueva.
          if (reinicio > 0) {
            for (const id of idsConVozRef.current) {
              if (!paresRef.current.has(id)) enviarSenalizacionA(id, { tipo: 'renegociar', de: 'asistente' });
            }
          }
        } else {
          const micro = necesitaMicro ? await obtenerMicro() : null;
          if (necesitaMicro) {
            microRef.current = micro;
          }
          const par = hacerPar('asistente', micro, 'oferente');
          await par.iniciar();
          if (necesitaMicro) aplicarModoMicro();
        }
      } catch {
        // Permiso de micro denegado o similar: la voz queda sin micro.
        if (!desechado) setListo(false);
      }
    })();

    // Medidor de nivel: máximo entre todos los pares (inbound-rtp audioLevel).
    const reloj = setInterval(() => {
      void (async () => {
        let max = 0;
        for (const par of paresRef.current.values()) {
          const n = await par.nivel();
          if (n > max) max = n;
        }
        if (!desechado) setNivel(max);
      })();
    }, MUESTREO_MS);

    return () => {
      desechado = true;
      offSenal();
      clearInterval(reloj);
      cerrarTodo();
      void restaurarAudio();
    };
  }, [
    tuId, esHub, necesitaMicro, onSenalizacion, enviarSenalizacion,
    enviarSenalizacionA, cerrarTodo, aplicarModoMicro, reinicio, reiniciarVoz,
  ]);

  // ── Modo de micro: cambia con el rol sin tumbar los peers ──
  useEffect(() => {
    if (!tuId) return;
    aplicarModoMicro();
  }, [rol, tuId, modoAsistente, aplicarModoMicro]);

  // ── Micro abierto: puerta de voz + silencio mientras locuta la app ──
  //
  // Solo con micro abierto (piloto, o asistente en modo abierto). En walkie
  // manda el botón.
  const [puerta, setPuerta] = useState<SensibilidadPuerta>('normal');
  const [nivelMicro, setNivelMicro] = useState(0);
  const [transmitiendo, setTransmitiendo] = useState(false);
  const puertaRef = useRef(crearPuertaVoz({ umbral: UMBRAL_PUERTA.normal }));

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_PUERTA).then(v => {
      if (v === 'apagada' || v === 'normal' || v === 'estricta') setPuerta(v);
    }).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    puertaRef.current.fijarUmbral(UMBRAL_PUERTA[puerta]);
  }, [puerta]);

  const fijarPuerta = useCallback((s: SensibilidadPuerta) => {
    setPuerta(s);
    AsyncStorage.setItem(CLAVE_PUERTA, s).catch(() => { /* ignore */ });
  }, []);

  const microAbierto = rol === 'piloto' || (rol === 'asistente' && modoAsistente === 'abierto');
  useEffect(() => {
    // Se silencia la PISTA (`enabled`), no se detiene el envío: WebRTC sigue
    // procesando el micro y midiendo su nivel antes de aplicar el silencio
    // (y con DTX, en silencio casi no se envía nada). Con `encodings.active =
    // false` el envío se paraba, el nivel dejaba de actualizarse y la puerta
    // no volvía a abrirse nunca (iPhone: «En espera» aunque se hablara).
    const aplicarEnvio = (activo: boolean) => {
      const pista = microRef.current?.getAudioTracks()[0];
      if (pista && pista.enabled !== activo) pista.enabled = activo;
      setTransmitiendo(prev => (prev === activo ? prev : activo));
    };
    if (!tuId || !microAbierto) {
      // Walkie u otros roles: manda el botón (`aplicarModoMicro`/`fijarMicro`).
      setTransmitiendo(false);
      setNivelMicro(0);
      return;
    }
    // Seguro: si el nivel no cambia nada en este tiempo, la medida está
    // congelada y se deja la puerta abierta antes que dejar al piloto mudo.
    const CONGELADO_MS = 3000;
    let ultimoNivel = -1;
    let desdeCambio = Date.now();
    let vivo = true;
    let locutando = estaLocutando();
    const offLocucion = onLocucion(v => {
      locutando = v;
      if (v) aplicarEnvio(false); // corte inmediato al empezar la locución
    });
    const reloj = setInterval(() => {
      void (async () => {
        let n: number | null = null;
        for (const par of paresRef.current.values()) {
          const v = await par.nivelLocal();
          if (v != null) n = Math.max(n ?? 0, v);
        }
        if (!vivo) return;
        // Sin medida del micro (plataforma o peer aún sin stats): no se cierra
        // la puerta, solo se silencia durante la locución.
        const ahora = Date.now();
        if (n != null && Math.abs(n - ultimoNivel) > 0.0005) {
          ultimoNivel = n;
          desdeCambio = ahora;
        }
        const congelado = n != null && ahora - desdeCambio >= CONGELADO_MS;
        const abierta = n == null || congelado ? true : puertaRef.current.actualizar(n, ahora);
        n = n ?? 0;
        aplicarEnvio(abierta && !locutando);
        setNivelMicro(prev => (Math.abs(prev - n) < 0.01 ? prev : n));
      })();
    }, MUESTREO_PUERTA_MS);
    return () => {
      vivo = false;
      offLocucion();
      clearInterval(reloj);
    };
  }, [tuId, microAbierto]);

  // ── Salida del sonido (fase B: evitar acoples) ──
  const [ruta, setRuta] = useState<RutaSalida>('');
  const [altavozPorRol, setAltavozPorRol] = useState<Partial<Record<Rol, boolean>>>({});

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_ALTAVOZ).then(v => {
      if (v) setAltavozPorRol(JSON.parse(v) as Partial<Record<Rol, boolean>>);
    }).catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    if (!tuId) return;
    setRuta(rutaSalida());
    // Cascos conectados o desconectados con la voz en marcha: el audio de
    // WebRTC no siempre se recupera solo (iPhone), así que se reinicia la voz.
    // Se ignoran los avisos del arranque (Android avisa de todo al suscribirse)
    // y se agrupan los que llegan seguidos.
    const inicio = Date.now();
    let espera: ReturnType<typeof setTimeout> | null = null;
    const off = onRuta((r, dispositivo) => {
      setRuta(r);
      if (!dispositivo || Date.now() - inicio < 2000) return;
      if (espera) clearTimeout(espera);
      espera = setTimeout(reiniciarVoz, 800);
    });
    return () => {
      off();
      if (espera) clearTimeout(espera);
    };
  }, [tuId, reiniciarVoz]);

  const salida = decidirSalida({
    rol,
    modoAsistente,
    cascos: ruta === 'cascos',
    altavozPedido: rol ? altavozPorRol[rol] ?? null : null,
  });
  const salidaRef = useRef(salida);
  salidaRef.current = salida;

  useEffect(() => {
    if (!tuId) return;
    fijarAltavozNativo(salida.altavoz);
    // Tras cambiar de altavoz/auricular, la ruta real puede tardar un poco.
    const t = setTimeout(() => setRuta(rutaSalida()), 300);
    return () => clearTimeout(t);
  }, [tuId, salida.altavoz]);

  const fijarAltavoz = useCallback((activo: boolean) => {
    if (!rolRef.current) return;
    const r = rolRef.current;
    setAltavozPorRol(prev => {
      const nuevo = { ...prev, [r]: activo };
      AsyncStorage.setItem(CLAVE_ALTAVOZ, JSON.stringify(nuevo)).catch(() => { /* ignore */ });
      return nuevo;
    });
  }, []);

  // ── Diagnóstico en pantalla (solo mientras está abierto) ──
  const [verDiagnostico, setVerDiagnostico] = useState(false);
  const [diagnostico, setDiagnostico] = useState('');
  useEffect(() => {
    if (!verDiagnostico || !tuId) return;
    let vivo = true;
    const tomar = async () => {
      const lineas = [`audio: ${diagnosticoAudio()}`];
      for (const [id, par] of paresRef.current) lineas.push(`${id}: ${await par.diagnostico()}`);
      if (paresRef.current.size === 0) lineas.push('sin conexiones de voz');
      lineas.push(`reinicios=${reinicio} listo=${listo}`);
      if (vivo) setDiagnostico(lineas.join('\n'));
    };
    void tomar();
    const reloj = setInterval(() => { void tomar(); }, 1000);
    return () => { vivo = false; clearInterval(reloj); };
  }, [verDiagnostico, tuId, reinicio, listo]);

  const pistasRef = useRef<MediaStream[]>([]);
  pistasRef.current = pistas;

  // Si deja de haber semidúplex (cascos conectados, otro papel…), el audio
  // entrante no puede quedarse silenciado.
  useEffect(() => {
    if (salida.semiduplex) return;
    for (const flujo of pistas) {
      for (const p of flujo.getAudioTracks()) if (!p.enabled) p.enabled = true;
    }
  }, [salida.semiduplex, pistas]);

  const fijarMicro = useCallback((activo: boolean) => {
    // Semidúplex: walkie con altavoz y sin cascos. Mientras se habla se
    // silencia lo que llega, o el micro captaría el altavoz (acople).
    if (salidaRef.current.semiduplex) {
      for (const flujo of pistasRef.current) {
        for (const p of flujo.getAudioTracks()) p.enabled = !activo;
      }
    }
    hablandoRef.current = activo;
    setHablando(activo);
    // El micro es compartido entre todos los peers: mutea/desmutea la pista
    // local una sola vez (afecta a todos a la vez).
    const pista = microRef.current?.getAudioTracks()[0];
    if (pista) pista.enabled = activo;
  }, []);

  return {
    pistas, nivel, hablando, fijarMicro, listo,
    nivelMicro, puerta, fijarPuerta,
    transmitiendo: microAbierto ? transmitiendo : hablando,
    modoAsistente, fijarModoAsistente,
    ruta, salida, fijarAltavoz,
    reiniciarVoz, verDiagnostico, fijarVerDiagnostico: setVerDiagnostico, diagnostico,
  };
}
