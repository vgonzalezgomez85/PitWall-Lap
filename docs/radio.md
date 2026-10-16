# Radio — comunicación por voz y tiempos entre piloto y equipo

Documento de diseño. Recoge las decisiones tomadas (oct 2026) y el plan para
implementarlo. **Estado: diseño cerrado, pendiente de la prueba de concepto.**

Mockup de las pantallas: https://claude.ai/artifact/8kLguosjNSrvKXRQC14NgH

---

## 1. Qué es y para qué

Una función nueva de PitWall Lap, **Radio**, que conecta al piloto con su
equipo mientras corre:

- El **asistente** le pasa los tiempos de vuelta pulsando un botón («Vuelta»)
  cada vez que el coche cruza meta; el móvil del piloto los **locuta** con el
  motor de voz de siempre.
- El asistente y el piloto pueden **hablar** entre ellos en directo.
- El resto del equipo (**seguidores**) escucha lo que pasa.

**Caso de uso principal:** circuitos o sesiones **sin WiFi y sin cronómetro**
(ni TicTac ni PitWall Manager). Es la forma de que el piloto tenga
información de tiempos donde hoy no tiene nada.

Secundario (fases posteriores): usar la radio de voz también en carreras con
cronómetro, como capa encima de PitWall / TicTac.

---

## 2. Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Dentro de PitWall Lap**, no una app aparte. | Reutiliza el motor de locución (`modules/backgroundtts`, `src/voice/`), avisos, estrategia e historial. La coordinación locución ↔ voz (ver §6) exige que **una sola app** controle la sesión de audio: con dos apps abiertas a la vez, iOS no las coordina (la locución pisa la voz, interrupciones de audio, riesgo de que iOS suspenda una). Una sola instalación para los tres perfiles. |
| D2 | Nombre: **Radio**. | Se entiende igual en todos los idiomas de la app (es, ca, eu, it, fr, pt, nl, en) y evoca el *team radio* de la F1. Descartados: «Intercom» (solo se entiende en inglés; en it/fr suena a portero automático), «Paddock» (suena a zona social y se confunde con el botón Garage), Box, Pit Board, Pit Talk, Pinganillo… |
| D3 | Icono: **🎧** (auriculares). | Coherente con las baldosas de emoji de `HomeScreen.tsx`. Es la imagen del piloto escuchando a su equipo. Descartados 📻 (radio de escuchar música), 🎙️ (pódcast), 📡 (demasiado técnico). |
| D4 | Tres **perfiles**: Piloto, Asistente, Seguidor (§3). | Definidos por Víctor. |
| D5 | **Sin servidor propio.** Modo principal: **red local creada por la zona WiFi (hotspot) del móvil del asistente**, con conexión directa entre móviles. | No hay WiFi ni cronómetro en el caso de uso; no queremos depender de un servidor en pitwall.es. El audio no sale de esa red: sin internet y sin gastar datos. |
| D6 | El **móvil del asistente hace de centro** de la sala (topología en estrella). | Ya es el punto único de fallo (si cae su zona WiFi, cae la red), así que hacerlo también centro no empeora la fiabilidad. El piloto envía su voz **una sola vez**: ahorra batería y CPU en su móvil, que además locuta. |
| D7 | Dos canales sobre la misma conexión: **datos** (vueltas, estado) y **audio** (voz). | Los tiempos por datos son ligeros, precisos y fiables; la voz queda para comentarios. Conviven a la vez (§6). |
| D8 | Tiempos del asistente = **nueva fuente de datos** «Asistente / Cronómetro manual», implementando `DataSource` (`src/data/types.ts`). | Encaja junto a PitWall y TicTac; la pantalla de carrera, la voz, la estrategia y el historial funcionan sin cambios. |
| D9 | Tecnología de audio: **WebRTC** (`react-native-webrtc`). | Incluye cancelación de eco, supresión de ruido, control de volumen y códec Opus. No reinventar. |
| D10 | Reducción de ruido **por capas** (§7). Prioridad máxima: que el ruido ambiente no llegue al piloto. | Hay micros abiertos en ambiente ruidoso (motores, gente). |
| D12 | La radio es una **capa global independiente de la fuente de tiempos** (`RadioProvider`, como `SourceProvider`), no una fuente a la que se «entra». Compatible con PitWall / TicTac: la radio aporta la voz y el cronómetro, los tiempos. | Si la radio fuera un flujo aparte, para usarla habría que salir de la carrera; volver a los tiempos obliga a buscar de nuevo, y Discovery desconecta la fuente al buscar (`clearSource` en `DiscoveryScreen.tsx`). |
| D11 | Desarrollo en **rama propia** y builds solo al **grupo interno de TestFlight** hasta validarlo en pista (como Garage). | No desestabilizar la app publicada. |

