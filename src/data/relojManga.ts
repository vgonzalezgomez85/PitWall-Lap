// Reloj de manga del TicTac. Ningún TicTac manda el tiempo restante ni avisa
// de pausas: la duración la pone el usuario y aquí se lleva la cuenta.
//
//   • Arranque: al CONFIG (TicTac nuevo) o con la primera vuelta, descontando
//     lo que ha tardado en darla (TicTac antiguo).
//   • Pausa: si ningún carril cruza meta en PAUSA_SIN_VUELTAS_MS, la manga
//     está parada. El reloj se congela desde la última vuelta y, al volver,
//     descuenta lo parado (la primera vuelta tras la pausa empezó a contar
//     cuando se reanudó: `ahora - tiempo de esa vuelta`).

/** Sin vueltas de ningún carril durante este tiempo = manga parada. Una
 *  vuelta de slot no pasa de ~15 s y con varios coches cruza alguien cada
 *  pocos segundos. */
export const PAUSA_SIN_VUELTAS_MS = 20_000;

export class RelojManga {
  /** Inicio de la manga (null = no ha empezado o no la vimos empezar). */
  private inicioAt: number | null = null;
  /** Última vuelta de cualquier carril. */
  private ultimaVueltaAt: number | null = null;
  /** Inicio de la pausa en curso (= última vuelta antes de pararse). */
  private pausaDesde: number | null = null;
  /** Tiempo parado acumulado en la manga. */
  private pausadoMs = 0;

  get iniciado(): boolean {
    return this.inicioAt != null;
  }

  get enPausa(): boolean {
    return this.pausaDesde != null;
  }

  /** La manga empieza en `ahora` (CONFIG del TicTac nuevo; puede ser un
   *  instante futuro si hay semáforo). */
  iniciar(ahora: number): void {
    this.inicioAt = ahora;
    this.ultimaVueltaAt = null;
    this.pausaDesde = null;
    this.pausadoMs = 0;
  }

  /** Manga nueva aún sin empezar: el reloj espera a la primera vuelta. */
  reiniciar(): void {
    this.inicioAt = null;
    this.ultimaVueltaAt = null;
    this.pausaDesde = null;
    this.pausadoMs = 0;
  }

  /** Vuelta de cualquier carril. Arranca el reloj si no lo estaba
   *  (`arrancar`, TicTac antiguo) y cierra la pausa en curso. */
  vuelta(ahora: number, vueltaMs: number, arrancar: boolean): void {
    if (this.inicioAt == null) {
      if (!arrancar) return;
      this.inicioAt = ahora - vueltaMs;
    } else if (this.pausaDesde != null) {
      this.pausadoMs += Math.max(0, ahora - vueltaMs - this.pausaDesde);
      this.pausaDesde = null;
    }
    this.ultimaVueltaAt = ahora;
  }

  /** Detecta la pausa (llamar cada segundo). true si acaba de empezar. */
  comprobarPausa(ahora: number, duracionMs: number | null): boolean {
    if (this.pausaDesde != null || this.ultimaVueltaAt == null) return false;
    if (ahora - this.ultimaVueltaAt < PAUSA_SIN_VUELTAS_MS) return false;
    // Con la manga ya acabada no hay pausa: los coches se paran porque toca.
    const rem = this.restanteMs(this.ultimaVueltaAt, duracionMs);
    if (rem != null && rem <= 0) return false;
    this.pausaDesde = this.ultimaVueltaAt;
    return true;
  }

  /** Tiempo restante, o null sin duración o sin la manga empezada. */
  restanteMs(ahora: number, duracionMs: number | null): number | null {
    const r = this.restanteBrutoMs(ahora, duracionMs);
    return r == null ? null : Math.max(0, r);
  }

  /** Como `restanteMs` pero sin recortar a 0 (negativo = ya pasado). Con el
   *  inicio en el futuro (semáforo del TicTac nuevo) se queda en la duración. */
  restanteBrutoMs(ahora: number, duracionMs: number | null): number | null {
    if (duracionMs == null || this.inicioAt == null) return null;
    const hasta = this.pausaDesde ?? ahora;
    const corrido = hasta - this.inicioAt - this.pausadoMs;
    return Math.min(duracionMs, duracionMs - corrido);
  }
}
