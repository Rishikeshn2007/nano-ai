#!/usr/bin/env bash
# Links `nanoai` into ~/.local/bin so you can run it from anywhere.
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo "Node.js 18+ is required: sudo apt install nodejs"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node 18+ needed (have $(node -v))"; exit 1; }
chmod +x "$DIR/bin/nanoai.js"
mkdir -p "$HOME/.local/bin"
ln -sf "$DIR/bin/nanoai.js" "$HOME/.local/bin/nanoai"
echo "Installed: $HOME/.local/bin/nanoai"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Add to ~/.bashrc:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;; esac
echo "Run:  nanoai"
