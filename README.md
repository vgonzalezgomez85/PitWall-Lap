# PitWall Lap

App móvil para pilotos de slot racing (objetivo principal iOS; el proyecto
también compila Android). Se conecta al cronómetro de la pista por WiFi y
locuta los tiempos de vuelta en castellano — incluso con la pantalla
bloqueada.

Compatible con tres protocolos de cronometraje:

- **PitWall Manager** (sistema propio, basado en hardware DS-300;
  socket.io + REST).
- **Tic Tac Slot / InfoLap antiguo** (paquete UDP de 52 bytes, sistema
  legado de muchos clubes).
- **Tic Tac nuevo (TICTAC_Slot 2026)** (WebSocket sobre TLS en `:12543`
  con mensajes JSON).

## Estado

v1 funcional, build de Release standalone (no necesita Metro ni Mac).
Incluye estrategia de neumáticos (Fases 1–3) y control de neumáticos desde
el servidor. Pendiente de cuenta Apple Developer para distribución vía
TestFlight / App Store.

## Funcionalidades

- **Auto-discovery** del servidor en la WiFi local (mDNS
  `_pitwall-manager._tcp` para PitWall Manager, UDP broadcast para InfoLap),
  con fallback a IP manual.
- **Selector multi-carrera y multi-tanda** cuando el servidor tiene varias
  preparadas.
- **Modo entrenamiento**: si el servidor está en modo entrenamiento libre,
  permite elegir carril directamente.
- **Modo pole**: sesión de clasificación, con avisos de turno y vuelta
  rápida.
- **Cronometraje en vivo** del piloto seleccionado: última vuelta, vuelta
  rápida, contador de vueltas, posición, gaps (en tiempo y en vueltas),
  media de carril, salidas, pits y proyección de vueltas al final (la
  calcula el servidor).
- **Vista de descanso** cuando le toca descansar al piloto: muestra info
  de su próxima manga + carril.
- **Voz en castellano** con TTS nativo:
  - Tiempo de cada vuelta y aviso de vuelta rápida.
  - Cambios de posición.
  - Avisos de media manga, último minuto y 30 segundos.
  - Cambio de turno ("tu turno, carril N").
  - Vueltas fantasma: "vuelta ignorada" / "vuelta asignada".
  - Modo avanzado (cada N minutos): media de carril, gaps al rival de
    delante/detrás (si está a ≤2 vueltas) y "media para subir".
  - **Funciona con la pantalla bloqueada** (módulo nativo iOS
    `BackgroundTts` con `AVAudioSession` y `AVSpeechSynthesizer` +
    keep-alive de audio inaudible).
- **Estrategia de neumáticos** (pantalla Estrategia):
  - Fase 1: del stint en curso saca el momento óptimo de cambio (√(2·P/d))
    o, si no hay degradación medible, un plan pautado; capa de posición
    (cambia/aguanta) comparando la proyección final con y sin parada contra
    los rivales de delante y detrás.
  - Fase 2: modela la goma de los rivales (auto-detección de cambio +
    confirmación manual) para corregir su proyección.
  - Fase 3: degradación normalizada por carril (un stint cruza varias
    mangas a ritmos distintos) y cambios mínimos obligatorios por
    reglamento.
  - **Control de neumáticos del servidor**: si la carrera lleva control
    (`/api/mobile/races/:id/tires`), la dotación y los cambios reales mandan
    sobre la config manual (casado por nombre de equipo).
- **Entrenamiento**: botón "Entreno GO" que graba un stint completo
  (vueltas + setup de coche/motor/rueda); histórico local de stints con
  gráfica y comparador.
- **Histórico local** offline: al terminar una carrera, el servidor envía
  un dossier completo que la app persiste en AsyncStorage, con el Excel de
  resultados descargable para abrirlo sin conexión.
- **Toggles de voz** activables/desactivables en vivo desde la pantalla
  de carrera (persistentes entre sesiones).

