# PitWall Lap

App móvil iOS para pilotos de slot racing. Se conecta al cronómetro de la
pista por WiFi y locuta los tiempos de vuelta en castellano — incluso con
la pantalla bloqueada.

Compatible con dos sistemas de cronometraje:

- **PitWall Manager** (sistema propio, basado en hardware DS-300).
- **Tic Tac Slot / InfoLap** (sistema legado de muchos clubes).

## Estado

v1 funcional, build de Release standalone (no necesita Metro ni Mac).
Pendiente de cuenta Apple Developer para distribución vía TestFlight /
App Store.

## Funcionalidades

- **Auto-discovery** del servidor en la WiFi local (mDNS para PitWall Manager,
  UDP broadcast para InfoLap), con fallback a IP manual.
- **Selector multi-carrera y multi-tanda** cuando el servidor tiene varias
  preparadas.
- **Modo entrenamiento**: si el servidor está en modo entrenamiento libre,
  permite elegir carril directamente.
- **Cronometraje en vivo** del piloto seleccionado: última vuelta, vuelta
  rápida, contador de vueltas, posición, gap al rival.
- **Vista de descanso** cuando le toca descansar al piloto: muestra info
  de su próxima manga + carril.
- **Voz en castellano** con TTS nativo:
  - Tiempo de cada vuelta.
  - Cambios de posición.
  - Avisos de último minuto y 30 segundos.
  - **Funciona con la pantalla bloqueada** (módulo nativo iOS
    `BackgroundTts` con `AVAudioSession` y `AVSpeechSynthesizer` +
    keep-alive de audio inaudible).
- **Histórico local** offline: al terminar una carrera, el servidor envía
  un dossier completo que la app persiste en AsyncStorage. Consultable
  sin servidor.
- **Toggles de voz** activables/desactivables en vivo desde la pantalla
  de carrera (persistentes entre sesiones).

## Stack

- **Expo SDK 54** + React Native 0.81 + TypeScript estricto.
- **Módulo nativo local Swift** (`modules/backgroundtts/`) para audio
  background.
- **react-native-zeroconf** (mDNS), **react-native-udp** (probe Infolap),
  **react-native-tts** (fallback foreground), **expo-audio**, **socket.io-client**.

## Arquitectura

```
src/
├── data/
│   ├── types.ts                Contrato común DataSource + LiveState
│   ├── SlotTimeSource.ts       Cliente PitWall Manager (socket.io + REST + voz)
│   ├── InfolapSource.ts        Cliente InfoLap (UDP unicast/broadcast)
│   ├── infolapDecode.ts        Decoder XOR del campo tiempo de InfoLap
│   ├── discovery.ts            Orquestador mDNS / subnet scan / UDP
│   ├── sourceContext.tsx       Context React con la fuente activa
│   ├── historyStore.ts         Persistencia local en AsyncStorage
│   └── useAutoSaveHistory.ts   Hook que guarda snapshots al recibirlos
├── screens/                    Pantallas de la app
├── voice/
│   ├── speak.ts                TTS (nativo + fallback)
│   ├── settings.ts             Toggles persistentes
│   └── useVoice.ts             Motor de reglas: eventos → voz
├── ui/                         Componentes compartidos
└── navigation.ts               Stack types
modules/backgroundtts/          Módulo Swift local para background audio
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

Una vez instalado, la app funciona sin Mac/Metro hasta que caduque la
firma (7 días con Apple ID gratuito, 1 año con Apple Developer Program).

## Servidor

Requiere el servidor PitWall Manager (proyecto separado, `~/SloTime`)
corriendo en la misma WiFi. La app lo descubre automáticamente vía mDNS
(`_voltrace-manager._tcp`, nombre de servicio legado que se mantiene por
compatibilidad) o por IP manual.

Para modo InfoLap necesita el Gestor de Carreras de Tic Tac Slot en un
PC de la red.

## Roadmap

- **v1 publicación**: Apple Developer Program, TestFlight, App Store.
- **v2**: autenticación HMAC server↔app, intercom de equipo (WebRTC),
  multicast entitlement de Apple para auto-discover InfoLap sin IP
  manual.

## Licencia

Propietario. Todos los derechos reservados.
