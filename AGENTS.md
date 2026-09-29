# PitWall Lap — AGENTS.md

Guía para agentes de IA (Claude Code u otros LLMs) que trabajen en este proyecto.

---

## Qué es este proyecto

**PitWall Lap** es la app móvil (Expo / React Native; objetivo principal iOS,
también compila Android) para pilotos de slot racing: se conecta al cronómetro
de la pista por WiFi — PitWall Manager, TicTac/InfoLap antiguo (UDP) o TicTac
nuevo (WebSocket sobre TLS) — y locuta los tiempos de vuelta en castellano,
incluso con la pantalla bloqueada.

Todo el código está en **castellano**: identificadores, comentarios, textos de
UI y mensajes de commit. Escribe el código nuevo en castellano.

## Comandos

- `npm test` — tests (jest + jest-expo, `testMatch: **/*.test.ts(x)`).
- `npm run typecheck` (o `npx tsc --noEmit`) — TypeScript estricto, con
  `noUncheckedIndexedAccess` activo.
- `npm run changelog:sync` — regenera `src/generated/changelog.ts` desde
  `CHANGELOG.md`.
- `npm run apk` — APK de release: sync del changelog + `expo prebuild` +
  gradle `assembleRelease` + copia a `~/Desktop/pitwall-lap-<versión>.apk`.

## Versionado (regla dura)

Cada feature o fix que se mergea DEBE, en el mismo cambio:

1. **Subir la versión** en `app.json` (`expo.version`) **y** en `package.json`
   (`version`) — van en lockstep; un test lo verifica.
2. **Añadir su entrada en `CHANGELOG.md`**, en la sección que toque (Añadido /
   Mejorado / Corregido). El criterio de numeración está en la cabecera del
   propio fichero.
3. **Ejecutar `npm run changelog:sync`** y commitear
   `src/generated/changelog.ts` (el test de sincronía falla si no).

La versión que muestra la app (`src/data/appVersion.ts`) se lee del binario vía
`expo-constants` (el `app.config` embebido en build-time): **subir la versión no
se refleja hasta reconstruir**, no basta con recargar Metro. Si el manifest no
está disponible, se cae a la última versión del changelog.

Para el APK, usa siempre **`npm run apk`**: incluye el `expo prebuild` sin el
cual `versionName`/`versionCode` del APK no se actualizan (salen de
`android/app/build.gradle`, generado desde `app.json`), aunque el resto del
build sí.

## Arquitectura

- `src/data/` — contrato común `DataSource` + `LiveState` (`types.ts`) y las
  dos fuentes: PitWall Manager (`PitWallSource.ts`, socket.io + REST) e InfoLap
  (`InfolapSource.ts`, UDP antiguo + WSS nuevo). Descubrimiento en
  `discovery.ts`; persistencia local en `historyStore.ts` / `trainingStore.ts`.
- `src/screens/` — pantallas. Estilo oscuro propio (fondo `#0a0d13`, acento
  `#f6c90e`), botón atrás compartido en `src/ui/BackButton.tsx`.
- `src/strategy/` — estrategia de neumáticos (Fases 1–3) + control del servidor.
- `src/voice/` — motor de eventos → TTS (nativo en background + fallback).
- `modules/` — módulos nativos locales (Swift/Kotlin): `backgroundtts`,
  `infolapws`. `ios/` y `android/` son generados (gitignored); los cambios
  nativos van por aquí o por `plugins/` (config plugins de Expo), nunca
  editando las carpetas generadas.

## Tests

- Los tests son **puros, sin montar React** (decoders, parser del changelog,
  estrategia de goma). Añade tests para lógica pura nueva.
- `src/data/changelog.test.ts` contiene además las guardas del versionado:
  sincronía del fichero generado y lockstep `app.json` / `package.json` /
  primera entrada del changelog.

## Notas

- Licencia **propietaria**: no añadir cabeceras GPL/AGPL (a diferencia de
  PitWall Manager / PitWall Control).
- El servidor PitWall Manager vive en `~/PitWall` (proyecto aparte); la app
  solo consume su API móvil (`/api/mobile/...`).
