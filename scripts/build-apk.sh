#!/usr/bin/env bash
# Genera el APK de release y lo copia al escritorio con la versión en el
# nombre: pitwall-lap-<version>.apk (version = expo.version de app.json).
#
# Pasos: sync del changelog → expo prebuild (aplica app.json a android/:
# versionName/versionCode y config plugins) → gradle assembleRelease.
# El prebuild es imprescindible al subir versión: el versionName del APK sale
# de android/app/build.gradle, que lo genera prebuild desde app.json.
#
# Uso: npm run apk [directorio-destino]   (por defecto: ~/Desktop)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/Desktop}"

# Java: JAVA_HOME si está definido; si no, el JDK de Homebrew (no está
# enlazado al PATH en esta máquina).
if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17; do
    if [ -x "$jdk/bin/java" ]; then export JAVA_HOME="$jdk"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  echo "error: no encuentro JAVA_HOME (ni un JDK de Homebrew en /opt/homebrew/opt)" >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"

# SDK de Android (el local.properties del repo ya apunta aquí en esta máquina;
# lo escribimos si prebuild lo regeneró sin él).
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"

VERSION="$(node -e "process.stdout.write(require('$ROOT/app.json').expo.version)")"
OUT="$DEST/pitwall-lap-$VERSION.apk"

echo "==> Changelog embebido"
node "$ROOT/scripts/sync-changelog.js"

echo "==> Prebuild (app.json → android/: versionName $VERSION y plugins)"
(cd "$ROOT" && CI=1 npx expo prebuild --platform android --no-install)

if [ ! -f "$ROOT/android/local.properties" ]; then
  echo "sdk.dir=$ANDROID_HOME" > "$ROOT/android/local.properties"
fi

echo "==> Gradle assembleRelease"
"$ROOT/android/gradlew" -p "$ROOT/android" assembleRelease --console=plain

SRC="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
mkdir -p "$DEST"
cp "$SRC" "$OUT"

echo
echo "==> APK: $OUT"
ls -lh "$OUT"
echo "sha256: $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
