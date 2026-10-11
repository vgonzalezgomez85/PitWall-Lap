#!/usr/bin/env bash
# Genera el archivo de release de iOS y lo sube a App Store Connect (TestFlight).
#
# Pasos: sync del changelog → expo prebuild (aplica app.json a ios/: versión,
# bundle ID y config plugins) → xcodebuild archive → exportArchive con
# destino "upload" (firma con Apple Distribution y sube el build).
#
# Requisitos (una sola vez, ver docs/testflight.md):
#   - Cuenta de pago del Apple Developer Program y la app creada en App Store
#     Connect con el mismo bundle ID que app.json.
#   - Haber iniciado sesión con ese Apple ID en Xcode → Ajustes → Cuentas.
#   - APPLE_TEAM_ID: el Team ID de la cuenta de pago (developer.apple.com →
#     Cuenta → Membresía).
#
# El número de build (CFBundleVersion) se genera con la fecha y la hora, para
# que cada subida sea única: TestFlight rechaza repetir (versión, build).
#
# Uso: APPLE_TEAM_ID=XXXXXXXXXX npm run ios:testflight [-- --sin-subida]
#   --sin-subida  solo genera el .ipa (en ~/Desktop), sin subirlo.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBIR=1
for arg in "$@"; do
  case "$arg" in
    --sin-subida) SUBIR=0 ;;
    *) echo "error: argumento desconocido: $arg" >&2; exit 1 ;;
  esac
done

if [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "error: define APPLE_TEAM_ID (Team ID de la cuenta de pago de Apple Developer)" >&2
  exit 1
fi

VERSION="$(node -e "process.stdout.write(require('$ROOT/app.json').expo.version)")"
BUILD="$(date +%y%m%d%H%M)"
ARCHIVE="$ROOT/ios/build/PitWallLap.xcarchive"
EXPORT_DIR="$ROOT/ios/build/export"
OPCIONES="$ROOT/ios/build/ExportOptions.plist"

echo "==> Changelog embebido"
node "$ROOT/scripts/sync-changelog.js"

echo "==> Prebuild (app.json → ios/: versión $VERSION y plugins)"
(cd "$ROOT" && CI=1 npx expo prebuild --platform ios --no-install)

echo "==> pod install"
(cd "$ROOT/ios" && pod install)

# Solo borramos lo nuestro: en ios/build vive también el codegen de RN, que
# genera pod install y no xcodebuild.
rm -rf "$ARCHIVE" "$EXPORT_DIR"

echo "==> Archive (versión $VERSION, build $BUILD)"
xcodebuild archive \
  -workspace "$ROOT/ios/PitWallLap.xcworkspace" \
  -scheme PitWallLap \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  ENABLE_USER_SCRIPT_SANDBOXING=NO

DESTINO=export
[ "$SUBIR" = 1 ] && DESTINO=upload
cat > "$OPCIONES" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINO</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
EOF

echo "==> Export ($DESTINO)"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$OPCIONES" \
  -allowProvisioningUpdates

echo
if [ "$SUBIR" = 1 ]; then
  echo "==> Subido a App Store Connect: $VERSION ($BUILD)"
  echo "    Aparece en TestFlight tras unos minutos de procesado."
else
  IPA="$(ls "$EXPORT_DIR"/*.ipa)"
  OUT="$HOME/Desktop/pitwall-lap-$VERSION-$BUILD.ipa"
  cp "$IPA" "$OUT"
  echo "==> IPA: $OUT"
fi
