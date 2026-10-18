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

// ── Calidad de voz (fase A de control de ruido) ─────────────────────────────

/**
 * Ajusta los parámetros de Opus en un SDP local. En un SDP, los `fmtp` dicen
 * cómo quiere RECIBIR el audio quien lo escribe, así que los dos extremos
 * ajustan su SDP local y se benefician ambos sentidos:
 *   • `usedtx=1` — en silencio no se envía audio (ni el ruido de fondo).
 *   • `useinbandfec=1` — corrección de pérdidas: la voz no se entrecorta si el
 *     WiFi pierde algún paquete.
 *   • `stereo=0` / `sprop-stereo=0` — mono: la voz no necesita más.
 *   • `maxaveragebitrate=32000` — suficiente para voz clara.
 * Mantiene los parámetros que ya hubiera (p. ej. `minptime`).
 */
export function ajustarOpus(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const deseados: Record<string, string> = {
    usedtx: '1', useinbandfec: '1', stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: '32000',
  };
  const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm');
  const m = fmtp.exec(sdp);
  if (!m) {
    const params = Object.entries(deseados).map(([k, v]) => `${k}=${v}`).join(';');
    return sdp.replace(new RegExp(`^(a=rtpmap:${pt} opus/48000.*)$`, 'mi'), `$1\r\na=fmtp:${pt} ${params}`);
  }
  const actuales = new Map<string, string>();
  for (const par of (m[1] ?? '').split(';')) {
    const [k, v] = par.split('=');
    if (k?.trim()) actuales.set(k.trim(), (v ?? '').trim());
  }
  for (const [k, v] of Object.entries(deseados)) actuales.set(k, v);
  const linea = `a=fmtp:${pt} ${[...actuales].map(([k, v]) => `${k}=${v}`).join(';')}`;
  return sdp.replace(fmtp, linea);
}

/** Nivel del micro LOCAL (0..1) desde `getStats()`: `media-source` de audio.
 *  `null` si la plataforma no lo informa: la puerta de voz debe quedarse
 *  abierta, o el piloto no se oiría nunca. */
export function extraerNivelLocal(
  estadisticas: Iterable<{ type?: string; kind?: string; audioLevel?: number }>,
): number | null {
  let nivel: number | null = null;
  for (const r of estadisticas) {
    if (r.type === 'media-source' && typeof r.audioLevel === 'number') {
      nivel = Math.max(nivel ?? 0, r.audioLevel);
    }
  }
  return nivel;
}

/** Sensibilidad de la puerta de voz: umbral de nivel (0..1) a superar. */
export type SensibilidadPuerta = 'apagada' | 'normal' | 'estricta';

export const UMBRAL_PUERTA: Record<SensibilidadPuerta, number> = {
  apagada: 0,
  normal: 0.04,
  estricta: 0.1,
};

/**
 * Puerta de voz: decide si el micro abierto debe transmitir. Abre en cuanto
 * el nivel supera el umbral (sin cortar el arranque de la frase) y cierra solo
 * tras `retencionMs` por debajo del 70 % del umbral (histéresis: no «tartamudea»
 * entre palabras ni con el final de las frases).
 */
export function crearPuertaVoz(opciones: { umbral: number; retencionMs?: number }) {
  const retencion = opciones.retencionMs ?? 700;
  let umbral = opciones.umbral;
  let abierta = umbral <= 0;
  let ultimaVoz = -Infinity;
  return {
    actualizar(nivel: number, ahora: number): boolean {
      if (umbral <= 0) return (abierta = true);
      if (nivel >= umbral) {
        ultimaVoz = ahora;
        abierta = true;
      } else if (abierta && nivel < umbral * 0.7 && ahora - ultimaVoz >= retencion) {
        abierta = false;
      } else if (abierta && nivel >= umbral * 0.7) {
        ultimaVoz = ahora;
      }
      return abierta;
    },
    fijarUmbral(nuevo: number) {
      umbral = nuevo;
      if (umbral <= 0) abierta = true;
    },
    get abierta() { return abierta; },
  };
}

// ── Calidad de la conexión de voz ───────────────────────────────────────────

export type CalidadConexion = 'buena' | 'regular' | 'mala';

/** Contadores de paquetes de la medida anterior, para medir pérdidas en la
 *  ventana entre medidas y no en el acumulado de toda la sesión. */
export interface ContadoresPaquetes {
  recibidos: number;
  perdidos: number;
}

/**
 * Calidad de una conexión a partir de `getStats()`: tiempo de ida y vuelta
 * (par de candidatos activo), pérdida de paquetes desde la medida anterior y
 * jitter del audio recibido. Devuelve también los contadores para la próxima
 * medida. `calidad: null` si aún no hay datos.
 */
export function calidadConexion(
  estadisticas: Iterable<{
    type?: string; kind?: string; state?: string; nominated?: boolean;
    currentRoundTripTime?: number; packetsReceived?: number; packetsLost?: number; jitter?: number;
  }>,
  anterior: ContadoresPaquetes | null,
): { calidad: CalidadConexion | null; contadores: ContadoresPaquetes | null } {
  let rtt: number | null = null;
  let recibidos = 0;
  let perdidos = 0;
  let jitter = 0;
  let hayAudio = false;
  for (const r of estadisticas) {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
      if (r.nominated !== false) rtt = Math.max(rtt ?? 0, r.currentRoundTripTime);
    }
    if (r.type === 'inbound-rtp' && (r.kind === undefined || r.kind === 'audio')) {
      hayAudio = true;
      recibidos += r.packetsReceived ?? 0;
      perdidos += Math.max(0, r.packetsLost ?? 0);
      jitter = Math.max(jitter, r.jitter ?? 0);
    }
  }
  const contadores = hayAudio ? { recibidos, perdidos } : null;
  if (rtt == null && !hayAudio) return { calidad: null, contadores };

  let perdida = 0;
  if (hayAudio) {
    const dRecibidos = recibidos - (anterior?.recibidos ?? 0);
    const dPerdidos = perdidos - (anterior?.perdidos ?? 0);
    const total = dRecibidos + dPerdidos;
    perdida = total > 0 ? dPerdidos / total : 0;
  }
  const r = rtt ?? 0;
  const calidad: CalidadConexion =
    r > 0.4 || perdida > 0.08 || jitter > 0.08 ? 'mala'
    : r > 0.15 || perdida > 0.02 || jitter > 0.03 ? 'regular'
    : 'buena';
  return { calidad, contadores };
}

/** La peor de varias calidades (la sala va tan bien como su peor conexión). */
export function peorCalidad(calidades: (CalidadConexion | null)[]): CalidadConexion | null {
  const orden: CalidadConexion[] = ['mala', 'regular', 'buena'];
  for (const c of orden) if (calidades.includes(c)) return c;
  return null;
}
