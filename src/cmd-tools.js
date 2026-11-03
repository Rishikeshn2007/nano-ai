'use strict';
const fs = require('fs');
const path = require('path');
const clipboard = require('./clipboard');
const ui = require('./ui');
const { extractBlocks } = ui;

const EXT = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', node: 'js', typescript: 'ts', ts: 'ts', java: 'java',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', go: 'go', rust: 'rs', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh',
  html: 'html', css: 'css', json: 'json', yaml: 'yml', yml: 'yml', sql: 'sql', markdown: 'md', md: 'md', xml: 'xml',
  php: 'php', ruby: 'rb', kotlin: 'kt', swift: 'swift', toml: 'toml', dockerfile: 'Dockerfile',
};

function copyMsg(app, c, what) {
  if (!c.ok) return app.fail(`no clipboard tool found. Saved to ${c.backup} - or install xclip:  sudo apt install xclip`);
  app.ok(`copied ${what}` + (c.soft ? ui.gray(` via ${c.method} - if paste is empty, install xclip`) : ''));
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; i < 1000; i++) {
    const q = path.join(dir, `${name}-${i}${ext}`);
    if (!fs.existsSync(q)) return q;
  }
  return p;
}

module.exports = [
  {
    name: 'copy', alias: ['c', 'cp'], usage: '/copy [n|all|last|reply]', desc: 'copy a code block (default: the last one)',
    run(app, arg) {
      const blocks = app.lastBlocks;
      const a = arg.trim().toLowerCase();
      const reply = app.lastReply();
      if (!reply) return app.warn('nothing to copy yet');
      if (a === 'reply' || a === 'text') return copyMsg(app, clipboard.copy(reply.content), 'the full reply');
      if (!blocks.length) return app.warn('the last reply has no code blocks (use /copy reply for the whole text)');
      if (a === 'all') return copyMsg(app, clipboard.copy(blocks.map((b) => b.code).join('\n\n')), `${blocks.length} code blocks`);
      const n = a && a !== 'last' ? Number(a) : blocks.length;
      const b = blocks[n - 1];
      if (!b) return app.warn(`pick a block from 1 to ${blocks.length}`);
      copyMsg(app, clipboard.copy(b.code), `block ${b.n}${b.lang ? ' (' + b.lang + ')' : ''} · ${b.code.split('\n').length} lines`);
    },
  },
  {
    name: 'blocks', alias: ['code'], usage: '/blocks', desc: 'list code blocks from the last reply',
    run(app) {
      if (!app.lastBlocks.length) return app.info('no code blocks in the last reply');
      app.say();
      for (const b of app.lastBlocks) {
        const first = b.code.split('\n').find((l) => l.trim()) || '';
        app.say(`  ${ui.accent(String(b.n).padStart(2))}  ${(b.lang || 'code').padEnd(10)} ${ui.gray(b.code.split('\n').length + ' lines')}  ${ui.dim(first.slice(0, 50))}`);
      }
      app.say();
    },
  },
  {
    name: 'save', usage: '/save [n] [filename]', desc: 'write a code block to a file in the current folder',
    run(app, arg) {
      const blocks = app.lastBlocks;
      if (!blocks.length) return app.warn('no code blocks in the last reply');
      const w = arg.trim().split(/\s+/).filter(Boolean);
      let n = blocks.length;
      if (w.length && /^\d+$/.test(w[0])) n = Number(w.shift());
      const b = blocks[n - 1];
      if (!b) return app.warn(`pick a block from 1 to ${blocks.length}`);
      const ext = EXT[(b.lang || '').toLowerCase()] || 'txt';
      const name = w[0] || (ext === 'Dockerfile' ? 'Dockerfile' : `snippet-${b.n}.${ext}`);
      const file = uniquePath(path.resolve(process.cwd(), name));
      try {
        fs.writeFileSync(file, b.code + '\n');
        app.ok(`saved ${ui.bold(path.relative(process.cwd(), file) || file)}`);
      } catch (e) { app.fail(`could not write file: ${e.message}`); }
    },
  },
  {
    name: 'export', usage: '/export [filename.md]', desc: 'save this whole chat as a Markdown file',
    run(app, arg) {
      const s = app.session;
      const all = (s.archive || []).concat(s.messages);
      if (!all.length) return app.warn('chat is empty');
      let md = `# ${s.name}\n\n`;
      if (s.summary) md += `> **Summary of earlier messages:** ${s.summary.replace(/\n/g, ' ')}\n\n`;
      for (const m of all) md += `## ${m.role === 'user' ? 'You' : 'Nano AI'}\n\n${m.content}\n\n`;
      const safe = s.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chat';
      const file = uniquePath(path.resolve(process.cwd(), arg.trim() || `${safe}.md`));
      try { fs.writeFileSync(file, md); app.ok(`exported ${ui.bold(path.relative(process.cwd(), file) || file)}`); }
      catch (e) { app.fail(`could not write file: ${e.message}`); }
    },
  },
  {
    name: 'last', usage: '/last', desc: 'reprint the last reply',
    run(app) {
      const r = app.lastReply();
      if (!r) return app.info('no replies yet');
      const rd = new ui.StreamRenderer();
      rd.write(r.content);
      rd.end();
      app.say();
    },
  },
  {
    name: 'history', alias: ['h'], usage: '/history [n]', desc: 'show recent messages of this chat',
    run(app, arg) {
      const n = Math.max(1, Math.min(40, Number(arg) || 6));
      const msgs = app.session.messages.slice(-n);
      if (!msgs.length) return app.info('empty chat');
      app.say();
      for (const m of msgs) {
        const who = m.role === 'user' ? ui.accent('you ') : ui.mint('nano');
        const t = m.content.replace(/\s+/g, ' ').trim();
        app.say(`  ${who} ${t.length > 150 ? t.slice(0, 149) + '…' : t}`);
      }
      app.say();
    },
  },
  {
    name: 'file', alias: ['f', 'attach'], usage: '/file <path> [question]', desc: 'send a text/code file along with an optional question',
    async run(app, arg) {
      const m = /^("[^"]+"|'[^']+'|\S+)\s*([\s\S]*)$/.exec(arg.trim());
      if (!m) return app.warn('usage: /file <path> [question]');
      const p = path.resolve(m[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME || '~'));
      let data;
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) return app.warn('that is not a file');
        if (st.size > 200 * 1024) return app.warn('file is larger than 200 KB - too big for a small context window');
        data = fs.readFileSync(p, 'utf8');
      } catch (e) { return app.fail(`cannot read file: ${e.message}`); }
      if (data.includes('\u0000')) return app.warn('that looks like a binary file');
      const ext = path.extname(p).slice(1);
      const q = m[2].trim() || 'Explain what this file does.';
      app.info(`attached ${path.basename(p)} (${data.split('\n').length} lines)`);
      await app.ask(`${q}\n\nFile: ${path.basename(p)}\n\`\`\`${ext}\n${data}\n\`\`\``);
    },
  },
];

module.exports.extractBlocks = extractBlocks;
