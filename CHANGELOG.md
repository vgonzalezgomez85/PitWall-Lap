# Historial de versiones — PitWall Lap

La versión vive en `app.json` (`expo.version`) y se muestra en el pie de la
pantalla inicial y en la pantalla **Novedades** de la app.

**Criterio de numeración (vMAYOR.MENOR.PARCHE):**
- **v1.0.X** — correcciones y ajustes pequeños (fixes, retoques visuales, textos).
- **v1.X.0** — funcionalidades nuevas (una feature completa).
- **vX.0.0** — cambios muy grandes (rediseños, rupturas de compatibilidad).

Cada cambio que se mergea debe subir la versión (`expo.version` en `app.json` y
`version` en `package.json`) y añadir aquí su entrada, en la sección que toque:
**Añadido** (nuevo), **Mejorado** (existente a mejor), **Corregido** (bugs).
Después, ejecutar `npm run changelog:sync` y commitear el generado.

Formato de entrada: `## [X.Y.Z] — YYYY-MM-DD`. Un ítem por línea, **negrita**
para lo importante y `código` para rutas, flags e identificadores.

---

## [1.0.0] — 2026-09-29

### Añadido
- **Primera versión de PitWall Lap.** App móvil (objetivo principal iOS) para pilotos de slot racing: se conecta al cronometrador por WiFi y locuta los tiempos de vuelta en castellano, incluso con la pantalla bloqueada.
- **Soporte de tres protocolos de cronometraje**: PitWall Manager (DS-300, socket.io + REST), Tic Tac Slot / InfoLap antiguo (UDP) y TicTac nuevo (WebSocket sobre TLS, `wss://<pc>:12543`).
- **Auto-discovery** del servidor en la WiFi local (mDNS `_pitwall-manager._tcp`, UDP broadcast para InfoLap) con fallback a IP manual.
- **Selector multi-carrera y multi-tanda** cuando el servidor tiene varias preparadas, más **modo entrenamiento** (elegir carril) y **modo pole**.
- **Cronometraje en vivo**: última vuelta, vuelta rápida, contador, posición, gaps en tiempo y vueltas, media de carril, salidas, pits y proyección final; vista de descanso con la próxima manga y su carril.
- **Voz en castellano** con TTS nativo: vueltas, vuelta rápida, cambios de posición, media manga, último minuto y 30 segundos, cambio de turno y vueltas fantasma ("vuelta ignorada" / "vuelta asignada"); modo avanzado con medias, gaps y "media para subir" cada N minutos. Funciona con la pantalla bloqueada (módulo nativo `BackgroundTts`).
- **Estrategia de neumáticos**: momento óptimo de cambio con degradación normalizada por carril, plan pautado cuando no hay degradación medible, capa de posición (adelantar/defender), modelado de la goma de los rivales y control de neumáticos del servidor (dotación y cambios reales).
- **Entrenamientos**: botón "Entreno GO" que graba stints completos (vueltas + setup de coche/motor/rueda) con comparador y gráfica.
- **Histórico offline**: dossier completo cuando termina la carrera, con Excel de resultados descargable para abrirlo sin conexión.
- **Toggles de voz** persistentes, activables en vivo desde la pantalla de carrera.
- **Control de versionado y pantalla Novedades.** La versión vive en `app.json` y se muestra en la pantalla inicial y en Novedades; este `CHANGELOG.md` es el historial único (embebido en la app) con tests que guardan la sincronía y el lockstep de versiones.
