// Motor de voz de Radio. Sobre la señalización que enruta `RadioContext`
// gestiona la voz en MALLA (ver malla.ts): cada pareja de participantes tiene
// su propia conexión WebRTC si al menos uno habla (piloto o asistente), así
// que cualquiera con micro llega a todos, esté en el móvil que esté. El hub
// (quien creó la sala) solo reenvía la señalización.
//
// Además: modo del micro según el papel (walkie, micro abierto con puerta de
// voz, silencio durante la locución), salida del sonido, calidad, reinicio y
// diagnóstico. Devuelve los flujos remotos para montar el `RTCView` que los
// reproduce.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaStream } from 'react-native-webrtc';

import type { MensajeSenalizacion, Participante, Rol } from './mensajes';
import { firmaPar, planificarMalla, soyOferente, tieneMicro } from './malla';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { activarAudioVoz, restaurarAudio } from './audioSesion';
import { crearPar, obtenerMicro, soltarMicro, type ParVoz } from './voz';
import {
  crearPuertaVoz, peorCalidad, UMBRAL_PUERTA, type CalidadConexion, type SensibilidadPuerta,
} from './vozPura';
import { estaLocutando, onLocucion } from '../voice/locucion';
import {
  diagnosticoAudio, fijarAltavoz as fijarAltavozNativo, fijarModoVoz, onRuta, rutaSalida, type RutaSalida,
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
  /** Calidad de la peor conexión de voz; null sin datos. */
  calidad: CalidadConexion | null;
  /** No se pudo abrir el micrófono (permiso denegado o en uso). */
  errorMicro: boolean;
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
/** Volumen de la voz entrante mientras suena la locución (0..1). */
const VOLUMEN_DURANTE_LOCUCION = 0.25;
/** Cada cuánto se evalúa la puerta de voz (ms). Corto para no comerse el
 *  arranque de las frases. */
const MUESTREO_PUERTA_MS = 80;

/** Configuración que `RadioContext` entrega al motor de voz. */
export interface ConfigVozRadio {
  rol: Rol | null;
  tuId: string;
  /** Quién hay en la sala: de aquí sale con quién hay que tener conexión. */
  participantes: Participante[];
  /** Señalización entrante: `de` es el id del emisor. */
  onSenalizacion: (cb: (de: string, sig: MensajeSenalizacion) => void) => () => void;
  /** Envía señalización a un participante concreto (el hub la reenvía). */
  enviarSenalizacionPara: (para: string, sig: MensajeSenalizacion) => void;
  /** Estamos en una sala (también mientras se reconecta, cuando `tuId` está
   *  vacío un momento). Marca cuándo activar y restaurar el audio de Radio. */
  enSala: boolean;
}

/** Cuántas veces por segundo se refresca el medidor de nivel. */
const MUESTREO_MS = 400;

/**
 * Motor de voz parametrizado. Vive en el `RadioProvider` (no en las pantallas)
 * para que la voz siga viva al salir hacia atrás de la sala; las pantallas leen
 * el resultado vía contexto.
 */
export function useVozRadioMotor(config: ConfigVozRadio): EstadoVozRadio {
  const { rol, tuId, participantes, onSenalizacion, enviarSenalizacionPara, enSala } = config;

  const [pistas, setPistas] = useState<MediaStream[]>([]);
  const [nivel, setNivel] = useState(0);
  const [hablando, setHablando] = useState(false);
  const [listo, setListo] = useState(false);
  const [calidad, setCalidad] = useState<CalidadConexion | null>(null);
  const [errorMicro, setErrorMicro] = useState(false);

  const microRef = useRef<MediaStream | null>(null);
  const paresRef = useRef<Map<string, ParVoz>>(new Map());
  const participantesRef = useRef(participantes);
  participantesRef.current = participantes;
  /** Ajusta las conexiones a la lista de participantes (lo fija la sesión). */
  const reconciliarRef = useRef<() => void>(() => {});
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

  // Solo piloto y asistente abren el micro; el seguidor solo escucha.
  const conMicro = tieneMicro(rol);

  // El micro NO se suelta al rehacer las conexiones: iOS no deja volver a
  // abrirlo con la pantalla bloqueada, y cada reconexión o reinicio de la voz
  // lo pedía de nuevo (en segundo plano la voz ya no volvía). Se abre una vez
  // y se suelta solo al salir de la sala o al dejar de tener papel con micro.
  const cerrarTodo = useCallback(() => {
    for (const par of paresRef.current.values()) par.cerrar();
    paresRef.current.clear();
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

  // ── Audio de Radio: se activa al entrar en la sala y se restaura solo al
  //    salir. Antes se alternaba en cada reinicio de la voz, y con la pantalla
  //    bloqueada ese cambio dejaba el micro sin poder volver a abrirse. ──
  useEffect(() => {
    if (!enSala) return;
    void activarAudioVoz();
    return () => { void restaurarAudio(); };
  }, [enSala]);

  // El micro se suelta al salir de la sala o al dejar de tener papel con micro.
  useEffect(() => {
    if (enSala && conMicro) return;
    soltarMicro(microRef.current);
    microRef.current = null;
  }, [enSala, conMicro]);
  useEffect(() => () => {
    soltarMicro(microRef.current);
    microRef.current = null;
  }, []);

  // ── Sesión de voz en malla: arranca al entrar, al cambiar si tenemos micro
  //    y en cada reinicio ──
  useEffect(() => {
    if (!tuId) return;
    cerrarTodo();

    let desechado = false;
    // Hasta tener el micro (si nos toca) no se crea ninguna conexión: lo que
    // llega mientras tanto se guarda en orden.
    let microListo = !conMicro;
    const pendientes: { de: string; sig: MensajeSenalizacion }[] = [];
    // Un flujo remoto, una firma (quién envía audio) y un estado por participante.
    const flujosRemotos = new Map<string, MediaStream>();
    const firmas = new Map<string, string>();
    const estados = new Map<string, string>();

    const publicarPistas = () => {
      if (!desechado) setPistas([...flujosRemotos.values()]);
    };
    const publicarListo = () => {
      if (!desechado) setListo([...estados.values()].includes('connected'));
    };
    const rolDe = (id: string) => participantesRef.current.find(p => p.id === id)?.rol ?? null;

    const quitarPar = (id: string) => {
      paresRef.current.get(id)?.cerrar();
      paresRef.current.delete(id);
      firmas.delete(id);
      estados.delete(id);
      if (flujosRemotos.delete(id)) publicarPistas();
      publicarListo();
    };

    const hacerPar = (id: string, modo: 'oferente' | 'respondedor') => {
      const par = crearPar({
        modo,
        micro: microRef.current,
        cb: {
          onSdp(sdp) {
            enviarSenalizacionPara(id, modo === 'oferente'
              ? { tipo: 'oferta', de: tuId, sdp }
              : { tipo: 'respuesta', de: tuId, sdp });
          },
          onCandidato(candidate) {
            enviarSenalizacionPara(id, { tipo: 'candidato', de: tuId, candidate });
          },
          onPistaRemota(flujo) {
            flujosRemotos.set(id, flujo);
            publicarPistas();
          },
          onEstado(estado) {
            estados.set(id, estado);
            publicarListo();
          },
        },
      });
      paresRef.current.set(id, par);
      firmas.set(id, firmaPar(rolDe(tuId), rolDe(id)));
      return par;
    };

    /** Abre y cierra conexiones para que cuadren con la lista de la sala. */
    const reconciliar = () => {
      if (desechado || !microListo) return;
      const plan = planificarMalla(tuId, participantesRef.current, firmas);
      for (const id of plan.cerrar) quitarPar(id);
      for (const id of plan.ofrecer) void hacerPar(id, 'oferente').iniciar();
    };
    reconciliarRef.current = reconciliar;

    const procesar = (de: string, sig: MensajeSenalizacion) => {
      if (sig.tipo === 'renegociar') {
        // El otro reinició su voz: la conexión vieja ya no vale. Si nos toca
        // ofrecer, ofrecemos; si no, esperamos su oferta.
        quitarPar(de);
        reconciliar();
        return;
      }
      if (sig.tipo === 'oferta') {
        // Una oferta nueva sustituye siempre a la conexión anterior con él.
        quitarPar(de);
        void hacerPar(de, 'respondedor').recibir(sig);
        return;
      }
      void paresRef.current.get(de)?.recibir(sig);
    };

    const offSenal = onSenalizacion((de, sig) => {
      if (!microListo || pendientes.length > 0) {
        pendientes.push({ de, sig });
        return;
      }
      procesar(de, sig);
    });

    (async () => {
      if (conMicro) {
        try {
          // Se reutiliza el micro si ya estaba abierto (reinicio, reconexión).
          if (!microRef.current) {
            microRef.current = await obtenerMicro();
            // Android 14: el servicio en primer plano solo puede declararse
            // «de micrófono» con el permiso ya concedido; se actualiza ahora.
            fijarModoVoz(true);
          }
          setErrorMicro(false);
          aplicarModoMicro();
        } catch {
          // Permiso denegado o micro en uso por otra app: se avisa en
          // pantalla, pero se sigue conectando para poder escuchar.
          if (!desechado) setErrorMicro(true);
        }
      }
      if (desechado) return;
      microListo = true;
      while (pendientes.length > 0) {
        const { de, sig } = pendientes.shift()!;
        procesar(de, sig);
      }
      reconciliar();
      // Reinicio: quienes nos ofrecían siguen atados a conexiones que ya no
      // existen; se les pide una nueva. (A los que ofrecemos nosotros ya les
      // llega nuestra oferta, que sustituye a la vieja.)
      if (reinicio > 0) {
        for (const p of participantesRef.current) {
          if (p.id !== tuId && !soyOferente(tuId, p.id)) {
            enviarSenalizacionPara(p.id, { tipo: 'renegociar', de: tuId });
          }
        }
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

    // Calidad de la conexión: cada 2 s, la peor de todas.
    const relojCalidad = setInterval(() => {
      void (async () => {
        const calidades = await Promise.all([...paresRef.current.values()].map(p => p.calidad()));
        if (!desechado) setCalidad(peorCalidad(calidades));
      })();
    }, 2000);

    return () => {
      desechado = true;
      offSenal();
      clearInterval(reloj);
      clearInterval(relojCalidad);
      setCalidad(null);
      cerrarTodo();
    };
  }, [
    tuId, conMicro, onSenalizacion, enviarSenalizacionPara, cerrarTodo, aplicarModoMicro, reinicio,
  ]);

  // Alguien entra, sale o cambia de papel: se ajustan las conexiones.
  useEffect(() => {
    reconciliarRef.current();
  }, [participantes]);

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

  // Mientras la app locuta (tiempos, mensajes rápidos), la voz que llega baja
  // al 25 % para que la locución se entienda bien; luego vuelve. La locución
  // ya suena al máximo: lo que se puede hacer es apartar lo demás.
  useEffect(() => {
    if (!tuId) return;
    const fijarVolumen = (v: number) => {
      for (const flujo of pistasRef.current) {
        for (const p of flujo.getAudioTracks()) {
          try { (p as unknown as { _setVolume?: (n: number) => void })._setVolume?.(v); } catch { /* ignore */ }
        }
      }
    };
    if (estaLocutando()) fijarVolumen(VOLUMEN_DURANTE_LOCUCION);
    const off = onLocucion(v => fijarVolumen(v ? VOLUMEN_DURANTE_LOCUCION : 1));
    return () => {
      off();
      fijarVolumen(1);
    };
  }, [tuId, pistas]);

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
    calidad, errorMicro,
  };
}
