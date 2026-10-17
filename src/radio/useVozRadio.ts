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
import { activarAudioVoz, restaurarAudio } from './audioSesion';
import { crearPar, obtenerMicro, soltarMicro, type ParVoz } from './voz';

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
}

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
  const hablandoRef = useRef(false);
  const rolRef = useRef(rol);
  rolRef.current = rol;

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
    const activo = rolRef.current === 'piloto';
    const pista = microRef.current?.getAudioTracks()[0];
    if (pista) pista.enabled = activo;
    hablandoRef.current = activo;
    setHablando(activo);
  }, []);

  // ── Topología: arranca al entrar en sala y si cambia quiénes somos ──
  useEffect(() => {
    if (!tuId) return;
    cerrarTodo();
    void activarAudioVoz();

    let desechado = false;
    const flujosRemotos = new Set<MediaStream>();
    // Señales (oferta y sus candidatos) que llegan al hub antes de tener el
    // micro listo: se guardan en orden y se procesan al obtenerlo. Antes solo
    // se guardaban las ofertas y los candidatos de esa ráfaga se perdían.
    const senalesPendientes: { de: string; sig: MensajeSenalizacion }[] = [];

    const publicarPistas = () => {
      if (!desechado) setPistas([...flujosRemotos]);
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
            flujosRemotos.add(flujo);
            publicarPistas();
          },
          onEstado(estado) {
            if (estado === 'connected') setListo(true);
            else if (estado === 'failed' || estado === 'closed') setListo(false);
          },
        },
      });
      paresRef.current.set(id, par);
      return par;
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
        const par = paresRef.current.get(de)
          ?? (sig.tipo === 'oferta' ? hacerPar(de, microRef.current, 'respondedor') : undefined);
        void par?.recibir(sig);
      } else if (de === 'asistente') {
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
            const par = paresRef.current.get(de)
              ?? (sig.tipo === 'oferta' ? hacerPar(de, microRef.current, 'respondedor') : undefined);
            await par?.recibir(sig);
          }
          aplicarModoMicro();
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
    enviarSenalizacionA, cerrarTodo, aplicarModoMicro,
  ]);

  // ── Modo de micro: cambia con el rol sin tumbar los peers ──
  useEffect(() => {
    if (!tuId) return;
    aplicarModoMicro();
  }, [rol, tuId, aplicarModoMicro]);

  const fijarMicro = useCallback((activo: boolean) => {
    hablandoRef.current = activo;
    setHablando(activo);
    // El micro es compartido entre todos los peers: mutea/desmutea la pista
    // local una sola vez (afecta a todos a la vez).
    const pista = microRef.current?.getAudioTracks()[0];
    if (pista) pista.enabled = activo;
  }, []);

  return { pistas, nivel, hablando, fijarMicro, listo };
}
