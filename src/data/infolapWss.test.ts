import {
  aprenderDuracion, claveConfig, clasificacionACero, clasificarConfig, mangasPorRotacion,
  parseWsMessage, standingForLane, type InfolapRival,
} from './infolapWss';

// Mensajes reales capturados del TICTAC_Slot nuevo (carrera con simulador).
const CONFIG = '{"type":"CONFIG","minAppVersionCode":1,"minAppVersion":"1.0","mangaPilots":[{"laneId":1,"name":"Piloto 1"},{"laneId":2,"name":"Piloto 2"},{"laneId":3,"name":"Piloto 3"},{"laneId":4,"name":"Carril 4"},{"laneId":5,"name":"Carril 5"},{"laneId":6,"name":"Carril 6"}],"rivals":[]}';
const LAP_FIRST = '{"type":"LAP","frame":101,"laneId":1,"pilotName":"Piloto 1","lapTime":0.0000,"isFastLap":false,"position":1,"isRace":true,"isFirstLap":true,"pilotBehindName":"Piloto 2","pilotBehindVme":0.0000}';
const LAP_MID = '{"type":"LAP","frame":108,"laneId":2,"pilotName":"Piloto 2","lapTime":2.5701,"isFastLap":true,"position":2,"isRace":true,"isFirstLap":false,"pilotAheadName":"Piloto 1","pilotAheadVme":3.3015,"gapAhead":0.5464,"pilotBehindName":"Piloto 3","pilotBehindVme":4.8291,"gapBehind":4.0365}';
const LAP_TEST = '{"type":"LAP","frame":7,"laneId":1,"pilotName":"Carril 1","lapTime":0.0070,"isFastLap":false,"position":0,"isRace":false,"isFirstLap":false}';
const RIVALS = '{"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 1","vme":3.3015,"isRacing":true,"laneId":1,"gap":0.0000},{"position":2,"name":"Piloto 2","vme":3.4836,"isRacing":true,"laneId":2,"gap":0.5464},{"position":3,"name":"Piloto 3","vme":4.8291,"isRacing":true,"laneId":3,"gap":4.5829}]}';
const RIVALS_EARLY = '{"type":"RIVALS_UPDATE","rivals":[{"position":1,"name":"Piloto 1","vme":3.9334,"isRacing":true,"laneId":1,"gap":0.0000},{"position":2,"name":"Piloto 2","vme":0.0,"isRacing":true,"laneId":2,"gap":null}]}';

describe('parseWsMessage', () => {
  it('CONFIG → pilotos por carril', () => {
    const m = parseWsMessage(CONFIG);
    expect(m?.type).toBe('CONFIG');
    if (m?.type !== 'CONFIG') return;
    expect(m.pilots).toHaveLength(6);
    expect(m.pilots[1]).toEqual({ laneId: 2, name: 'Piloto 2' });
  });

  it('LAP con gaps → ms', () => {
    const m = parseWsMessage(LAP_MID);
    expect(m).toEqual({
      type: 'LAP', frame: 108, laneId: 2, pilotName: 'Piloto 2',
      lapTimeMs: 2570, isFastLap: true, isFirstLap: false, isRace: true, position: 2,
      aheadName: 'Piloto 1', aheadGapMs: 546, behindName: 'Piloto 3', behindGapMs: 4037,
    });
  });

  it('LAP de salida → sin tiempo de vuelta', () => {
    const m = parseWsMessage(LAP_FIRST);
    expect(m?.type === 'LAP' && m.lapTimeMs).toBeNull();
    expect(m?.type === 'LAP' && m.aheadName).toBeNull();
  });

  it('LAP fuera de carrera → posición null', () => {
    const m = parseWsMessage(LAP_TEST);
    expect(m?.type === 'LAP' && m.position).toBeNull();
    expect(m?.type === 'LAP' && m.lapTimeMs).toBe(7);
  });

  it('basura / tipos desconocidos → null', () => {
    expect(parseWsMessage('no json')).toBeNull();
    expect(parseWsMessage('{"type":"OTHER"}')).toBeNull();
    expect(parseWsMessage('{"type":"LAP"}')).toBeNull();
  });
});

describe('standingForLane', () => {
  const rivals = (text: string): InfolapRival[] => {
    const m = parseWsMessage(text);
    return m?.type === 'RIVALS_UPDATE' ? m.rivals : [];
  };

  it('gaps a delante/detrás = diferencia de gaps al líder', () => {
    expect(standingForLane(rivals(RIVALS), 2)).toEqual({
      position: 2, total: 3,
      aheadName: 'Piloto 1', aheadGapMs: 546,
      behindName: 'Piloto 3', behindGapMs: 4037,
    });
  });

  it('líder sin nadie delante', () => {
    const s = standingForLane(rivals(RIVALS), 1);
    expect(s?.position).toBe(1);
    expect(s?.aheadName).toBeNull();
    expect(s?.behindGapMs).toBe(546);
  });

  it('gap desconocido → null', () => {
    expect(standingForLane(rivals(RIVALS_EARLY), 1)?.behindGapMs).toBeNull();
  });

  it('carril que no está en la clasificación → null', () => {
    expect(standingForLane(rivals(RIVALS), 5)).toBeNull();
  });
});