---

## 3. Perfiles

| | Micro | Botón «Vuelta» | Oye | Ve |
|---|---|---|---|---|
| **Piloto** | **Siempre abierto**, con puerta de voz (solo transmite cuando habla) | — | Locución de vueltas + voz del asistente | Pantalla de carrera normal (puede ir bloqueado) |
| **Asistente** | **Interruptor**: walkie (mantener pulsado para hablar) **o** abierto | **Sí** | Al piloto | Última vuelta, mejor vuelta, nº de vuelta, quién está conectado |
| **Seguidor** | **No** (nunca se le pide permiso de micro) | — | Al piloto y al asistente. Locución de tiempos opcional (apagada por defecto) | Tiempos en pantalla |

Notas:
- **Piloto**: lleva el móvil bloqueado y el mando en la mano; no tiene que
  tocar nada. Silenciarse un momento con el **botón del auricular**
  (play/pausa, capturable en segundo plano con `MPRemoteCommandCenter` en iOS).
- **Asistente**: el interruptor walkie/abierto siempre visible en su pantalla.
- Un solo piloto y un solo asistente por sala (de momento). Seguidores: los que
  quepan en la zona WiFi (§5).

---

## 4. Experiencia de uso

### Entrada
- Nueva baldosa en `HomeScreen.tsx`: **🎧 Radio**, con subtítulo traducido.
- Con una sala activa, la baldosa muestra un **indicador** (punto verde o pulso)
  para que se vea que la radio sigue conectada desde cualquier pantalla.

### Radio con cronómetro (PitWall / TicTac)
- Todos en el WiFi del cronómetro (sin zona WiFi); los tiempos vienen del
  cronómetro como siempre y la radio solo aporta la voz (sin botón «Vuelta»).
- Acceso con un **botón 🎧 en la pantalla de carrera** (`MyTurnScreen`): abre
  la radio **encima** de la carrera (`navigation.push`); al volver atrás se
  regresa a los tiempos **sin tocar la fuente**.
- Mejora asociada (útil aunque no haya radio): en el inicio, si hay una fuente
  conectada, mostrar «Carrera en curso — volver» para no tener que buscar de
  nuevo (lo que desconectaría la fuente).
- Riesgos propios de esa red (no es nuestra): aislamiento de clientes del
  router, mDNS bloqueado (alternativa: QR con la IP del asistente) y límite de
  dispositivos del punto de acceso del cronómetro.

### Crear / unirse
1. El asistente activa la **zona WiFi** de su móvil (la app le guía con
   instrucciones; no se puede activar por código en iOS).
2. Asistente: **Radio → Crear sala**. La app genera un **código corto** (p. ej.
   `K7M-4QX`) y anuncia la sala en la red.
3. Los demás se conectan a esa zona WiFi y entran en **Radio**: ven la sala
   anunciada y entran con el código. Eligen papel: **Piloto** o **Seguidor**.
4. El código evita que se cuele alguien que esté en la misma red.

### Pantallas
- **Asistente**: botón grande **«Vuelta»**; botón **«Hablar»** (mantener) o
  interruptor **«Radio abierta»**; última vuelta / mejor / nº de vuelta;
  conectados; deshacer la última vuelta (pulsación por error).
- **Piloto**: entra en la pantalla de carrera habitual con la fuente
  «Asistente»; la radio funciona en segundo plano.
- **Seguidor**: tiempos en pantalla + audio.
- El botón de hablar se dibuja con `react-native-svg` (ya en el proyecto) para
  tener estados animados: reposo / hablando / abierta.

### Al terminar
- Las vueltas quedan en el **historial**, igual que con TicTac / PitWall.

---

## 5. Arquitectura técnica

### Red
- **Modo local (fase 1, el único al principio):** todos en la zona WiFi del
  asistente. Conexión directa entre móviles, sin internet.
- **Descubrimiento:** el asistente publica la sala por **mDNS/Bonjour**
  (`react-native-zeroconf`, que ya se usa en `src/data/discovery.ts` y permite
  publicar servicios). Requiere el permiso de **Red local** de iOS (ya lo
  pedimos; ver memoria del proyecto).
- **Señalización** (presentarse e intercambiar datos de conexión WebRTC): un
  pequeño servidor TCP/WebSocket **en el móvil del asistente** (p. ej.
  `react-native-tcp-socket`). A validar en la prueba de concepto.
