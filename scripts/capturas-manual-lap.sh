#!/usr/bin/env bash
# Saca a PNG las ilustraciones de las pantallas de PitWall Lap (mockups/manual-lap.html)
# con Chrome sin ventana y las deja en manual/img/ de «PitWall Landing», donde las
# recoge el manual (scripts/manual-lap.py). No son capturas reales del móvil: si se
# prefieren, basta con sustituir los PNG por capturas con el mismo nombre.
#
# Uso: bash scripts/capturas-manual-lap.sh [carpeta-de-PitWall-Landing]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LANDING="${1:-$HOME/PitWall Landing}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DEST="$LANDING/manual/img"
mkdir -p "$DEST"

PANTALLAS=$(grep -o 'id="lap-[a-z0-9-]*"' "$ROOT/mockups/manual-lap.html" | sed 's/id="\(.*\)"/\1/')
for p in $PANTALLAS; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=390,844 --virtual-time-budget=2000 \
    --screenshot="$DEST/$p.png" "file://$ROOT/mockups/manual-lap.html#$p" >/dev/null 2>&1
  echo "  $p.png ($(du -k "$DEST/$p.png" | cut -f1) KB)"
done