describe('clasificarConfig', () => {
  const a = claveConfig([{ laneId: 2, name: 'Piloto 2' }, { laneId: 1, name: 'piloto 1' }]);
  const rotada = claveConfig([{ laneId: 1, name: 'Piloto 2' }, { laneId: 2, name: 'Piloto 1' }]);

  it('la huella no depende del orden ni de mayúsculas', () => {
    expect(claveConfig([{ laneId: 1, name: 'Piloto 1 ' }, { laneId: 2, name: 'PILOTO 2' }])).toBe(a);
  });

  it('distingue primer CONFIG, duplicado, reinicio y nueva manga', () => {
    expect(clasificarConfig({ claveAnterior: null, clave: a, vueltasCarrera: false })).toBe('misma-manga');
    expect(clasificarConfig({ claveAnterior: null, clave: a, vueltasCarrera: true })).toBe('nueva-manga');
    expect(clasificarConfig({ claveAnterior: a, clave: a, vueltasCarrera: false })).toBe('duplicado');
    expect(clasificarConfig({ claveAnterior: a, clave: a, vueltasCarrera: true })).toBe('reinicio');
    expect(clasificarConfig({ claveAnterior: a, clave: rotada, vueltasCarrera: true })).toBe('nueva-manga');
    expect(clasificarConfig({ claveAnterior: a, clave: rotada, vueltasCarrera: false })).toBe('misma-manga');
  });
});

describe('parseWsMessage — capturas de la demo (oct 2026)', () => {
  it('tanda libre: isRace false y sin posición', () => {
    const m = parseWsMessage('{"type":"LAP","frame":95,"laneId":6,"pilotName":"Carril 6","lapTime":16.0005,"isFastLap":false,"position":0,"isRace":false,"isFirstLap":false}');
    expect(m).toMatchObject({ type: 'LAP', isRace: false, position: null, lapTimeMs: 16000 });
  });

  it('CONFIG con la parrilla en rivals', () => {
    const m = parseWsMessage('{"type":"CONFIG","minAppVersionCode":1,"minAppVersion":"1.0","mangaPilots":[{"laneId":1,"name":"piloto 1"}],"rivals":[{"position":1,"name":"piloto 1","vme":0.0,"isRacing":true,"laneId":1,"gap":null}]}');
    expect(m).toEqual({ type: 'CONFIG', pilots: [{ laneId: 1, name: 'piloto 1' }], inicioCarrera: true });
  });
});

// Carrera simulada de 6 mangas de 1 min (oct 2026).
describe('mangas del TicTac nuevo', () => {
  const CONFIG_M2 = '{"type":"CONFIG","minAppVersionCode":1,"minAppVersion":"1.0","mangaPilots":[{"laneId":1,"name":"piloto 2"},{"laneId":2,"name":"Piloto 4"},{"laneId":3,"name":"piloto 1"},{"laneId":4,"name":"Piloto 6"},{"laneId":5,"name":"piloto 3"},{"laneId":6,"name":"Piloto 5"}],"rivals":[{"position":1,"name":"piloto 3","vme":30.0000,"isRacing":true,"laneId":3,"gap":0.0000},{"position":2,"name":"Piloto 5","vme":0.0,"isRacing":true,"laneId":5,"gap":null}]}';

  it('CONFIG con clasificación de mangas anteriores → no es inicio de carrera', () => {
    const m = parseWsMessage(CONFIG_M2);
    expect(m?.type === 'CONFIG' && m.inicioCarrera).toBe(false);
    expect(m?.type === 'CONFIG' && mangasPorRotacion(m.pilots)).toBe(6);
    expect(parseWsMessage(CONFIG)).toMatchObject({ inicioCarrera: null });   // rivals vacío
  });

  it('clasificación a cero', () => {
    const r = (vmeMs: number | null, gapMs: number | null): InfolapRival =>
      ({ position: 1, laneId: 1, name: 'x', vmeMs, gapMs, isRacing: true });
    expect(clasificacionACero([])).toBeNull();
    expect(clasificacionACero([r(null, null), r(null, 0)])).toBe(true);
    expect(clasificacionACero([r(null, null), r(30_000, 0)])).toBe(false);
  });

  it('con la clasificación del CONFIG: reinicio solo si viene a cero', () => {
    const a = claveConfig([{ laneId: 1, name: 'A' }, { laneId: 2, name: 'B' }]);
    // Mismos carriles pero clasificación con datos: la carrera sigue.
    expect(clasificarConfig({ claveAnterior: a, clave: a, vueltasCarrera: true, inicioCarrera: false })).toBe('nueva-manga');
    // Carriles distintos y clasificación a cero: carrera nueva.
    const b = claveConfig([{ laneId: 1, name: 'B' }, { laneId: 2, name: 'A' }]);
    expect(clasificarConfig({ claveAnterior: a, clave: b, vueltasCarrera: true, inicioCarrera: true })).toBe('reinicio');
    expect(clasificarConfig({ claveAnterior: a, clave: a, vueltasCarrera: false, inicioCarrera: true })).toBe('duplicado');
  });

  it('duración deducida del cierre de las mangas', () => {
    // CONFIG → fin medido en la simulación: 77 s (salida tardía) y 63 s.
    expect(aprenderDuracion([77_000, 63_000, 63_000])).toEqual({ duracionMs: 60_000, retardoMs: 3_000 });
    expect(aprenderDuracion([123_500])).toEqual({ duracionMs: 120_000, retardoMs: 3_500 });
    // Sobra demasiado para ser el semáforo: no se descuenta.
    expect(aprenderDuracion([140_000])).toEqual({ duracionMs: 120_000, retardoMs: 0 });
    expect(aprenderDuracion([])).toBeNull();
    expect(aprenderDuracion([45_000])).toBeNull();
  });
});
