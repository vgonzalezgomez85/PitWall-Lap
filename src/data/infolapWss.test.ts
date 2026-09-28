import { parseWsMessage, standingForLane, type InfolapRival } from './infolapWss';

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
