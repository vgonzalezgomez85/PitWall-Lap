import {
  ajustarOpus,
  crearColaSenales,
  crearPuertaVoz,
  extraerNivelLocal,
  UMBRAL_PUERTA,
  deserializarCandidato,
  extraerNivelAudio,
  serializarCandidato,
} from './vozPura';

describe('vozPura (sin react-native-webrtc)', () => {
  it('serializa y deserializa un candidato ICE con sus índices', () => {
    const c = {
      candidate: 'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    const texto = serializarCandidato(c);
    expect(deserializarCandidato(texto)).toEqual(c);
  });

  it('tolera candidatos sin sdpMid ni sdpMLineIndex', () => {
    const c = { candidate: 'candidate:2 1 udp 1.2.3.4 9 typ srflx', sdpMid: null, sdpMLineIndex: null };
    expect(deserializarCandidato(serializarCandidato(c))).toEqual(c);
  });

  it('rechaza JSON malformado o sin candidate', () => {
    expect(deserializarCandidato('{esto no es json')).toBeNull();
    expect(deserializarCandidato('{"sdpMid":"0"}')).toBeNull();
    expect(deserializarCandidato('42')).toBeNull();
  });

  it('extrae el nivel de audio como el máximo de los reportes', () => {
    expect(extraerNivelAudio([])).toBe(0);
    expect(extraerNivelAudio([
      { type: 'inbound-rtp', audioLevel: 0.12 },
      { type: 'inbound-rtp', audioLevel: 0.55 },
      { type: 'codec' },
      { type: 'inbound-rtp' }, // sin audioLevel: se ignora
    ])).toBe(0.55);
    expect(extraerNivelAudio([{ type: 'track', audioLevel: -1 }])).toBe(0);
  });
});

describe('crearColaSenales', () => {
  it('guarda los candidatos que llegan antes de la descripción y los aplica después', async () => {
    const pasos: string[] = [];
    let terminarDescripcion!: () => void;
    const cola = crearColaSenales<string>({
      aplicarDescripcion: (d) => new Promise<void>((resolve) => {
        pasos.push(`descripcion:${d.tipo}`);
        terminarDescripcion = resolve;
      }),
      aplicarCandidato: async (c) => { pasos.push(`candidato:${c}`); },
    });

    // Ráfaga típica: oferta y candidatos seguidos, sin esperar.
    void cola.descripcion('oferta', 'sdp');
    void cola.candidato('a');
    const fin = cola.candidato('b');
    await Promise.resolve();
    expect(pasos).toEqual(['descripcion:oferta']);

    terminarDescripcion();
    await fin;
    expect(pasos).toEqual(['descripcion:oferta', 'candidato:a', 'candidato:b']);
  });

  it('candidatos previos a cualquier descripción esperan a la respuesta', async () => {
    const pasos: string[] = [];
    const cola = crearColaSenales<string>({
      aplicarDescripcion: async (d) => { pasos.push(`descripcion:${d.tipo}`); },
      aplicarCandidato: async (c) => { pasos.push(`candidato:${c}`); },
    });
    void cola.candidato('x');
    await cola.descripcion('respuesta', 'sdp');
    expect(pasos).toEqual(['descripcion:respuesta', 'candidato:x']);
  });

  it('un fallo al aplicar una señal no bloquea las siguientes', async () => {
    const pasos: string[] = [];
    const cola = crearColaSenales<string>({
      aplicarDescripcion: async () => { throw new Error('sdp inválido'); },
      aplicarCandidato: async (c) => { pasos.push(c); },
    });
    void cola.descripcion('oferta', 'malo');
    await cola.candidato('tras-fallo');
    expect(pasos).toEqual([]); // sin descripción remota sigue guardado
  });
});

const SDP_OPUS = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  '',
].join('\r\n');

describe('ajustarOpus', () => {
  it('añade DTX, FEC, mono y bitrate sin perder lo que había', () => {
    const r = ajustarOpus(SDP_OPUS);
    const fmtp = /a=fmtp:111 (.*)/.exec(r)?.[1] ?? '';
    expect(fmtp).toContain('minptime=10');
    expect(fmtp).toContain('usedtx=1');
    expect(fmtp).toContain('useinbandfec=1');
    expect(fmtp).toContain('stereo=0');
    expect(fmtp).toContain('sprop-stereo=0');
    expect(fmtp).toContain('maxaveragebitrate=32000');
    expect(r).toContain('a=rtpmap:63 red/48000/2');
  });

  it('crea la línea fmtp si no existe', () => {
    const r = ajustarOpus(SDP_OPUS.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', ''));
    expect(r).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 usedtx=1/);
  });

  it('no toca un SDP sin Opus', () => {
    const sinOpus = 'v=0\r\nm=audio 9 RTP 0\r\na=rtpmap:0 PCMU/8000\r\n';
    expect(ajustarOpus(sinOpus)).toBe(sinOpus);
  });
});

describe('extraerNivelLocal', () => {
  it('lee solo el media-source (micro local), no el audio recibido', () => {
    expect(extraerNivelLocal([
      { type: 'inbound-rtp', audioLevel: 0.9 },
      { type: 'media-source', kind: 'audio', audioLevel: 0.2 },
    ])).toBe(0.2);
  });

  it('devuelve null si la plataforma no informa del micro local', () => {
    expect(extraerNivelLocal([{ type: 'inbound-rtp', audioLevel: 0.5 }])).toBeNull();
  });
});

describe('crearPuertaVoz', () => {
  it('abre al hablar y cierra tras la retención en silencio', () => {
    const p = crearPuertaVoz({ umbral: 0.1, retencionMs: 500 });
    expect(p.actualizar(0.01, 0)).toBe(false);
    expect(p.actualizar(0.2, 100)).toBe(true);
    expect(p.actualizar(0.01, 400)).toBe(true);   // dentro de la retención
    expect(p.actualizar(0.01, 650)).toBe(false);  // 550 ms tras la última voz
  });

  it('no se cierra con niveles en la zona de histéresis', () => {
    const p = crearPuertaVoz({ umbral: 0.1, retencionMs: 300 });
    p.actualizar(0.2, 0);
    expect(p.actualizar(0.08, 1000)).toBe(true);  // ≥ 70 % del umbral: sigue
    expect(p.actualizar(0.01, 1200)).toBe(true);  // retención desde 1000
    expect(p.actualizar(0.01, 1350)).toBe(false);
  });

  it('con umbral 0 (apagada) siempre transmite', () => {
    const p = crearPuertaVoz({ umbral: 0 });
    expect(p.actualizar(0, 0)).toBe(true);
    p.fijarUmbral(UMBRAL_PUERTA.estricta);
    expect(p.actualizar(0, 10_000)).toBe(false);  // al activarla, sin voz reciente, cierra
  });
});
