// Motor WebRTC de voz de Radio (Fase 2). Envuelve `react-native-webrtc` en una
// API pequeña y coordinable por `useVozRadio`: un `Par` es UNA conexión de audio
// entre el asistente y un participante. Solo audio, topología en estrella (D6):
// cada participante abre un peer con el asistente, que es el hub.
//
// Roles en la negociación:
//   • Oferente (participante): crea la oferta al nacer y responde al SDP del
//     asistente. El piloto añade su micro abierto; el seguidor solo escucha.
//   • Respondedor (asistente): recibe la oferta y responde con su micro, que
//     comparte con todos los peers (PTT: `fijarMicro` mutea la pista global).
//
// Las funciones puras (serializar/deserializar candidatos y `extraerNivelAudio`)
// están separadas para poder testearlas sin montar los módulos nativos.

import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';

import type { MensajeSenalizacion } from './mensajes';
import {
  ajustarOpus, crearColaSenales, deserializarCandidato, extraerNivelAudio, extraerNivelLocal,
  serializarCandidato, type CandidatoIce,
} from './vozPura';

export { deserializarCandidato, extraerNivelAudio, serializarCandidato } from './vozPura';
export type { CandidatoIce } from './vozPura';

/** STUN público para resolver la IP dentro de la LAN / hotspot del asistente.
 *  Sin TURN: en la misma WiFi la conexión es directa (host candidates). */
const CONFIGURACION_PAR = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/**
 * Filtros de audio de WebRTC, forzados. En Android se pasan tal cual como
 * restricciones del motor (`goog*`): algunos móviles los traen apagados o
 * usan solo los del fabricante. En iOS los aplica siempre el procesado de voz
 * del sistema (la sesión en modo voiceChat), y estas claves se ignoran.
 *   • cancelación de eco · supresión de ruido · control automático de
 *     ganancia · filtro de graves (quita el retumbar de motores y golpes).
 */
const FILTROS_AUDIO = {
  googEchoCancellation: 'true',
  googNoiseSuppression: 'true',
  googAutoGainControl: 'true',
  googHighpassFilter: 'true',
};

/** Solicita el micro local (solo audio). Pide permiso si aún no se ha dado. */
export function obtenerMicro(): Promise<MediaStream> {
  return mediaDevices.getUserMedia({
    // Cast: el tipo de react-native-webrtc no conoce las claves `goog*`.
    audio: FILTROS_AUDIO as unknown as boolean,
    video: false,
  });
}

/** Cierra (suavemente) un flujo local y sus pistas. */
export function soltarMicro(flujo: MediaStream | null): void {
  if (!flujo) return;
  try {
    for (const pista of flujo.getTracks()) pista.stop();
    flujo.release(false);
  } catch { /* ignore */ }
}

export type ModoPar = 'oferente' | 'respondedor';

export interface CallbacksPar {
  /** SDP listo para enviar: la oferta (oferente) o la respuesta (respondedor). */
  onSdp(sdp: string): void;
  /** Candidato ICE local, listo para enviar al otro extremo. */
  onCandidato(candidato: string): void;
  /** Flujo remoto de audio (para montar el `RTCView` que lo reproduce). */
  onPistaRemota(flujo: MediaStream): void;
  /** Cambio de estado de la conexión (new/connecting/connected/…). */
  onEstado(estado: string): void;
}

export interface ParVoz {
  /** Arranca la negociación (el oferente crea y envía su oferta; el
   *  respondedor no hace nada). */
  iniciar(): Promise<void>;
  /** Procesa una señalización entrante (oferta/respuesta/candidato). */
  recibir(sig: MensajeSenalizacion): Promise<void>;
  /** Activa/desactiva el envío del micro (PTT / micro abierto). */
  fijarMicro(activo: boolean): void;
  /** Nivel de audio recibido (0..1), para el medidor. */
  nivel(): Promise<number>;
  /** Nivel del micro local (0..1), para la puerta de voz; `null` si la
   *  plataforma no lo informa. */
  nivelLocal(): Promise<number | null>;
  /** Cierra el peer. */
  cerrar(): void;
}

