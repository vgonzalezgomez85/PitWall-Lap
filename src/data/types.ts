// Contrato común entre las dos fuentes de datos de la app (SlotTime e
// Infolap). La UI consume DataSource sin saber qué fuente está detrás.
//
// Cada fuente publica:
//   • un objeto RaceInfo estático tras conectar (lista de participantes
//     para el selector)
//   • un stream de LiveState (snapshot del estado actual del piloto)
//   • un stream de SourceEvent (eventos discretos: vuelta cerrada, cambio
//     de posición, último minuto, etc.) que alimenta la capa de voz
//
// La capacidad de cada fuente difiere; ver `SourceCapabilities` y la
// matriz documentada en project_slottime_mobile.md.

export type SourceKind = 'slottime' | 'infolap';

export interface Participant {
  /** SlotTime: team.id o driver.id; Infolap: el código `#001..#999`. */
  id: string;
  name: string;
  /** Color UI. SlotTime lo expone; Infolap no → undefined. */
  color?: string;
}

export interface ParticipantPlan extends Participant {
  /** Plan completo de mangas (sólo SlotTime). */
  mangas: {
    tandaNum: number;
    mangaNum: number;
    lane: number;
    isRest: boolean;
  }[];
}

export interface RaceInfo {
  source: SourceKind;
  /** 'training' / 'pole' cuando la fuente SlotTime corre en esos modos. */
  mode?: 'race' | 'training' | 'pole';
  /** Id de la carrera en el servidor (SlotTime). Clave de persistencia. */
  raceId?: number;
  /** Nombre legible de la carrera (SlotTime) o "InfoLap" si no hay otro. */
  name: string;
  /** Formato. Infolap se mapea siempre a 'individual'. */
  format: 'team' | 'individual';
  participants: Participant[];
  /** Sólo SlotTime: planning completo por participante. */
  participantsPlan?: ParticipantPlan[];
  capabilities: SourceCapabilities;
}

/** Qué señales puede entregar cada fuente. La UI/voz se degrada según esto. */
export interface SourceCapabilities {
  lapTimes: boolean;          // tiempo de cada vuelta
  positions: boolean;         // posición + cambios
  gaps: boolean;              // gap delante/detrás
  raceTimeRemaining: boolean; // último minuto / 30 s
  laneAverages: boolean;      // media de carril / proyectada
  multiMangaPlan: boolean;    // planning entre mangas
  history: boolean;           // carreras pasadas
}

/** Fila de la proyección general entre tandas que envía el servidor (Opción A)
 *  en el evento `standings`, ordenada por vueltas proyectadas. La calcula
 *  TimingService._buildProjection (col. "P/Subir" de la web). */
export interface ProjectionRow {
  position: number;          // posición GENERAL entre tandas (proyectada)
  entityId: number;
  entityType: 'team' | 'driver';
  name: string;
  total: number;             // vueltas reales acumuladas
  projectedTotal: number | null;
  gapV: number | null;       // gap en vueltas proyectadas al de delante
  avgToCatch: number | null; // ms/vuelta para alcanzar al de delante; null = N/A
  avgLapMs: number | null;   // media de carrera (todas las mangas)
}

/** Estado actual del piloto seleccionado. */
export interface LiveState {
  status:
    | 'pre-race'         // aún no empezó ninguna manga
    | 'my-turn'          // estoy corriendo ahora
    | 'resting'          // mi turno descansa esta manga
    | 'race-finished'    // carrera completa
    | 'disconnected';    // perdimos contacto con el servidor