- **Topología en estrella** (D6): cada participante tiene **una** conexión
  WebRTC con el asistente. El asistente **reenvía** (no mezcla) el audio del
  piloto a los seguidores, y el suyo a todos.
  - A validar: que `react-native-webrtc` permita reenviar una pista remota a
    otra conexión. **Plan B:** malla pequeña (el piloto envía también
    directamente a cada seguidor; viable con pocos seguidores, ~30 kbps de voz
    por envío).
- **Límite de dispositivos de la zona WiFi:** iPhone en torno a 5 conectados,
  Android algo más. Suficiente para un equipo, no para muchos seguidores.

### Canales
- **Audio:** pistas WebRTC (Opus).
- **Datos:** `RTCDataChannel` fiable y ordenado sobre la misma conexión.
  Mensajes (borrador):
  ```ts
  type MensajeRadio =
    | { tipo: 'vuelta'; n: number; ms: number; ts: number }   // ms = tiempo de vuelta
    | { tipo: 'deshacer'; n: number }
    | { tipo: 'estado'; hablando: 'piloto' | 'asistente' | null }
    | { tipo: 'participantes'; lista: { id: string; nombre: string; rol: Rol }[] }
    | { tipo: 'inicio' | 'fin' };
  ```
  El **asistente es la fuente de verdad** de las vueltas; el cálculo del tiempo
  se hace en su móvil (diferencia entre pulsaciones) y se envía ya calculado.

### Código (propuesta de estructura)
- `src/radio/` — todo lo nuevo, aislado:
  - `sala.ts` — crear / anunciar / unirse, código de sala, participantes.
  - `senalizacion.ts` — servidor (asistente) y cliente.
  - `conexion.ts` — WebRTC: pistas de audio, canal de datos, reenvío.
  - `mensajes.ts` (+ `mensajes.test.ts`) — tipos y (de)serialización, puro.
  - `cronometro.ts` (+ test) — lógica de vueltas del asistente: tiempos,
    mejor vuelta, deshacer. Pura.
  - `audio.ts` — coordinación locución ↔ voz (§6).
- `src/data/AsistenteSource.ts` — `DataSource` que convierte los mensajes
  `vuelta` en `LiveState` / `SourceEvent`. Nuevo `SourceKind`.
- `src/screens/RadioScreen.tsx` (+ pantallas por rol si hace falta).
- Textos en `src/i18n/textos/*.ts` (los 8 idiomas).
- Nativo: `react-native-webrtc` con su config plugin de Expo; cambios de sesión
  de audio en `modules/backgroundtts` (nunca en `ios/` / `android/`).

---

## 6. Audio: convivencia locución ↔ voz

Hoy `BackgroundTtsModule.swift` configura la sesión como `.playback`. Con la
radio activa hay que pasar a **`.playAndRecord`** (modo `.voiceChat`, que activa
el procesado de voz de iOS), con salida a altavoz / Bluetooth permitida, y
**volver a `.playback`** al salir de la sala. Solo el seguidor podría quedarse
en `.playback`.

Reglas de prioridad (en el móvil del piloto y de los seguidores):

1. **Llega un tiempo mientras el asistente habla** → la locución **espera** a
   que suelte (con un máximo de ~1–2 s; pasado eso, locuta igualmente). El
   mensaje `estado.hablando` lo indica.
2. **El asistente empieza a hablar durante una locución** → su voz suena
   **atenuada** hasta que termina el tiempo. Ajuste opcional: «cortar la
   locución y que pase la voz».
3. Opción del piloto: **desactivar la locución automática** si el asistente
   prefiere cantar él los tiempos (el botón «Vuelta» sigue registrando).
   Recomendado: locución automática + voz solo para comentarios.

---

## 7. Ruido: capas

1. **Procesado del sistema** (gratis con WebRTC + `.voiceChat`): cancelación
   de eco, supresión de ruido, control automático de ganancia.
2. **Puerta de voz:** el micro abierto solo transmite cuando detecta voz por
   encima de un umbral; si no, silencio. Umbral **ajustable**, con **medidor**
   en pantalla para calibrarlo en el circuito.
3. **Supresión de ruido con IA** (p. ej. **RNNoise**, libre y ligera) para
   motores, chirridos y voces lejanas. Fase posterior si 1+2 no bastan.
4. **Micro físico:** recomendar en la guía cascos con micro de pértiga o
   cercano a la boca. Es lo que más filtra.

El walkie del asistente (mantener pulsado) ya evita por sí mismo la mayor parte
del ruido de su lado.

