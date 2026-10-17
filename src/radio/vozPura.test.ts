import {
  crearColaSenales,
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
