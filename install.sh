#!/usr/bin/env bash
# mind-map installer: installs dependencies, builds the app, and puts the
# `mindmap` command on your PATH. Safe to re-run (that's also how you update).
set -euo pipefail
cd "$(dirname "$0")"
repo="$(pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS installer from https://nodejs.org, then run ./install.sh again."
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "Node.js $major is too old — install the LTS version from https://nodejs.org (20 or newer)."
  exit 1
fi

say "Installing dependencies…"
if command -v pnpm >/dev/null 2>&1; then pnpm install; else npx --yes pnpm@12 install; fi

say "Building the app…"
if command -v pnpm >/dev/null 2>&1; then pnpm build; else npx --yes pnpm@12 build; fi

say "Adding the 'mindmap' command…"
bindir="$HOME/.local/bin"
mkdir -p "$bindir"
chmod +x "$repo/bin/mindmap.js"
ln -sf "$repo/bin/mindmap.js" "$bindir/mindmap"

case ":$PATH:" in
  *":$bindir:"*) ;;
  *)
    rc="$HOME/.zshrc"
    [ "$(basename "${SHELL:-}")" = "bash" ] && rc="$HOME/.bashrc"
    if ! grep -qs 'mind-map installer' "$rc"; then
      printf '\n# added by mind-map installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
      echo "Added ~/.local/bin to your PATH in $rc — open a new terminal window before using 'mindmap'."
    fi
    ;;
esac

say "Done! ✅"
echo "Next: open a new terminal window and run:  mindmap up   (then chat with the AI in the browser)"
echo "(mindmap omp starts the AI in the terminal instead — see README.md for other AI apps)"