---

## 8. Riesgos y puntos a validar

| Riesgo | Detalle | Cómo se valida / mitiga |
|---|---|---|
| Zona WiFi de iPhone sin datos | iOS puede exigir datos móviles activos para encender la zona WiFi (aunque luego no se gasten). Android permite red solo local. | Prueba de concepto. |
| Tráfico entre clientes en la zona WiFi | Que dos móviles conectados a la zona WiFi de un iPhone puedan hablarse y verse por mDNS. | Prueba de concepto. |
| Bluetooth en modo llamada | Con micro abierto, los cascos Bluetooth bajan a calidad de llamada (también la locución). | Escucharlo en la PdC; recomendar cable / USB-C si es malo. |
| Segundo plano iOS | Con sesión `.playAndRecord` activa la app sigue viva con pantalla bloqueada; validarlo con micro abierto en tandas largas. | PdC + prueba de resistencia. |
| Reenvío en `react-native-webrtc` | Reenviar pistas remotas desde el asistente. | PdC; plan B malla. |
| Revisión de Apple | Uso de micro y audio en segundo plano. | Textos de permiso claros (`NSMicrophoneUsageDescription`); micro pedido solo al entrar como piloto/asistente. |
| Batería | Asistente: zona WiFi + centro + pantalla encendida. | Medir en la PdC; recomendar cargador al asistente. |
| Tamaño de la app | WebRTC añade varios MB. | Asumible. |

---

## 9. Plan por fases

**Fase 0 — Prueba de concepto** (rama `radio`, código desechable). Escenario:
asistente con zona WiFi, piloto conectado con el móvil bloqueado y micro
abierto, locución activa. Comprobar:
1. Zona WiFi de iPhone sin datos y tráfico/mDNS entre clientes.
2. Audio WebRTC + locución conviviendo con la pantalla bloqueada.
3. Cuánto ruido de pista se cuela con las capas 1 y 2.
4. Calidad con cascos Bluetooth.
5. Reenvío de audio desde el asistente a un seguidor.

**Fase 1 — Cronómetro del asistente (solo datos).** Sala, perfiles, botón
«Vuelta», `AsistenteSource`, locución en el piloto, historial. Ya aporta valor
sin voz.

**Fase 2 — Voz.** Walkie y radio abierta del asistente, micro abierto del
piloto con puerta de voz, seguidores, reglas de prioridad (§6), medidor de
umbral.

**Fase 3 — Pulido.** Botón del auricular para silenciarse, RNNoise si hace
falta, indicador en la baldosa, guía de uso.

**Más adelante (opcional):**
- Radio de voz encima de carreras con PitWall / TicTac (todos en el WiFi del
  cronómetro; ojo con el aislamiento de clientes de esos routers).
- Modo por internet (sin estar en la misma red): requiere un punto de
  encuentro y reenvío de audio en internet (las operadoras móviles impiden la
  conexión directa entre móviles). Opciones sin servidor propio: señalización
  por servicios públicos (Nostr / MQTT / trackers) + TURN de Cloudflare; o un
  servicio gestionado (LiveKit Cloud…). Decidir si llega a hacer falta.

Cada fase que se mergee sigue la regla de versionado de `AGENTS.md` (versión en
`app.json` + `package.json`, entrada en `CHANGELOG.md`, `changelog:sync`).

---

## 10. Descartado (y por qué)

- **App separada** abierta a la vez que PitWall Lap → ver D1.
- **Salas en PitWall Manager** → excluye a quien no lo tiene y no existe en el
  caso de uso (sin cronómetro).
- **Servidor propio en pitwall.es** → no queremos depender de él; no hace falta
  en red local.
- **Un móvil que mezcle el audio de todos** → más carga y más complejo; basta
  con reenviar.
- **Bluetooth / WiFi directo entre móviles** (Multipeer de Apple, Nearby de
  Android) → no es compatible entre iOS y Android y iOS lo corta en segundo
  plano.
- **Walkie para el piloto** → tiene las manos en el mando; por eso micro
  abierto con puerta de voz.

---

## 11. Preguntas abiertas

- ¿El asistente necesita ver/locutar algo más que vueltas (posición, gaps
  manuales, avisos predefinidos como «box», «cambio de goma»)? Podrían ser
  botones rápidos que se locutan en el piloto.
- ¿Un seguidor puede pasar a asistente (relevo) sin cerrar la sala?
- ¿Varios pilotos en la misma sala (relevos en resistencia)?
- Nombre visible de cada participante: ¿se pide al entrar o se toma del perfil?