  myLane: number | null;
  lapCount: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  avgLapMs: number | null;        // sólo SlotTime — media del carril
  exitCount: number;              // sólo SlotTime — salidas del carril
  pitStopCount: number;           // sólo SlotTime — pit stops del carril
  position: number | null;        // sólo SlotTime
  totalParticipants: number | null;
  remainingMs: number | null;     // sólo SlotTime
  gapAheadMs: number | null;      // sólo SlotTime (calculado en cliente)
  gapBehindMs: number | null;
  gapAheadLaps: number | null;    // diferencia de vueltas con el de delante
  gapBehindLaps: number | null;   // diferencia de vueltas con el de detrás
  aheadName: string | null;
  behindName: string | null;
  /** Ritmo medio (ms/vuelta) necesario para alcanzar al de delante en la
   *  clasificación proyectada. Lo calcula el servidor (col. P/Subir de la
   *  web); null = no aplica (líder, sin tiempo o inalcanzable). */
  avgToCatchMs: number | null;
  /** Proyección de vueltas al final de la carrera (la calcula el servidor). */
  projectedTotal: number | null;
  /** Proyección general completa (todas las entidades). La usa la estrategia
   *  de neumáticos para comparar con el rival de delante/detrás. */
  projection: ProjectionRow[] | null;
  currentMangaNum: number | null;
  /** Si estoy en descanso, info de mi próxima manga. */
  nextMangaInfo?: { mangaNum: number; lane: number };
  /** true si el piloto ya corrió TODAS sus mangas (no le quedan más) → FINAL,
   *  distinto de "descansa esta manga" (aún le quedan). */
  isFinal?: boolean;

  // ── Sesión de pole (sólo SlotTime, modo 'pole') ───────────────────────
  pole?: PoleSnapshot | null;

  // ── Rival seguido (sólo InfoLap) ──────────────────────────────────────
  /** Nombre del piloto propio seleccionado. */
  selfName?: string | null;
  /** Nombre del piloto que estoy siguiendo, o null si no sigo a nadie. */
  rivalName?: string | null;
  /** Gap estimado al rival en ms. >0 = voy por delante, <0 = voy detrás. */
  rivalGapMs?: number | null;
  /** Vueltas completadas por el rival. */
  rivalLapCount?: number | null;
}

/** Eventos discretos. La capa de voz los traduce a locuciones. */
export type SourceEvent =
  | { type: 'lap-completed';     lapTimeMs: number | null; lapCount: number; isExit?: boolean; isFirstCrossing?: boolean }
  // Vuelta de CUALQUIER entidad (no solo el seguido). La usa la estrategia de
  // neumáticos para modelar la goma de los rivales (Fase 2).
  | { type: 'entity-lap';        lane: number; name: string; lapTimeMs: number | null; lapNumber: number; isExit?: boolean; isFirstCrossing?: boolean }
  | { type: 'position-changed';  from: number; to: number }
  | { type: 'race-started' }
  | { type: 'half-manga' }
  | { type: 'last-minute' }
  | { type: 'last-30s' }
  | { type: 'race-finished' }
  | { type: 'manga-changed';     newMangaNum: number; newLane: number | null }
  // Sólo SlotTime: vuelta cuyo tiempo era < Pt (mínimo). El servidor
  // intenta reasignar automáticamente al carril "overdue" más probable.
  | { type: 'lap-ghost';         lane: number; lapTimeMs: number }
  // Sólo SlotTime: vuelta fantasma se ha transferido a otro carril.
  // Si `toLane === myLane` mi propio contador acaba de incrementarse.
  | { type: 'lap-reassigned';    fromLane: number; toLane: number; lapTimeMs: number; toName?: string | null }
  | { type: 'connection-lost' }
  | { type: 'connection-restored' };

/**
 * Dossier completo de estadísticas que el servidor SlotTime empuja al cliente
 * cuando una carrera entera termina (todas las mangas completadas). La app
 * persiste esto en AsyncStorage para que el histórico funcione offline.
 *
 * Sólo SlotTime emite snapshots. Infolap nunca llamará al callback.
 */
