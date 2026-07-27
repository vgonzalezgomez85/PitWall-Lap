// Cliente SlotTime (fuente preferida).
//
// Protocolo:
//   • Descubrimiento: mDNS `_voltrace-manager._tcp` (lo hace `discover()`).
//   • Bootstrap REST:
//       GET /api/mobile/races/current   → carrera activa + participantes
//   • Streaming socket.io:
//       manga:started/stopped/paused/resumed/cancelled
//       lap                  { lane, lapNumber, lapTimeMs, bestLapMs, name, color }
//       standings            (recálculo de gaps en cliente)
//       tick                 { elapsedMs }  → derivar remainingMs + avisos fin
//       lap:ghost            { lane, lapTimeMs }
//       lap:reassigned       { fromLane, toLane, lapTimeMs }
//       race:stats-snapshot  (dossier final para histórico offline)

import { io, type Socket } from 'socket.io-client';

import type {
  DataSource,
  LiveState,
  Participant,
  ParticipantPlan,
  PoleSnapshot,
  ProjectionRow,
  RaceInfo,
  RaceStatsSnapshot,
  SourceEvent,
  TireControlState,
} from './types';
import { SLOTTIME_CAPABILITIES, emptyLiveState } from './types';

// 30s antes de fin de manga: aviso "último minuto". 60s antes: ya pasó.
// Disparamos exactamente una vez por manga.
const LAST_MINUTE_MS = 60_000;
const LAST_30S_MS    = 30_000;

export interface SlotTimeServerLocation {
  host: string;
  port: number;
}

// ── Shapes de los eventos del servidor (sólo los campos que consumimos) ──

interface StandingsRow {
  lane: number;
  name: string;
  color: string;
  lapCount: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  avgLapMs: number | null;
  position: number;
  gap: number;
  exitCount?: number;
  pitStopCount?: number;
}

interface StandingsPayload {
  mangaId: number;
  raceId: number;
  elapsedMs: number;
  remainingMs: number;
  standings: StandingsRow[];
  /** Proyección general entre tandas. Puede faltar (servidor antiguo). */
  projection?: ProjectionRow[];
}

interface LapPayload {
  lane: number;
  name: string;
  color: string;
  lapNumber: number;
  lapTimeMs: number;
  bestLapMs: number | null;
  elapsedMs: number;
  isExit: boolean;
  isFirstCrossing?: boolean;
}

interface RaceCurrentResponse {
  race: {
    id: number;
    name: string;
    format: 'team' | 'individual';
    type: string;
    status: string;
    lanesCount: number;
    mangaDurationMin: number;
    startedAt: string | null;
  } | null;
  activeManga: {
    id: number;
    number: number;
    tandaNum: number;
    startedAt: string | null;
  } | null;
  participants: (ParticipantPlan & { id: number | string })[];
}

// GET /api/mobile/races/:id/tires
interface TiresResponse {
  raceId: number;
  allowance: number;
  teams: {
    id: number;
    name: string;
    color: string;
    used: number;
    available: number;
    changes: {
      setNumber: number;
      mangaNumber: number | null;
      raceElapsedMs: number | null;
      createdAtMs: number;
      note?: string | null;
    }[];
  }[];
}

// ── Fuente ────────────────────────────────────────────────────────────────

export type SlotTimeMode = 'race' | 'training' | 'pole';

export class SlotTimeSource implements DataSource {
  readonly kind = 'slottime' as const;

  private server: SlotTimeServerLocation;
  private mode: SlotTimeMode;
  /** Sólo modo 'race'. Si null, usa /api/mobile/races/current. */
  private raceId: number | null;
  private socket: Socket | null = null;
  private selectedId: string | null = null;
  private participants: ParticipantPlan[] = [];
  private mangaDurationMs = 0;
  /** baseUrl + id de carrera resueltos tras conectar, para refetch de tires. */
  private baseUrl = '';
  private resolvedRaceId: number | null = null;
  /** Último control de neumáticos conocido. Es la fuente de verdad: emitState()
   *  lo inyecta en cada snapshot, porque varios handlers reconstruyen
   *  currentState desde cero (p. ej. al seleccionar piloto) y lo borrarían. */
  private tireControlState: TireControlState | null = null;
  private currentMangaNum: number | null = null;
  /** Tanda de la manga activa. La numeración de manga es POR TANDA (tanda 2
   *  vuelve a manga 1), así que hace falta la tanda para identificar la manga. */
  private currentTandaNum: number | null = null;
  private stateListeners: ((s: LiveState) => void)[] = [];
  private eventListeners: ((e: SourceEvent) => void)[] = [];
  private snapshotListeners: ((s: RaceStatsSnapshot) => void)[] = [];
  private currentState: LiveState = emptyLiveState();
  private firedHalfManga = false;
  private firedLastMinute = false;
  private firedLast30s = false;
  private prevPosition: number | null = null;
  // ── Pole ────────────────────────────────────────────────────────────────
  private polePollTimer: ReturnType<typeof setInterval> | null = null;
  private poleBaseUrl: string | null = null;
  /** Última `live.lapCount` vista para detectar nuevas vueltas. */
  private polePrevLapCount = 0;
  /** Última `currentEntry.entryId` vista para detectar cambio de piloto. */
  private polePrevCurrentEntryId: number | null = null;
  /** Último `status` visto para detectar 'done'. */
  private polePrevStatus: PoleSnapshot['status'] = null;

