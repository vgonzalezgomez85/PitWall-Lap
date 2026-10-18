// Fuente «Asistente» (cronómetro manual de Radio). Implementa `DataSource`
// convirtiendo los mensajes `vuelta` que manda el móvil del asistente en
// `LiveState` / `SourceEvent`, igual que haría un cronómetro real.
//
// Vive en el móvil del PILOTO (y de los seguidores que miran los tiempos):
// el asistente es la fuente de verdad y envía cada tiempo ya calculado. Esta
// fuente solo los recibe por el bus de Radio y los traduce.
//
// Capacidades mínimas: solo tiempos de vuelta de un coche. Sin posición, gaps,
// tiempo restante ni plan de mangas. El historial se construye en el móvil
// (dossier local al acabar), como hace TicTac.

import type {
  DataSource, LiveState, RaceInfo, RaceStatsSnapshot, SourceEvent,
} from './types';
import { ASISTENTE_CAPABILITIES, emptyLiveState } from './types';
import { onMensajeRadio } from '../radio/bus';
import type { MensajeRadio } from '../radio/mensajes';

const pad = (n: number) => String(n).padStart(2, '0');

export class AsistenteSource implements DataSource {
  readonly kind = 'asistente' as const;

  private nombre: string;
  private lapsMs: number[] = [];
  private currentState: LiveState = emptyLiveState();
  private active = false;
  private offBus: (() => void) | null = null;
  private startedAt = new Date();
  /** Vuelta objetivo del asistente (ms), o null sin objetivo. */
  private objetivoMs: number | null = null;

  private stateListeners: ((s: LiveState) => void)[] = [];
  private eventListeners: ((e: SourceEvent) => void)[] = [];
  private snapshotListeners: ((s: RaceStatsSnapshot) => void)[] = [];

  constructor(nombre: string) {
    this.nombre = nombre;
  }

  async connect(): Promise<RaceInfo> {
    this.active = true;
    this.startedAt = new Date();
    this.lapsMs = [];
    this.currentState = {
      ...emptyLiveState(),
      status: 'pre-race',
      selfName: this.nombre,
      totalParticipants: 2, // piloto + asistente
    };
    // Los mensajes de Radio llegan por el bus global (los publica el
    // RadioContext cuando el canal de datos entrega un mensaje).
    this.offBus = onMensajeRadio(m => this.ingest(m));
    return {
      source: 'asistente',
      name: 'Radio',
      format: 'individual',
      raceId: dayKey(this.startedAt),
      participants: [{ id: 'piloto', name: this.nombre }],
      capabilities: ASISTENTE_CAPABILITIES,
    };
  }

  disconnect(): void {
    // Guardar lo corrido antes de soltar (histórico).
    if (this.active) this.emitSnapshot();
    this.active = false;
    if (this.offBus) {
      this.offBus();
      this.offBus = null;
    }
    this.stateListeners = [];
    this.eventListeners = [];
    this.snapshotListeners = [];
  }

  selectParticipant(): void {
    // Un solo coche: no hay selección.
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

  /** Traduce un mensaje de Radio (del canal de datos) a estado/eventos. */
  private ingest(m: MensajeRadio): void {
    if (!this.active) return;
    switch (m.tipo) {
      case 'inicio':
        this.lapsMs = [];
        this.currentState = {
          ...this.currentState,
          status: 'my-turn',
          lapCount: 0,
          lastLapMs: null,
          bestLapMs: null,
          avgLapMs: null,
          raceAvgLapMs: null,
        };
        this.emitState();
        this.emitEvent({ type: 'race-started' });
        break;

      case 'vuelta':
        this.lapsMs.push(m.ms);
        this.applyLapStats();
        this.emitState();
        this.emitEvent({
          type: 'lap-completed',
          lapTimeMs: m.ms,
          lapCount: this.lapsMs.length,
        });
        if (this.objetivoMs != null) {
          this.emitEvent({ type: 'diferencia-objetivo', diffMs: m.ms - this.objetivoMs });
        }
        break;

      case 'aviso':
        this.emitEvent({ type: 'aviso-equipo', clave: m.clave });
        break;

      case 'objetivo':
        this.objetivoMs = m.ms;
        break;

      case 'deshacer':
        // El asistente borra la vuelta n (pulsación por error). n es 1-based.
        if (this.lapsMs.length > 0) {
          const idx = Math.min(m.n - 1, this.lapsMs.length - 1);
          if (idx >= 0) {
            this.lapsMs.splice(idx, 1);
            this.applyLapStats();
            this.emitState();
          }
        }
        break;

      case 'fin':
        this.currentState = { ...this.currentState, status: 'race-finished' };
        this.emitState();
        this.emitEvent({ type: 'race-finished' });
        this.emitSnapshot();
        break;

      // 'estado', 'participantes', 'ajustes' y 'salaCerrada' no afectan a los
      // tiempos: los gestionan el RadioContext y la coordinación de voz.
      default:
        break;
    }
  }

  /** Recalcula best/avg/raceAvg a partir de las vueltas acumuladas. */
  private applyLapStats(): void {
    const n = this.lapsMs.length;
    if (n === 0) {
      this.currentState = {
        ...this.currentState,
        lapCount: 0,
        lastLapMs: null,
        bestLapMs: null,
        avgLapMs: null,
        raceAvgLapMs: null,
      };
      return;
    }
    let sum = 0;
    let best = Infinity;
    for (const ms of this.lapsMs) {
      sum += ms;
      if (ms < best) best = ms;
    }
    const avg = Math.round(sum / n);
    this.currentState = {
      ...this.currentState,
      lapCount: n,
      lastLapMs: this.lapsMs[n - 1]!,
      bestLapMs: best,
      avgLapMs: avg,
      raceAvgLapMs: avg,
    };
  }

  /** Dossier local para el histórico (un único piloto). */
  private emitSnapshot(): void {
    if (this.lapsMs.length === 0) return;
    const d = this.startedAt;
    const sum = this.lapsMs.reduce((a, b) => a + b, 0);
    const best = Math.min(...this.lapsMs);
    const snap: RaceStatsSnapshot = {
      raceId: `radio-${d.getTime()}`,
      name: `Radio ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      format: 'individual',
      startedAt: d.toISOString(),
      finishedAt: new Date().toISOString(),
      standings: [{
        position: 1,
        entityId: this.nombre,
        entityType: 'driver',
        name: this.nombre,
        totalLaps: this.lapsMs.length,
        bestLapMs: best,
        avgLapMs: Math.round(sum / this.lapsMs.length),
        totalTimeMs: sum,
        mangasRaced: 1,
      }],
    };
    for (const l of this.snapshotListeners) l(snap);
  }

  private emitState(): void {
    for (const l of this.stateListeners) l(this.currentState);
  }

  private emitEvent(e: SourceEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}

/** yyyymmdd como número (clave de estrategia de un día de carrera). */
function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