export interface RaceStatsSnapshot {
  raceId: number | string;
  name: string;
  format: 'team' | 'individual';
  startedAt: string;
  finishedAt: string;
  /** Ruta relativa al export Excel (combinar con la baseUrl del server). */
  excelPath?: string;
  /** Sólo se rellena en cliente al persistir: la baseUrl del servidor del
   *  que vino el snapshot, para poder reconstruir la URL del Excel
   *  después aunque cambies de servidor. */
  serverBaseUrl?: string;
  /** Ruta local (file://) del Excel ya descargado, para abrirlo sin conexión. */
  excelLocalPath?: string;
  standings: {
    position: number;
    entityId: number | string;
    entityType: 'team' | 'driver';
    name: string;
    color?: string;
    totalLaps: number;
    bestLapMs: number | null;
    avgLapMs: number | null;
    totalTimeMs: number | null;
    mangasRaced: number;
  }[];
  // Opcional v1: detalle por manga. Puede llegar luego en v1.1.
  mangas?: {
    mangaNum: number;
    tandaNum: number;
    durationMs: number;
    laneResults: {
      lane: number;
      entityName: string;
      laps: number;
      bestLapMs: number | null;
    }[];
  }[];
}

export interface DataSource {
  readonly kind: SourceKind;

  /** Conecta y devuelve la info estática de la sesión. */
  connect(): Promise<RaceInfo>;

  /** Cierra el socket / UDP, limpia listeners. */
  disconnect(): void;

  /** El usuario eligió un participante; la fuente filtra eventos para él. */
  selectParticipant(id: string): void;

  /**
   * Sólo InfoLap: seguir a otro piloto para los avisos de acercamiento.
   * `null` deja de seguir a nadie. Otras fuentes no lo implementan.
   */
  setRival?(id: string | null): void;

  /** Suscribirse al stream de estado. Devuelve función de unsubscribe. */
  onStateChange(cb: (state: LiveState) => void): () => void;

  /** Suscribirse al stream de eventos discretos. */
  onEvent(cb: (event: SourceEvent) => void): () => void;

  /**
   * Recibe el dossier final cuando termina la carrera. Sólo SlotTime emite
   * snapshots; Infolap nunca llama al callback. La UI guarda el snapshot en
   * el histórico local.
   */
  onRaceStatsSnapshot(cb: (snapshot: RaceStatsSnapshot) => void): () => void;
}

/** Snapshot del estado de una sesión de Pole Position (sólo SlotTime). */
export interface PoleSnapshot {
  active: boolean;
  status: 'setup' | 'in_progress' | 'done' | null;
  poleLane: number | null;
  durationMs: number | null;
  currentIdx: number;
  totalCount: number;
  currentEntry: { entryId: number; name: string; startPos: number } | null;
  nextEntry:    { entryId: number; name: string } | null;
  startingOrder: PoleEntry[];
  standings:     { entryId: number; pos: number; name: string; lapTimeMs: number }[];
  live: {
    elapsedMs: number;
    remainingMs: number;
    currentLapMs: number;
    bestLapMs: number | null;
    lapCount: number;
  } | null;
}

export interface PoleEntry {
  entryId: number;
  pos: number;
  name: string;
  lapTimeMs: number | null;
  done: boolean;
}

/** Helper: construir el snapshot vacío inicial. */
export function emptyLiveState(): LiveState {
  return {
    status: 'pre-race',
    myLane: null,
    lapCount: 0,
    lastLapMs: null,
    bestLapMs: null,
    avgLapMs: null,
    exitCount: 0,
    pitStopCount: 0,
    position: null,
    totalParticipants: null,
    remainingMs: null,
    gapAheadMs: null,
    gapBehindMs: null,
    gapAheadLaps: null,
    gapBehindLaps: null,
    aheadName: null,
    behindName: null,
    avgToCatchMs: null,
    projectedTotal: null,
    projection: null,
    currentMangaNum: null,
    pole: null,
    selfName: null,
    rivalName: null,
    rivalGapMs: null,
    rivalLapCount: null,
  };
}

export const SLOTTIME_CAPABILITIES: SourceCapabilities = {
  lapTimes: true,
  positions: true,
  gaps: true,
  raceTimeRemaining: true,
  laneAverages: true,
  multiMangaPlan: true,
  history: true,
};

export const INFOLAP_CAPABILITIES: SourceCapabilities = {
  lapTimes: true,
  positions: false,
  gaps: false,
  raceTimeRemaining: false,
  laneAverages: false,
  multiMangaPlan: false,
  history: false,
};
