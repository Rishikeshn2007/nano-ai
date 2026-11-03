'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { HOME } = require('./config');

function candidates() {
  const wl = ['wl-copy', []];
  const xclip = ['xclip', ['-selection', 'clipboard']];
  const xsel = ['xsel', ['--clipboard', '--input']];
  const rest = [['pbcopy', []], ['clip.exe', []], ['clip', []]];
  const first = process.env.WAYLAND_DISPLAY ? [wl, xclip, xsel] : [xclip, xsel, wl];
  return [...first, ...rest];
}

function run(cmd, args, text) {
  // stdout/stderr ignored: xclip and wl-copy fork and would otherwise keep the pipes open.
  const r = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 4000 });
  return !r.error && r.status === 0;
}

/** Copy text to the system clipboard. Always also writes ~/.nano-ai/last-copy.txt as a safety net. */
function copy(text) {
  const backup = path.join(HOME, 'last-copy.txt');
  try { fs.writeFileSync(backup, text); } catch { /* ignore */ }
  for (const [cmd, args] of candidates()) {
    if (run(cmd, args, text)) return { ok: true, method: cmd, backup };
  }
  if (process.stdout.isTTY) {
    // OSC 52: many modern terminals (kitty, wezterm, iTerm2, Windows Terminal, tmux) honour this, even over SSH.
    process.stdout.write('\x1b]52;c;' + Buffer.from(text).toString('base64') + '\x07');
    return { ok: true, method: 'terminal (OSC 52)', soft: true, backup };
  }
  return { ok: false, backup };
}

module.exports = { copy };
