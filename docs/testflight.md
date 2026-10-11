# Distribución por TestFlight

PitWall Lap se reparte a los donantes por TestFlight (testers externos). Cada
build caduca a los **90 días**, así que hay que subir uno nuevo antes.

## Alta (una sola vez)

1. **Apple Developer Program** (99 $/año): developer.apple.com/programs.
   Anota el **Team ID** (Cuenta → Membresía).
2. **Bundle ID definitivo: `es.pitwall.lap`** (`ios.bundleIdentifier` de
   `app.json`, dominio pitwall.es al revés). No se puede cambiar una vez creada
   la app en App Store Connect. Regístralo antes en developer.apple.com →
   Certificates, Identifiers & Profiles → Identifiers → App IDs, sin
   capacidades (la app no usa push).
3. **App Store Connect** → Apps → "+" → Nueva app: plataforma iOS, nombre
   *PitWall Lap*, idioma principal, el bundle ID del paso 2 y un SKU
   cualquiera.
4. **Xcode** → Ajustes → Cuentas: inicia sesión con el Apple ID de la cuenta de
   pago. La firma es automática (`-allowProvisioningUpdates`); Xcode crea el
   certificado Apple Distribution la primera vez.
5. **Grupo de testers:** App Store Connect → tu app → TestFlight → Probadores
   externos → "+" → grupo *Donantes*. Desactiva el enlace público (se podría
   reenviar) y añade a cada donante por email (admite importar CSV).

## Subir un build

```bash
APPLE_TEAM_ID=XXXXXXXXXX npm run ios:testflight
```

Hace: sync del changelog → `expo prebuild` → `pod install` → archive → subida a
App Store Connect. El número de build es la fecha (`aammddhhmm`), único en cada
ejecución. `-- --sin-subida` deja solo el `.ipa` en el escritorio.

Tras unos minutos de procesado el build aparece en TestFlight:

1. **Primera vez:** rellena la información de la beta (descripción, contacto,
   qué probar) y envíalo a revisión de beta. Suele tardar de horas a un par de
   días.
2. Asigna el build al grupo *Donantes*. Les llega solo; con las
   actualizaciones automáticas de TestFlight activadas, se instala sin que
   hagan nada.

## Cada 90 días

- Apunta en el calendario una cita a los **75 días** de cada subida.
- Basta con volver a ejecutar `npm run ios:testflight` (aunque no haya cambios)
  y asignar el build nuevo al grupo. Los builds de la misma versión suelen
  pasar la revisión de beta mucho más rápido.
- TestFlight avisa a los testers por su cuenta cuando un build está a punto de
  caducar.
- Si hay cambios de código, sigue la regla de versionado de `AGENTS.md`
  (versión + `CHANGELOG.md` + `npm run changelog:sync`).

## Problemas conocidos

- **Xcode beta/RC:** App Store Connect rechaza builds hechos con un Xcode beta.
  Comprueba con `xcodebuild -version` que es una versión final.
- **`Sandbox: deny file-write-create`:** el script ya pasa
  `ENABLE_USER_SCRIPT_SANDBOXING=NO`.
- **No borres `ios/build` entero:** guarda el codegen de RN; el script solo
  borra el `.xcarchive` y el export.
- **"No account for team":** falta iniciar sesión en Xcode con la cuenta de
  pago (paso 4), o `APPLE_TEAM_ID` es el de la cuenta gratuita.
- Los donantes de **Android** no usan TestFlight: se les pasa el APK de
  `npm run apk`.