export interface OpcionesPar {
  modo: ModoPar;
  /** Micro local a añadir (`null` en el seguidor, que solo escucha). */
  micro: MediaStream | null;
  cb: CallbacksPar;
}

/**
 * Crea un par WebRTC de audio.
 *
 * - `oferente`: crea la oferta en `recibir` cuando recibe la señal de arranque
 *   (lo dispara el hook al unirse) o, si ya tiene micro, al llamar `iniciar()`.
 * - `respondedor`: espera la `oferta` y responde con su SDP.
 */
export function crearPar(opciones: OpcionesPar): ParVoz {
  const { modo, micro, cb } = opciones;
  const pc = new RTCPeerConnection(CONFIGURACION_PAR);
  const pistaMicro = micro?.getAudioTracks()[0] ?? null;

  // El micro local se añade como pista de audio. El seguidor (sin micro) abre
  // un transceiver de solo recepción para negociar el audio entrante.
  if (pistaMicro && micro) {
    pc.addTrack(pistaMicro, micro);
  } else {
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  pc.onicecandidate = (evento) => {
    const c = (evento as unknown as { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null }).candidate;
    if (!c || !c.candidate) return; // candidato nulo = fin de la recogida ICE
    cb.onCandidato(serializarCandidato({
      candidate: c.candidate,
      sdpMid: c.sdpMid ?? null,
      sdpMLineIndex: c.sdpMLineIndex ?? null,
    }));
  };

  pc.ontrack = (evento) => {
    const flujo = (evento as unknown as { streams: MediaStream[] }).streams[0];
    if (flujo) cb.onPistaRemota(flujo);
  };

  pc.onconnectionstatechange = () => cb.onEstado(pc.connectionState);

  // El SDP local lleva Opus ajustado (DTX, FEC, mono): ver `ajustarOpus`.
  const crearYEnviarDescripcion = async () => {
    const tipo = modo === 'oferente' ? 'offer' : 'answer';
    const base = modo === 'oferente' ? await pc.createOffer() : await pc.createAnswer();
    const sdp = ajustarOpus(base.sdp ?? '');
    await pc.setLocalDescription(new RTCSessionDescription({ type: tipo, sdp }));
    cb.onSdp(sdp);
  };


  const cola = crearColaSenales<CandidatoIce>({
    async aplicarDescripcion({ tipo, sdp }) {
      if (tipo === 'oferta') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        await crearYEnviarDescripcion();
      } else {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
      }
    },
    async aplicarCandidato(c) {
      await pc.addIceCandidate(c);
    },
  });

  return {
    async iniciar() {
      if (modo !== 'oferente') return;
      await crearYEnviarDescripcion();
    },

    async recibir(sig) {
      if (sig.tipo === 'oferta' && modo === 'respondedor') {
        await cola.descripcion('oferta', sig.sdp);
      } else if (sig.tipo === 'respuesta' && modo === 'oferente') {
        await cola.descripcion('respuesta', sig.sdp);
      } else if (sig.tipo === 'candidato') {
        const c = deserializarCandidato(sig.candidate);
        if (c) await cola.candidato(c);
      }
    },

    fijarMicro(activo) {
      if (pistaMicro) pistaMicro.enabled = activo;
    },

    async nivel() {
      try {
        const stats = await pc.getStats();
        return extraerNivelAudio([...(stats?.values() ?? [])].filter(
          (r: { type?: string }) => r.type !== 'media-source',
        ));
      } catch {
        return 0;
      }
    },

    async nivelLocal() {
      try {
        const stats = await pc.getStats();
        return extraerNivelLocal(stats?.values() ?? []);
      } catch {
        return null;
      }
    },

    cerrar() {
      try { pc.close(); } catch { /* ignore */ }
    },
  };
}