  constructor(
    server: SlotTimeServerLocation,
    raceIdOrOpts?: number | { mode: SlotTimeMode; raceId?: number },
  ) {
    this.server = server;
    if (typeof raceIdOrOpts === 'number') {
      this.mode = 'race';
      this.raceId = raceIdOrOpts;
    } else if (raceIdOrOpts) {
      this.mode = raceIdOrOpts.mode;
      this.raceId = raceIdOrOpts.raceId ?? null;
    } else {
      this.mode = 'race';
      this.raceId = null;
    }
  }

  async connect(): Promise<RaceInfo> {
    const baseUrl = `http://${this.server.host}:${this.server.port}`;

    if (this.mode === 'training') {
      return this.connectTraining(baseUrl);
    }
    if (this.mode === 'pole') {
      return this.connectPole(baseUrl);
    }
    return this.connectRace(baseUrl);
  }

  // ── Conexión modo carrera ──────────────────────────────────────────────

  private async connectRace(baseUrl: string): Promise<RaceInfo> {
    const path = this.raceId != null
      ? `/api/mobile/races/${this.raceId}`
      : `/api/mobile/races/current`;
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) throw new Error(`slottime-bootstrap-${res.status}`);
    const data: RaceCurrentResponse = await res.json();

    if (!data.race) {
      throw new Error('slottime-no-active-race');
    }

    this.participants = data.participants.map(p => ({
      id: String(p.id),
      name: p.name,
      color: p.color,
      mangas: p.mangas,
    }));
    this.mangaDurationMs = data.race.mangaDurationMin * 60_000;
    this.currentMangaNum = data.activeManga?.number ?? null;
    this.currentTandaNum = data.activeManga?.tandaNum ?? null;
    this.baseUrl = baseUrl;
    this.resolvedRaceId = data.race.id;
    this.currentState = {
      ...emptyLiveState(),
      currentMangaNum: this.currentMangaNum,
    };

    this.socket = io(baseUrl, { transports: ['websocket'], reconnection: true, query: { client: 'mobile' } });
    this.wireSocket(this.socket);

    // Control de neumáticos (dotación + cambios). No bloquea el arranque; si la
    // carrera no lleva control, deja tireControl en null.
    void this.fetchTires();

