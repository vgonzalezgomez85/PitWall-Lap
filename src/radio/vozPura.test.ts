import {
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