## Stack

- **Expo SDK 54** + React Native 0.81 + TypeScript estricto.
- **Módulos nativos locales**: `modules/backgroundtts/` (Swift, audio en
  background) y `modules/infolapws/` (WSS del TicTac nuevo con certificado
  autofirmado, iOS + Android).
- **react-native-zeroconf** (mDNS), **react-native-udp** (InfoLap antiguo),
  **react-native-tts** (fallback foreground), **expo-audio**,
  **socket.io-client**, **AsyncStorage**, **react-native-svg** (gráfica de
  vueltas).
- **Jest** (`jest-expo`) para las partes puras: decoder del UDP antiguo,
  protocolo WSS del TicTac nuevo y estrategia de goma.

## Arquitectura

```
src/
├── data/
│   ├── types.ts                Contrato común DataSource + LiveState
│   ├── PitWallSource.ts        Cliente PitWall Manager (socket.io + REST + voz)
│   ├── InfolapSource.ts        Cliente InfoLap (UDP antiguo y WSS del nuevo)
│   ├── infolapDecode.ts        Decoder XOR del campo tiempo del UDP antiguo
│   ├── infolapWss.ts           Parser JSON del TicTac nuevo (CONFIG/LAP/RIVALS_UPDATE)
│   ├── infolapRace.ts          Proyección/gaps/dossier que el TicTac no calcula
│   ├── discovery.ts            Orquestador mDNS / subnet scan / UDP
│   ├── sourceContext.tsx       Context React con la fuente activa
│   ├── historyStore.ts         Persistencia local de carreras (AsyncStorage)
│   ├── trainingStore.ts        Persistencia local de stints de entreno
│   └── useAutoSaveHistory.ts · useStintRecorder.ts · excelCache.ts · migrateStorage.ts
├── screens/                    Pantallas: Discovery → RacePicker → TandaPicker →
│                               Select → MyTurn → Strategy; Pole; Training; History
├── strategy/                   Estrategia de goma (Fases 1–3) + control del servidor
├── voice/                      TTS (nativo + fallback), toggles y motor de eventos
└── ui/                         Componentes compartidos (LapChart, BackButton)
modules/backgroundtts/          Módulo Swift local para background audio
modules/infolapws/              Módulo nativo local del WSS del TicTac nuevo
plugins/                        Config plugins Expo (script sandboxing iOS,
                                cleartext HTTP Android)
tools/                          Probes Node para ingeniería inversa del protocolo
                                InfoLap (UDP, WSS, decoders)
```

## Cómo ejecutar

Requisitos:

- macOS con Xcode 16+.
- Cuenta Apple ID (gratis basta para desarrollo).
- iPhone físico conectado por USB (la primera vez).

Setup:

```bash
npm install
cd ios && pod install && cd ..
npx expo run:ios --device                   # Debug (necesita Metro)
npx expo run:ios --device --configuration Release   # Release standalone
```

Tests:

```bash
npm test
```

Una vez instalado, la app funciona sin Mac/Metro hasta que caduque la
firma (7 días con Apple ID gratuito, 1 año con Apple Developer Program).

## Servidor

Requiere el servidor PitWall Manager (proyecto separado, `~/PitWall`)
corriendo en la misma WiFi. La app lo descubre automáticamente vía mDNS
(`_pitwall-manager._tcp`) o por IP manual; los datos van por socket.io y
REST (`/api/mobile/...`, p. ej. el control de neumáticos de la carrera).

Para modo InfoLap necesita el Gestor de Carreras de Tic Tac Slot en un
PC de la red — versión antigua (UDP) o la nueva (WSS).

## Roadmap

- **v1 publicación**: Apple Developer Program, TestFlight, App Store.
- **v2**: autenticación HMAC server↔app, intercom de equipo (WebRTC),
  multicast entitlement de Apple para auto-discover InfoLap sin IP
  manual.

## Licencia

Propietario. Todos los derechos reservados.
