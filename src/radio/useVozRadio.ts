// Ciclo de vida de los pares WebRTC de voz según el rol (Fase 2). Sobre la
// señalización ya enrutada por `RadioContext` (onSenalizacion/enviarSenalizacion),
// gestiona:
//
//   • Asistente (hub, D6): un peer respondedor por participante, con su micro
//     compartido entre todos (walkie PTT = mute global).
//   • Piloto: un peer oferente hacia el asistente, micro abierto.
//   • Seguidor: un peer oferente hacia el asistente, solo escucha.
//
// Devuelve los flujos remotos (para montar el `RTCView` que los reproduce), el
// nivel de audio actual (medidor para calibrar la puerta de voz) y el control
// PTT del asistente. No re-encodifica: el reenvío piloto→seguidor se aplaza.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaStream } from 'react-native-webrtc';

import { useRadio } from './RadioContext';
import type { MensajeSenalizacion } from './mensajes';
import { activarAudioVoz, restaurarAudio } from './audioSesion';
import { crearPar, obtenerMicro, soltarMicro, type ParVoz } from './voz';

export interface EstadoVozRadio {
  /** Flujos de audio remotos a reproducir (RTCView). */
  pistas: MediaStream[];
  /** Nivel de audio actual (0..1), máximo de todos los pares. */
  nivel: number;
  /** ¿Está enviando el micro ahora? (PTT del asistente; piloto siempre sí). */
  hablando: boolean;
  /** Asistente: pulsar-para-hablar. En el resto de roles no hace nada. */
  fijarMicro(activo: boolean): void;
  /** ¿Micro obtenido y al menos un peer levantado? */
  listo: boolean;
}

/** Cuántas veces por segundo se refresca el medidor de nivel. */
const MUESTREO_MS = 400;

export function useVozRadio(): EstadoVozRadio {
  const {
    rol, tuId, onSenalizacion, enviarSenalizacion, enviarSenalizacionA,
  } = useRadio();

  const [pistas, setPistas] = useState<MediaStream[]>([]);
  const [nivel, setNivel] = useState(0);
  const [hablando, setHablando] = useState(rol === 'piloto');
  const [listo, setListo] = useState(false);

  const microRef = useRef<MediaStream | null>(null);
  const paresRef = useRef<Map<string, ParVoz>>(new Map());
  const hablandoRef = useRef(rol === 'piloto');

  const cerrarTodo = useCallback(() => {
    for (const par of paresRef.current.values()) par.cerrar();
    paresRef.current.clear();
    soltarMicro(microRef.current);
    microRef.current = null;
    setPistas([]);
    setListo(false);
    setNivel(0);
  }, []);

  // ── Ciclo de vida principal (arranca al entrar en sala y cambia de rol) ──
  useEffect(() => {
    if (!rol) return;
    cerrarTodo();
    void activarAudioVoz();

    const esAsistente = rol === 'asistente';
    let desechado = false;
    const flujosRemotos = new Set<MediaStream>();
    // Ofertas que llegan antes de tener el micro listo (asistente): se guardan.
    const ofertasPendientes: { de: string; sig: MensajeSenalizacion }[] = [];

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
            if (esAsistente) enviarSenalizacionA(id, sig);
            else enviarSenalizacion(sig);
          },
          onCandidato(candidate) {
            const sig: MensajeSenalizacion = {
              tipo: 'candidato', de: esAsistente ? 'asistente' : tuId, candidate,
            };
            if (esAsistente) enviarSenalizacionA(id, sig);
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
      if (esAsistente) {
        if (sig.tipo === 'oferta') {
          // Si el micro aún no está listo, guardamos la oferta y la procesamos
          // al terminar `obtenerMicro()`.
          if (!microRef.current) {
            ofertasPendientes.push({ de, sig });
            return;
          }
          const par = paresRef.current.get(de) ?? hacerPar(de, microRef.current, 'respondedor');
          void par.recibir(sig);
        } else {
          void paresRef.current.get(de)?.recibir(sig);
        }
      } else if (de === 'asistente') {
        const par = [...paresRef.current.values()][0];
        void par?.recibir(sig);
      }
    });

    // Arranque según el rol.
    (async () => {
      try {
        if (esAsistente) {
          // El asistente adquiere el micro una vez y lo comparte entre peers.
          microRef.current = await obtenerMicro();
          // Procesa las ofertas que llegaron mientras esperábamos el permiso.
          for (const { de, sig } of ofertasPendientes.splice(0)) {
            const par = paresRef.current.get(de) ?? hacerPar(de, microRef.current, 'respondedor');
            await par.recibir(sig);
          }
        } else {
          const micro = rol === 'piloto' ? await obtenerMicro() : null;
          if (rol === 'piloto') {
            microRef.current = micro;
            hablandoRef.current = true;
            if (!desechado) setHablando(true);
          }
          const par = hacerPar('asistente', micro, 'oferente');
          await par.iniciar();
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
  }, [rol, tuId, onSenalizacion, enviarSenalizacion, enviarSenalizacionA, cerrarTodo]);

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
