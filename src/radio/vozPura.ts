// Lógica pura del motor de voz (sin `react-native-webrtc` ni React) para poder
// testearla. `voz.ts` la re-exporta; el resto del motor es nativo y no se testea.

/** Un candidato ICE viaja como string en el mensaje `candidato`; para
 *  `addIceCandidate` hace falta también `sdpMid`/`sdpMLineIndex`, así que se
 *  serializa el objeto completo como JSON. El protocolo lo trata como opaco. */
export interface CandidatoIce {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export function serializarCandidato(c: CandidatoIce): string {
  return JSON.stringify(c);
}

/** Devuelve el candidato o `null` si el texto no es un candidato válido. */
export function deserializarCandidato(texto: string): CandidatoIce | null {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.candidate !== 'string') return null;
  return {
    candidate: o.candidate,
    sdpMid: typeof o.sdpMid === 'string' ? o.sdpMid : null,
    sdpMLineIndex: typeof o.sdpMLineIndex === 'number' ? o.sdpMLineIndex : null,
  };
}

/**
 * Ordena la señalización entrante de un peer. WebRTC rechaza un candidato ICE
 * si aún no tiene la descripción remota, y las señales llegan seguidas por TCP
 * (oferta + candidatos en ráfaga) mientras `setRemoteDescription` sigue en
 * curso. Sin esto los candidatos se perdían y la voz se quedaba en
 * «Conectando voz…». Garantiza dos cosas:
 *   • las señales se procesan de una en una, en orden de llegada;
 *   • los candidatos que llegan antes de la descripción remota se guardan y se
 *     aplican justo después de fijarla.
 */
export function crearColaSenales<C>(acciones: {
  aplicarDescripcion: (s: { tipo: 'oferta' | 'respuesta'; sdp: string }) => Promise<void>;
  aplicarCandidato: (c: C) => Promise<void>;
}) {
  let cadena: Promise<void> = Promise.resolve();
  let hayRemota = false;
  const candidatosPendientes: C[] = [];

  const encolar = (paso: () => Promise<void>) => {
    cadena = cadena.then(paso).catch(() => { /* una señal mala no bloquea el resto */ });
    return cadena;
  };

  return {
    descripcion(tipo: 'oferta' | 'respuesta', sdp: string) {
      return encolar(async () => {
        await acciones.aplicarDescripcion({ tipo, sdp });
        hayRemota = true;
        for (const c of candidatosPendientes.splice(0)) {
          try { await acciones.aplicarCandidato(c); } catch { /* ignore */ }
        }
      });
    },
    candidato(c: C) {
      return encolar(async () => {
        if (hayRemota) await acciones.aplicarCandidato(c);
        else candidatosPendientes.push(c);
      });
    },
  };
}

/** Normaliza el nivel de audio (0..1) desde los reportes de `getStats()`.
 *  `audioLevel` aparece en `inbound-rtp` (y, según plataforma, en `track`); es
 *  0 en silencio y crece con el volumen. Toma el máximo de los reportes. */
export function extraerNivelAudio(
  estadisticas: Iterable<{ type?: string; audioLevel?: number }>,
): number {
  let nivel = 0;
  for (const r of estadisticas) {
    if (typeof r.audioLevel === 'number' && r.audioLevel > nivel) {
      nivel = r.audioLevel;
    }
  }
  return nivel;
}
