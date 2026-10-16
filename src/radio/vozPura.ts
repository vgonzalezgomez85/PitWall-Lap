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
