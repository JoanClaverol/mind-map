#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/mind-map-share.zip"

cd "$ROOT"

rm -f "$OUT"

# Exclude your real maps, secrets, dependencies, build output, and OS files.
zip -r "$OUT" . \
  -x "maps/*" \
  -x ".env" \
  -x "node_modules/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x "*.log" \
  -x ".DS_Store" \
  -x "mind-map-share.zip"

# Re-include only the empty maps folder marker and the safe example map.
zip -u "$OUT" maps/.gitkeep maps/welcome.json .env.example

echo "Created $OUT"