    return {
      source: 'slottime',
      raceId: data.race.id,
      name: data.race.name,
      format: data.race.format,
      participants: this.participants.map(p => ({ id: p.id, name: p.name, color: p.color })),
      participantsPlan: this.participants,
      capabilities: SLOTTIME_CAPABILITIES,
    };
  }

  // ── Conexión modo entrenamiento ────────────────────────────────────────

  private async connectTraining(baseUrl: string): Promise<RaceInfo> {
    const res = await fetch(`${baseUrl}/api/mobile/training`);
    if (!res.ok) throw new Error(`slottime-training-${res.status}`);
    const data: {
      active: boolean;
      durationMs: number | null;
      lanes: { lane: number; color: string; count: number; avgMs: number | null; bestMs: number | null; lastMs: number | null }[];
    } = await res.json();

    if (!data.active) {
      throw new Error('slottime-no-training-active');
    }

    // En entrenamiento cada carril es un "participante" para el selector.
    this.participants = data.lanes.map(l => ({
      id: String(l.lane),
      name: `Carril ${l.lane}`,
      color: l.color,
      mangas: [],
    }));
    this.mangaDurationMs = data.durationMs ?? 0;
    this.currentMangaNum = null;
    this.currentState = emptyLiveState();

    this.socket = io(baseUrl, { transports: ['websocket'], reconnection: true, query: { client: 'mobile' } });
    this.wireTrainingSocket(this.socket);

    return {
      source: 'slottime',
      mode: 'training',
      name: 'Entrenamiento',
      format: 'individual',
      participants: this.participants.map(p => ({ id: p.id, name: p.name, color: p.color })),
      // En entrenamiento no hay plan de mangas
      capabilities: { ...SLOTTIME_CAPABILITIES, multiMangaPlan: false, history: false },
    };
  }

  disconnect(): void {
    if (this.socket) {
      try { this.socket.disconnect(); } catch { /* ignore */ }
      this.socket = null;
    }
    if (this.polePollTimer) {
      clearInterval(this.polePollTimer);
      this.polePollTimer = null;
    }
    this.stateListeners = [];
    this.eventListeners = [];
    this.snapshotListeners = [];
    this.tireControlState = null;
    this.resolvedRaceId = null;
  }

  // ── Conexión modo pole ────────────────────────────────────────────────

  private async connectPole(baseUrl: string): Promise<RaceInfo> {
    if (this.raceId == null) throw new Error('slottime-pole-no-race-id');
    this.poleBaseUrl = baseUrl;

    // Cargar carrera (para nombre / formato) + estado actual de la pole.
    const [raceRes, poleRes] = await Promise.all([
      fetch(`${baseUrl}/api/mobile/races/${this.raceId}`),
      fetch(`${baseUrl}/api/mobile/races/${this.raceId}/pole`),
    ]);
    if (!raceRes.ok) throw new Error(`slottime-pole-race-${raceRes.status}`);
    if (!poleRes.ok) throw new Error(`slottime-pole-${poleRes.status}`);
    const raceData: RaceCurrentResponse = await raceRes.json();
    const poleData: PoleSnapshot = await poleRes.json();

    if (!raceData.race) throw new Error('slottime-pole-race-not-found');
    // Si no hay sesión de pole alguna, no tiene sentido entrar. Pero si
    // está terminada (`status='done'`) sí cargamos el snapshot — la
    // pantalla lo detectará y redirigirá al picker de tandas.
    if (!poleData.active && poleData.status !== 'done') {
      throw new Error('slottime-pole-not-active');
    }

    // Participantes = entries de la pole. El id que usamos en la app es
    // el entryId como string (lo elige el usuario en el picker).
    this.participants = poleData.startingOrder.map(e => ({
      id: String(e.entryId),
      name: e.name,
      color: '#f6c90e',
      mangas: [],
    }));

    this.currentState = { ...emptyLiveState(), pole: poleData };
    this.polePrevLapCount = poleData.live?.lapCount ?? 0;
    this.polePrevCurrentEntryId = poleData.currentEntry?.entryId ?? null;
    this.polePrevStatus = poleData.status;

    // Polling de /pole para refrescar standings/order/live cada 2 s. Más
    // simple que cablear 6 eventos socket distintos. La vuelta cantable no
    // depende de esto (llega instantánea por socket), así que 2 s basta para
    // standings/gaps y reduce el tráfico WiFi a la mitad (ahorro de batería).
    this.polePollTimer = setInterval(() => this.refreshPole(), 2000);

    // Socket adicional para capturar la vuelta cantable en cuanto cruza.
    this.socket = io(baseUrl, { transports: ['websocket'], reconnection: true, query: { client: 'mobile' } });
    this.wirePoleSocket(this.socket);

    return {
      source: 'slottime',
      mode: 'pole',
      name: `${raceData.race.name} · Pole`,
      format: raceData.race.format,
      participants: this.participants.map(p => ({ id: p.id, name: p.name, color: p.color })),
      capabilities: { ...SLOTTIME_CAPABILITIES, multiMangaPlan: false, history: false },
    };
  }

  private async refreshPole(): Promise<void> {
    if (!this.poleBaseUrl || this.raceId == null) return;
    try {
      const res = await fetch(`${this.poleBaseUrl}/api/mobile/races/${this.raceId}/pole`);
      if (!res.ok) return;
      const snap: PoleSnapshot = await res.json();
      this.applyPoleSnapshot(snap);
    } catch {
      /* red flaky — el siguiente tick lo recoge */
    }
  }

  /** Aplica un snapshot de /pole al estado y dispara eventos discretos. */
  private applyPoleSnapshot(snap: PoleSnapshot): void {
    const prevStatus = this.polePrevStatus;
    const prevCurrentId = this.polePrevCurrentEntryId;
    const prevLapCount = this.polePrevLapCount;
    this.polePrevStatus = snap.status;
    this.polePrevCurrentEntryId = snap.currentEntry?.entryId ?? null;
    this.polePrevLapCount = snap.live?.lapCount ?? 0;

    const selectedEntryId = this.selectedId != null ? parseInt(this.selectedId, 10) : null;
    const isMyTurn = selectedEntryId != null && snap.currentEntry?.entryId === selectedEntryId;

    this.currentState = {
      ...this.currentState,
      pole: snap,
      status: snap.status === 'done'
        ? 'race-finished'
        : isMyTurn ? 'my-turn' : (selectedEntryId != null ? 'resting' : 'pre-race'),
      myLane: isMyTurn ? snap.poleLane : null,
      lapCount: isMyTurn ? (snap.live?.lapCount ?? 0) : 0,
      bestLapMs: isMyTurn ? (snap.live?.bestLapMs ?? null) : null,
      remainingMs: isMyTurn ? (snap.live?.remainingMs ?? null) : null,
      totalParticipants: snap.totalCount,
    };
    this.emitState();

    // Cambio de piloto en pista — útil para anunciar el siguiente.
    if (snap.currentEntry?.entryId !== prevCurrentId
        && snap.currentEntry
        && snap.currentEntry.entryId === selectedEntryId) {
      // Mi turno acaba de empezar.
      this.emitEvent({
        type: 'manga-changed',
        newMangaNum: snap.currentEntry.startPos,
        newLane: snap.poleLane,
      });
    }

    // Fin de la pole.
    if (snap.status === 'done' && prevStatus !== 'done') {
      this.emitEvent({ type: 'race-finished' });
    }

    // Nueva vuelta cuando el polling la ve antes que el socket (red lenta).
    if (isMyTurn && snap.live && snap.live.lapCount > prevLapCount) {
      // No tenemos el lapTimeMs aquí — el evento de socket lo cubre.
      // Si llega solo por polling, emitimos sin tiempo concreto.
      // (lapTimeMs en SourceEvent es number|null y la voz tolera null.)
    }
  }

  private wirePoleSocket(socket: Socket): void {
    socket.on('connect',    () => this.emitEvent({ type: 'connection-restored' }));
    socket.on('disconnect', () => this.emitEvent({ type: 'connection-lost' }));

    socket.on('pole:lap', (p: { lapNumber: number; lapTimeMs: number; bestLapMs: number; improved: boolean }) => {
      const snap = this.currentState.pole;
      const selectedEntryId = this.selectedId != null ? parseInt(this.selectedId, 10) : null;
      if (snap?.currentEntry?.entryId !== selectedEntryId) return; // no es mi vuelta
      this.emitEvent({ type: 'lap-completed', lapTimeMs: p.lapTimeMs, lapCount: p.lapNumber });
    });

    // Estos eventos solo son señales para refrescar antes — el polling ya
    // los recoge en el siguiente tick pero esto baja la latencia.
    socket.on('pole:standby',  () => this.refreshPole());
    socket.on('pole:started',  () => this.refreshPole());
    socket.on('pole:finished', () => this.refreshPole());
    socket.on('pole:aborted',  () => this.refreshPole());
  }

  selectParticipant(id: string): void {
    this.selectedId = id;
    this.prevPosition = null;
    this.firedHalfManga = false;
    this.firedLastMinute = false;
    this.firedLast30s = false;

    const me = this.participants.find(p => p.id === id);
    const selfName = me?.name ?? null;

    if (this.mode === 'training') {
      // En entrenamiento el id == número de carril. Siempre "my-turn".
      const myLane = parseInt(id, 10);
      this.currentState = {
        ...emptyLiveState(),
        status: 'my-turn',
        myLane: Number.isFinite(myLane) ? myLane : null,
        selfName,
      };
    } else if (this.mode === 'pole') {
      // En pole el id es el entryId. El estado real lo deriva el polling
      // a partir del snapshot, así que aquí solo guardamos selectedId y
      // reaplicamos el último snapshot conocido. El selfName lo aporta
      // applyPoleSnapshot al construir el currentState.
      this.currentState = { ...this.currentState, selfName };
      const snap = this.currentState.pole;
      if (snap) this.applyPoleSnapshot(snap);
      else this.emitState();
      return;
    } else {
      // Antes de que arranque ninguna manga (currentMangaNum == null) la carrera
      // está en PRE-CARRERA: no es "descanso" (no hay manga corriendo), así que
      // mostramos su PRIMERA manga/carril (o que descansa toda la carrera).
      const preRace = this.currentMangaNum == null;
      const myLane = this.findMyLaneForCurrentManga(id);
      const upcoming = preRace
        ? this.findMyFirstTurn(id)
        : (myLane == null ? this.findMyNextManga(id) : undefined);
      this.currentState = {
        ...emptyLiveState(),
        status: preRace ? 'pre-race' : (myLane != null ? 'my-turn' : 'resting'),
        myLane,
        selfName,
        currentMangaNum: this.currentMangaNum,
        nextMangaInfo: upcoming,
        // FINAL: descansa la manga actual (hay una en curso) y no le queda
        // ninguna manga futura → ya corrió todas las suyas.
        isFinal: myLane == null && this.currentMangaNum != null && upcoming == null,
      };
    }
    this.emitState();
  }

  onStateChange(cb: (s: LiveState) => void): () => void {
    this.stateListeners.push(cb);
    cb(this.currentState);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== cb);
    };
  }

  onEvent(cb: (e: SourceEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== cb);
    };
  }

  onRaceStatsSnapshot(cb: (s: RaceStatsSnapshot) => void): () => void {
    this.snapshotListeners.push(cb);
    return () => {
      this.snapshotListeners = this.snapshotListeners.filter(l => l !== cb);
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private wireSocket(socket: Socket): void {
    socket.on('connect', () => {
      console.log('[SlotTime] socket connected');
      // Si ya hay una manga corriendo cuando entramos, pedimos standings
      // inicial para empezar a pintar inmediatamente.
      socket.emit('standings:request');
      // Tras una reconexión el control de neumáticos pudo cambiar mientras no
      // había socket (el evento tires:changed se perdió): re-sincronizamos.
      void this.fetchTires();
      this.emitEvent({ type: 'connection-restored' });
    });
    socket.on('disconnect', () => {
      console.log('[SlotTime] socket disconnected');
      this.emitEvent({ type: 'connection-lost' });
    });

    socket.on('manga:started', async () => {
      console.log('[SlotTime] manga:started → refetching current race');
      this.firedHalfManga = false;
      this.firedLastMinute = false;
      this.firedLast30s = false;
      // El servidor empezó una nueva manga. Si la app se conectó antes
      // (con currentMangaNum = null), necesitamos refrescar el número de
      // manga actual y re-evaluar el carril del piloto seleccionado.
      await this.refreshCurrentManga();
      if (this.selectedId) this.selectParticipant(this.selectedId);
      socket.emit('standings:request');
      this.emitEvent({ type: 'race-started' });
    });

    socket.on('manga:stopped', (payload: { nextMangaId: number | null; nextLanes?: unknown }) => {
      this.emitEvent({ type: 'race-finished' });
      // Si hay próxima manga, recalculamos cuál es mi carril ahora.
      if (this.selectedId && payload?.nextMangaId != null) {
        // El servidor expone el nuevo manga via subsiguiente standings; aquí
        // sólo reseteamos el turno-aware.
        this.reevaluateMangaForSelected();
      }
    });

    socket.on('standings', (payload: StandingsPayload) => this.onStandings(payload));
    socket.on('lap',       (payload: LapPayload)       => this.onLap(payload));
    socket.on('tick',      (payload: { elapsedMs: number }) => this.onTick(payload));

    socket.on('lap:ghost', (p: { lane: number; lapTimeMs: number }) => {
      this.emitEvent({ type: 'lap-ghost', lane: p.lane, lapTimeMs: p.lapTimeMs });
    });

    socket.on('lap:reassigned', (p: { fromLane: number; toLane: number; lapTimeMs: number; name?: string }) => {
      // NO emitimos lap-completed: la vuelta reasignada cuenta a MEDIA del
      // carril, no al tiempo (falso, rápido) del fantasma — anunciarla como
      // "vuelta rápida" era incorrecto. La voz lo trata como reasignación.
      this.emitEvent({
        type: 'lap-reassigned',
        fromLane: p.fromLane, toLane: p.toLane, lapTimeMs: p.lapTimeMs,
        toName: p.name ?? null,
      });
    });

    // El operador entregó/editó/borró un juego en PitWall Manager. El evento es
    // global y sólo trae { raceId }; refrescamos el control de neumáticos.
    socket.on('tires:changed', (p: { raceId?: number }) => {
      if (p?.raceId != null && this.resolvedRaceId != null && p.raceId !== this.resolvedRaceId) return;
      void this.fetchTires();
    });

    socket.on('race:stats-snapshot', (snap: RaceStatsSnapshot) => {
      // Enriquecemos con la baseUrl del servidor para que el cliente
      // pueda reconstruir URLs (ej. la del Excel comparativa) más tarde.
      const enriched: RaceStatsSnapshot = {
        ...snap,
        serverBaseUrl: `http://${this.server.host}:${this.server.port}`,
      };
      for (const l of this.snapshotListeners) l(enriched);
    });
  }

  private onStandings(payload: StandingsPayload): void {
    console.log('[SlotTime] standings myLane=', this.currentState.myLane,
      'standings.lanes=', payload.standings.map(r => r.lane).join(','));

    // El servidor puede tener una duración de sesión real distinta a la
    // configurada en la BD (el GO del DS-300 puede traer su propia
    // duración). Confiamos en lo que diga el servidor: derivamos la
    // duración real de elapsed + remaining y la usamos para los ticks
    // siguientes.
    if (payload.elapsedMs > 0 && payload.remainingMs >= 0) {
      this.mangaDurationMs = payload.elapsedMs + payload.remainingMs;
    }

    let myLane = this.currentState.myLane;
    if (myLane == null) {
      // Estoy descansando: sólo actualizo el contexto general.
      this.currentState = {
        ...this.currentState,
        totalParticipants: payload.standings.length,
        remainingMs: payload.remainingMs,
      };
      this.emitState();
      return;
    }

    let me = payload.standings.find(r => r.lane === myLane);
    // Blindaje: si la fila de mi carril no es el equipo seguido (plan
    // desfasado con la asignación real), lo localizamos por nombre de forma
    // INEQUÍVOCA (una sola fila) y corregimos el carril. Si hay ambigüedad o
    // no coincide, dejamos el carril del plan (no arriesgamos).
    const selfName = this.currentState.selfName;
    if (selfName && (!me || me.name !== selfName)) {
      const byName = payload.standings.filter(r => r.name === selfName);
      if (byName.length === 1) {
        me = byName[0];
        myLane = me!.lane;
        this.currentState = { ...this.currentState, myLane };
        console.log('[SlotTime] carril corregido por nombre →', myLane);
      }
    }
    if (!me) return;

    // Mi fila en la proyección general (clasificación ESTIMADA entre tandas).
    // El id del participante en la app es el entityId del servidor; como una
    // carrera es solo equipos o solo pilotos, basta el id. Fallback por nombre.
    const proj = payload.projection ?? [];
    let pIdx = proj.findIndex(p => String(p.entityId) === this.selectedId);
    if (pIdx < 0) pIdx = proj.findIndex(p => p.name === me.name);
    const myProj = pIdx >= 0 ? proj[pIdx]! : null;
    const projAhead  = pIdx > 0 ? proj[pIdx - 1]! : undefined;
    const projBehind = (pIdx >= 0 && pIdx < proj.length - 1) ? proj[pIdx + 1]! : undefined;
    // Gap por clasificación ESTIMADA (gapV del servidor, redondeado).
    const pGapAhead  = (myProj && projAhead && myProj.gapV != null) ? Math.round(myProj.gapV) : null;
    const pGapBehind = (projBehind && projBehind.gapV != null) ? Math.round(projBehind.gapV) : null;

    // Vecinos por ORDEN DE MANGA — fallback cuando la proyección no da valor
    // (líder sin media aún, o no llega proyección) para no mostrar "—".
    const sorted = [...payload.standings].sort((a, b) => a.position - b.position);
    const mIdx = sorted.findIndex(r => r.lane === myLane);
    const mAhead  = mIdx > 0 ? sorted[mIdx - 1] : undefined;
    const mBehind = (mIdx >= 0 && mIdx < sorted.length - 1) ? sorted[mIdx + 1] : undefined;
    const mGapAhead  = mAhead  ? mAhead.lapCount - me.lapCount  : null;
    const mGapBehind = mBehind ? me.lapCount - mBehind.lapCount : null;

    // Preferimos la clasificación estimada; si no, la manga.
    const useProjAhead  = pGapAhead  != null;
    const useProjBehind = pGapBehind != null;
    const gapAheadLaps  = useProjAhead  ? pGapAhead  : mGapAhead;
    const gapBehindLaps = useProjBehind ? pGapBehind : mGapBehind;
    const aheadName  = (useProjAhead  ? projAhead?.name  : mAhead?.name)  ?? null;
    const behindName = (useProjBehind ? projBehind?.name : mBehind?.name) ?? null;
    const gapAheadMs: number | null = null;   // ya no mostramos gap en tiempo
    const gapBehindMs: number | null = null;

    // Posición y total sobre la clasificación ESTIMADA (proyección general
    // entre tandas); si no hay proyección, caemos a la de la manga.
    const shownPosition = myProj?.position ?? me.position;
    const totalParticipants = proj.length > 0 ? proj.length : payload.standings.length;

    // Detectar cambio de posición (sobre la posición que mostramos).
    if (this.prevPosition != null && this.prevPosition !== shownPosition) {
      this.emitEvent({ type: 'position-changed', from: this.prevPosition, to: shownPosition });
    }
    this.prevPosition = shownPosition;

    this.currentState = {
      ...this.currentState,
      status: 'my-turn',
      lapCount: me.lapCount,
      lastLapMs: me.lastLapMs,
      bestLapMs: me.bestLapMs,
      avgLapMs: me.avgLapMs,
      exitCount: me.exitCount ?? 0,
      pitStopCount: me.pitStopCount ?? 0,
      position: shownPosition,
      totalParticipants,
      remainingMs: payload.remainingMs,
      gapAheadMs,
      gapBehindMs,
      gapAheadLaps,
      gapBehindLaps,
      aheadName,
      behindName,
      avgToCatchMs:   myProj?.avgToCatch ?? null,
      projectedTotal: myProj?.projectedTotal ?? null,
      projection:     payload.projection ?? null,
    };
    this.emitState();
  }

  private onLap(payload: LapPayload): void {
    // Vuelta de CUALQUIER entidad → estrategia de rivales (Fase 2). Se emite
    // antes del filtro por carril propio.
    this.emitEvent({
      type: 'entity-lap',
      lane: payload.lane,
      name: payload.name,
      lapTimeMs: payload.lapTimeMs,
      lapNumber: payload.lapNumber,
      isExit: payload.isExit,
      isFirstCrossing: payload.isFirstCrossing,
    });

    const myLane = this.currentState.myLane;
    if (myLane == null || payload.lane !== myLane) return;
    // Standings ya nos actualiza el conteo; este evento dispara la voz y
    // alimenta la estrategia del piloto propio (los flags permiten excluir
    // salidas y la primera vuelta).
    this.emitEvent({
      type: 'lap-completed',
      lapTimeMs: payload.lapTimeMs,
      lapCount: payload.lapNumber,
      isExit: payload.isExit,
      isFirstCrossing: payload.isFirstCrossing,
    });
  }

  private onTick(payload: { elapsedMs: number; remainingMs?: number }): void {
    // Preferir remainingMs del servidor si lo envía (es la fuente de
    // verdad — la duración del session puede ser distinta a la configurada
    // en la BD si el GO del DS-300 vino con su propia duración).
    const remainingMs = payload.remainingMs ?? Math.max(0, this.mangaDurationMs - payload.elapsedMs);
    this.currentState = { ...this.currentState, remainingMs };
    this.emitState();

    // Mitad de manga: cuando ya ha transcurrido la mitad del tiempo (queda
    // la mitad o menos). Exigimos que aún quede más de un minuto para no
    // solaparlo con el aviso de último minuto en mangas muy cortas.
    if (
      !this.firedHalfManga &&
      this.mangaDurationMs > 0 &&
      remainingMs <= this.mangaDurationMs / 2 &&
      remainingMs > LAST_MINUTE_MS
    ) {
      this.firedHalfManga = true;
      this.emitEvent({ type: 'half-manga' });
    }
    if (!this.firedLastMinute && remainingMs <= LAST_MINUTE_MS && remainingMs > LAST_30S_MS) {
      this.firedLastMinute = true;
      this.emitEvent({ type: 'last-minute' });
    }
    if (!this.firedLast30s && remainingMs <= LAST_30S_MS && remainingMs > 0) {
      this.firedLast30s = true;
      this.emitEvent({ type: 'last-30s' });
    }
  }

  // ── Sockets modo training ──────────────────────────────────────────────

  private wireTrainingSocket(socket: Socket): void {
    socket.on('connect',    () => this.emitEvent({ type: 'connection-restored' }));
    socket.on('disconnect', () => this.emitEvent({ type: 'connection-lost' }));

    socket.on('training:go', (payload: { durationMs: number }) => {
      this.mangaDurationMs = payload.durationMs;
      this.firedHalfManga = false;
      this.firedLastMinute = false;
      this.firedLast30s = false;
      this.emitEvent({ type: 'race-started' });
    });

    socket.on('training:lap', (payload: {
      lane: number; lapTimeMs: number; bestMs: number | null; avgMs: number | null; count: number;
    }) => {
      const myLane = this.currentState.myLane;
      if (myLane == null || payload.lane !== myLane) return;
      this.currentState = {
        ...this.currentState,
        lapCount: payload.count,
        lastLapMs: payload.lapTimeMs,
        bestLapMs: payload.bestMs ?? this.currentState.bestLapMs,
        avgLapMs: payload.avgMs,
      };
      this.emitState();
      this.emitEvent({
        type: 'lap-completed',
        lapTimeMs: payload.lapTimeMs,
        lapCount: payload.count,
      });
    });

    socket.on('training:standby', () => {
      // Sesión de entrenamiento detenida o reseteada — limpiamos contadores.
      this.currentState = {
        ...this.currentState,
        lapCount: 0,
        lastLapMs: null,
        bestLapMs: null,
        avgLapMs: null,
      };
      this.emitState();
    });
  }

  private async refreshCurrentManga(): Promise<void> {
    try {
      const baseUrl = `http://${this.server.host}:${this.server.port}`;
      // Mismo principio que connect(): si seguimos una carrera concreta,
      // refrescamos su detalle; si no, caemos a "current".
      const path = this.raceId != null
        ? `/api/mobile/races/${this.raceId}`
        : `/api/mobile/races/current`;
      const res = await fetch(`${baseUrl}${path}`);
      if (!res.ok) return;
      const data: RaceCurrentResponse = await res.json();
      this.currentMangaNum = data.activeManga?.number ?? null;
      this.currentTandaNum = data.activeManga?.tandaNum ?? null;
      this.mangaDurationMs = data.race ? data.race.mangaDurationMin * 60_000 : this.mangaDurationMs;
      // Actualizar plan por si añadieron mangas nuevas
      if (data.participants) {
        this.participants = data.participants.map(p => ({
          id: String(p.id),
          name: p.name,
          color: p.color,
          mangas: p.mangas,
        }));
      }
      console.log('[SlotTime] refreshCurrentManga → currentMangaNum =', this.currentMangaNum);
    } catch (e) {
      console.log('[SlotTime] refreshCurrentManga failed:', e);
    }
  }

  private findMyLaneForCurrentManga(id: string): number | null {
    if (this.currentMangaNum == null) return null;
    const p = this.participants.find(x => x.id === id);
    // Numeración por tanda → hay que casar (tanda, manga). Si no conocemos la
    // tanda (server antiguo), caemos a solo mangaNum.
    const slot = p?.mangas.find(m =>
      m.mangaNum === this.currentMangaNum &&
      (this.currentTandaNum == null || m.tandaNum === this.currentTandaNum));
    if (!slot || slot.isRest) return null;
    return slot.lane;
  }

  /** Está DESPUÉS de la manga actual en orden (tanda, manga). */
  private isAfterCurrent(m: { tandaNum: number; mangaNum: number }): boolean {
    if (this.currentMangaNum == null) return false;
    if (this.currentTandaNum == null) return m.mangaNum > this.currentMangaNum;
    return m.tandaNum > this.currentTandaNum
      || (m.tandaNum === this.currentTandaNum && m.mangaNum > this.currentMangaNum);
  }

  private findMyNextManga(id: string): { mangaNum: number; lane: number } | undefined {
    const p = this.participants.find(x => x.id === id);
    if (!p || this.currentMangaNum == null) return undefined;
    const next = p.mangas
      .filter(m => !m.isRest && this.isAfterCurrent(m))
      .sort((a, b) => a.tandaNum - b.tandaNum || a.mangaNum - b.mangaNum)[0];
    return next ? { mangaNum: next.mangaNum, lane: next.lane } : undefined;
  }

  /** Primera manga en la que corre el piloto (la más temprana no-descanso de su
   *  plan). Para la vista de PRE-CARRERA. undefined = no corre ninguna manga. */
  private findMyFirstTurn(id: string): { mangaNum: number; lane: number } | undefined {
    const p = this.participants.find(x => x.id === id);
    if (!p) return undefined;
    const first = p.mangas
      .filter(m => !m.isRest)
      .sort((a, b) => a.tandaNum - b.tandaNum || a.mangaNum - b.mangaNum)[0];
    return first ? { mangaNum: first.mangaNum, lane: first.lane } : undefined;
  }

  private reevaluateMangaForSelected(): void {
    if (!this.selectedId) return;
    this.currentMangaNum = (this.currentMangaNum ?? 0) + 1;
    this.firedHalfManga = false;
    this.firedLastMinute = false;
    this.firedLast30s = false;
    this.prevPosition = null;
    const myLane = this.findMyLaneForCurrentManga(this.selectedId);
    const next = myLane == null ? this.findMyNextManga(this.selectedId) : undefined;
    this.currentState = {
      ...emptyLiveState(),
      status: myLane != null ? 'my-turn' : 'resting',
      myLane,
      // Preservar el nombre seguido: sin esto desaparecía entre mangas.
      selfName: this.currentState.selfName,
      currentMangaNum: this.currentMangaNum,
      nextMangaInfo: next,
      isFinal: myLane == null && this.currentMangaNum != null && next == null,
    };
    if (myLane != null) {
      this.emitEvent({ type: 'manga-changed', newMangaNum: this.currentMangaNum, newLane: myLane });
    }
    this.emitState();
  }

  private emitState(): void {
    // Inyecta siempre el control de neumáticos: es un campo transversal que los
    // handlers que reconstruyen currentState desde emptyLiveState() perderían.
    if (this.currentState.tireControl !== this.tireControlState) {
      this.currentState = { ...this.currentState, tireControl: this.tireControlState };
    }
    for (const l of this.stateListeners) l(this.currentState);
  }

  /** Consulta el control de neumáticos de la carrera y lo mete en el estado.
   *  Silencioso ante fallos (control opcional): si algo va mal deja el
   *  `tireControl` como estaba. `allowance = 0` = carrera sin control. */
  private async fetchTires(): Promise<void> {
    if (!this.baseUrl || this.resolvedRaceId == null) return;
    try {
      const res = await fetch(`${this.baseUrl}/api/mobile/races/${this.resolvedRaceId}/tires`);
      if (!res.ok) return;
      const data: TiresResponse = await res.json();
      this.tireControlState = {
        allowance: data.allowance ?? 0,
        teams: (data.teams ?? []).map(t => ({
          name:      t.name,
          used:      t.used,
          available: t.available,
          changes:   (t.changes ?? []).map(c => ({
            setNumber:     c.setNumber,
            mangaNumber:   c.mangaNumber ?? null,
            raceElapsedMs: c.raceElapsedMs ?? null,
            createdAtMs:   c.createdAtMs,
          })),
        })),
      };
      this.emitState();
    } catch {
      // Servidor antiguo (sin endpoint) o red caída: control opcional, ignorar.
    }
  }

  private emitEvent(e: SourceEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}

// Para silenciar tsc sobre `Participant` no usado en este archivo (lo
// re-exporta types.ts).
export type { Participant };
