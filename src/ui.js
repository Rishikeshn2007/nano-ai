'use strict';

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const rgb = (r, g, b) => (s) => (useColor ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : String(s));

const bold = wrap('1'), dim = wrap('2'), italic = wrap('3');
const red = wrap('31'), green = wrap('32'), yellow = wrap('33'), cyan = wrap('36'), gray = wrap('90');
const accent = rgb(80, 200, 255), violet = rgb(170, 120, 255), mint = rgb(100, 230, 170);

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => String(s).replace(ANSI, '');
const cols = () => process.stdout.columns || 80;

// ---------- banner ----------
const GLYPHS = {
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  ' ': ['    ', '    ', '    ', '    ', '    ', '    '],
};
const GRADIENT = [[0, 229, 255], [0, 195, 255], [40, 155, 255], [100, 125, 255], [150, 100, 255], [195, 80, 255]];

function banner() {
  if (cols() < 58) return `\n  ${bold(accent('◢ NANO AI ◣'))}\n`;
  const word = ['N', 'A', 'N', 'O', ' ', 'A', 'I'];
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const [R, G, B] = GRADIENT[r];
    rows.push('  ' + rgb(R, G, B)(word.map((ch) => GLYPHS[ch][r]).join('')));
  }
  return '\n' + rows.join('\n') + '\n';
}

function box(lines, color = gray) {
  const w = Math.max(...lines.map((l) => strip(l).length));
  const pad = (l) => l + ' '.repeat(w - strip(l).length);
  const top = color('╭' + '─'.repeat(w + 2) + '╮');
  const bot = color('╰' + '─'.repeat(w + 2) + '╯');
  return [top, ...lines.map((l) => color('│') + ' ' + pad(l) + ' ' + color('│')), bot].map((l) => '  ' + l).join('\n');
}

// ---------- spinner ----------
class Spinner {
  constructor() { this.timer = null; this.label = ''; this.t0 = 0; this.i = 0; }
  start(label) {
    this.label = label;
    if (!process.stdout.isTTY || this.timer) return;
    this.t0 = Date.now();
    process.stdout.write('\x1b[?25l');
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const draw = () => {
      const s = ((Date.now() - this.t0) / 1000).toFixed(0);
      process.stdout.write(`\r\x1b[2K  ${accent(frames[this.i++ % frames.length])} ${dim(this.label)} ${gray(s + 's')}`);
    };
    draw();
    this.timer = setInterval(draw, 90);
  }
  set(label) { this.label = label; }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write('\r\x1b[2K\x1b[?25h');
    }
  }
}

// ---------- code blocks ----------
/** Parse Markdown into ordered fenced code blocks: [{ n, lang, code }] */
function extractBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    const fence = /^\s{0,3}```(.*)$/.exec(line);
    if (fence) {
      if (!cur) cur = { n: blocks.length + 1, lang: fence[1].trim(), lines: [] };
      else { blocks.push({ n: cur.n, lang: cur.lang, code: cur.lines.join('\n') }); cur = null; }
    } else if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push({ n: cur.n, lang: cur.lang, code: cur.lines.join('\n') });
  return blocks;
}

/**
 * Streams model text to the terminal line by line, drawing fenced code as numbered boxes
 * so each snippet can be grabbed with /copy N.
 */
class StreamRenderer {
  constructor(out = process.stdout) {
    this.out = out;
    this.line = '';       // current (unfinished) line
    this.printed = 0;     // chars of this.line already written
    this.fence = false;   // current line is a ``` fence line
    this.inCode = false;
    this.n = 0;           // code block counter
    this.width = Math.min(cols() - 4, 100);
  }

  _w(s) { this.out.write(s); }

  write(text) {
    for (const ch of text) {
      if (ch === '\n') { this._endLine(); continue; }
      this.line += ch;
      if (this.fence) continue;
      if (/^`{1,2}$/.test(this.line)) continue;                  // might become a fence
      if (this.line.startsWith('```')) { this.fence = true; continue; }
      if (this.printed === 0) this._w(this.inCode ? '  ' + gray('│ ') : '  ');
      const chunk = this.line.slice(this.printed);
      this._w(this.inCode ? cyan(chunk) : chunk);
      this.printed = this.line.length;
    }
  }

  _endLine() {
    if (this.fence) {
      const lang = this.line.slice(3).trim();
      if (!this.inCode) {
        this.inCode = true;
        this.n++;
        const head = ` ${this.n} · ${lang || 'code'} `;
        this._w('  ' + gray('╭─') + bold(accent(head)) + gray('─'.repeat(Math.max(2, this.width - head.length - 2))) + '\n');
      } else {
        this.inCode = false;
        const foot = ` /copy ${this.n} `;
        this._w('  ' + gray('╰─') + dim(foot) + gray('─'.repeat(Math.max(2, this.width - foot.length - 2))) + '\n');
      }
    } else {
      if (this.printed === 0) this._w(this.inCode ? '  ' + gray('│') : '');
      else if (this.printed < this.line.length) this._w(this.line.slice(this.printed));
      this._w('\n');
    }
    this.line = ''; this.printed = 0; this.fence = false;
  }

  end() {
    if (this.line) this._endLine();
    if (this.inCode) {
      this._w('  ' + gray('╰─') + dim(' (unterminated) ') + '\n');
      this.inCode = false;
    }
  }
}

const hr = (n) => gray('─'.repeat(n || Math.min(cols() - 4, 60)));
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const ago = (ts) => {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return s + 's ago';
  if (s < 5400) return Math.round(s / 60) + 'm ago';
  if (s < 129600) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};

module.exports = {
  useColor, bold, dim, italic, red, green, yellow, cyan, gray, accent, violet, mint,
  strip, cols, banner, box, Spinner, StreamRenderer, extractBlocks, hr, fmtK, ago,
};
