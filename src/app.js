'use strict';
const readline = require('readline');
const fs = require('fs');
const config = require('./config');
const sessions = require('./sessions');
const memory = require('./memory');
const clipboard = require('./clipboard');
const { chat, listModels } = require('./client');
const ui = require('./ui');
const commands = require('./commands');

class App {
  constructor(opts = {}) {
    this.cfg = config.load();
    let dirty = false;
    if (opts.url) { this.cfg.serverUrl = config.normalizeUrl(opts.url); dirty = true; }
    if (opts.model) { this.cfg.model = opts.model; dirty = true; }
    if (opts.api) { this.cfg.apiType = opts.api; dirty = true; }
    if (dirty) config.save(this.cfg);

    this.session = (!opts.fresh && sessions.loadCurrent()) || sessions.create();
    sessions.setCurrent(this.session.id);
    this.tty = !!(process.stdin.isTTY && process.stdout.isTTY);
    this.spinner = new ui.Spinner();
    this.busy = false;
    this.abort = null;
    this.closed = false;
    this.multi = null;           // lines of an open """ block, or null
    this.lastBlocks = [];
    this.refreshBlocks();
  }

  // ---------- output helpers ----------
  say(s = '') { console.log(s); }
  info(s) { console.log('  ' + ui.dim(s)); }
  ok(s) { console.log('  ' + ui.green('✓ ') + s); }
  warn(s) { console.log('  ' + ui.yellow('! ') + s); }
  fail(s) { console.log('  ' + ui.red('✗ ') + s); }

  // ---------- state helpers ----------
  params() { return memory.effectiveParams(this.session, this.cfg); }
  saveSession() { sessions.save(this.session); }
  saveConfig() { config.save(this.cfg); }
  lastReply() { return [...this.session.messages].reverse().find((m) => m.role === 'assistant') || null; }
  refreshBlocks() { const r = this.lastReply(); this.lastBlocks = r ? ui.extractBlocks(r.content) : []; }

  switchTo(s) {
    this.session = s;
    sessions.setCurrent(s.id);
    this.refreshBlocks();
  }

  usage() {
    const used = memory.usedTokens(this.session, this.cfg);
    const budget = memory.promptBudget(this.session, this.cfg);
    return { used, budget, pct: Math.min(999, Math.round((used / budget) * 100)) };
  }

  // ---------- header ----------
  header() {
    const { cfg, session: s } = this;
    const p = this.params();
    this.say(ui.banner());
    this.say('  ' + ui.dim('manual transmission for your own LLM') + ui.gray('  ·  v1.0'));
    this.say();
    const server = cfg.serverUrl ? ui.cyan(cfg.serverUrl) : ui.yellow('not set - use /url <ngrok-link>');
    const mem = cfg.memory.enabled ? (s.summary ? ui.green('summary active') : 'summary on') : 'off';
    this.say(ui.box([
      `${ui.gray('server  ')} ${server}`,
      `${ui.gray('model   ')} ${cfg.model} ${ui.gray('(' + cfg.apiType + ')')}`,
      `${ui.gray('chat    ')} ${ui.bold(s.name)} ${ui.gray(`· ${s.messages.length} msgs · memory ${mem}`)}`,
      `${ui.gray('sampling')} temp ${p.temperature} · top_p ${p.top_p} · top_k ${p.top_k} · max ${p.max_tokens} · ctx ${p.num_ctx}`,
    ]));
    this.say();
    this.say('  ' + ui.dim('/help commands  ·  """ multi-line  ·  Ctrl+C stops a reply  ·  /copy grabs code'));
    if (!cfg.serverUrl) {
      this.say();
      this.say('  ' + ui.bold('First run:') + ' start the Colab notebook, copy the ngrok link, then:');
      this.say('    ' + ui.accent('/url https://xxxx.ngrok-free.app'));
    }
    this.say();
  }

  async checkServer() {
    if (!this.cfg.serverUrl) return;
    this.spinner.start('connecting to server');
    try {
      const { models, latencyMs } = await listModels(this.cfg);
      this.spinner.stop();
      const has = models.includes(this.cfg.model);
      this.say(`  ${ui.green('●')} connected ${ui.gray(latencyMs + 'ms')}` +
        (has ? '' : ui.yellow(`  · model "${this.cfg.model}" not on server (/models)`)));
    } catch (e) {
      this.spinner.stop();
      this.say(`  ${ui.red('○')} ${e.message}`);
    }
    this.say();
  }

  promptText() {
    if (this.multi) return ui.dim('  … ');
    const name = this.session.name.length > 22 ? this.session.name.slice(0, 21) + '…' : this.session.name;
    return `${ui.gray(name)} ${ui.accent('❯')} `;
  }
  prompt() {
    if (this.closed || !this.rl) return;
    this.rl.setPrompt(this.tty ? this.promptText() : '');
    if (this.tty) this.rl.prompt();
  }

  // ---------- memory compression ----------
  async compress({ auto = false, force = false } = {}) {
    this.busy = true;
    this.abort = new AbortController();
    this.spinner.start(auto ? 'compressing older messages into memory' : 'summarising conversation');
    try {
      const r = await memory.summarize(this.session, this.cfg, { force, signal: this.abort.signal });
      this.spinner.stop();
      if (r.ok) {
        this.saveSession();
        this.info(`memory: folded ${r.folded} older messages into the summary`);
      } else if (!auto) this.warn(r.reason);
      return r;
    } catch (e) {
      this.spinner.stop();
      this.warn(`summary failed (${e.message}); oldest messages will be trimmed instead`);
      return { ok: false, reason: e.message };
    } finally {
      this.busy = false;
      this.abort = null;
    }
  }

  // ---------- one chat turn ----------
  async ask(text, { regen = false } = {}) {
    const s = this.session;
    let pushedUser = false;
    if (!regen) { s.messages.push({ role: 'user', content: text, ts: Date.now() }); pushedUser = true; }

    if (memory.needsSummary(s, this.cfg)) await this.compress({ auto: true });

    const { messages, trimmed } = memory.buildMessages(s, this.cfg);
    if (trimmed) this.warn(`context was full; ${trimmed} oldest message(s) left out of this request (try /summarize)`);

    this.busy = true;
    this.abort = new AbortController();
    const renderer = new ui.StreamRenderer();
    let started = false;
    let thinking = false;
    this.spinner.start('thinking');

    const onThinking = (t) => {
      if (!this.cfg.ui.showThinking) { this.spinner.set('reasoning'); return; }
      if (!thinking) { thinking = true; this.spinner.stop(); process.stdout.write('  ' + ui.dim('┈ reasoning\n  ')); }
      process.stdout.write(ui.dim(t.replace(/\n/g, '\n  ')));
    };
    const onToken = (t) => {
      if (!started) {
        started = true;
        this.spinner.stop();
        if (thinking) process.stdout.write('\n\n');
      }
      renderer.write(t);
    };

    let r;
    try {
      r = await chat(this.cfg, { messages, params: this.params(), signal: this.abort.signal, onToken, onThinking });
    } catch (e) {
      this.spinner.stop();
      renderer.end();
      this.busy = false;
      this.abort = null;
      if (pushedUser) s.messages.pop();
      this.fail(e.message);
      if (pushedUser) this.info('your message was not sent - press ↑ to recall it');
      return;
    }
    this.spinner.stop();
    renderer.end();
    this.busy = false;
    this.abort = null;

    const reply = r.content;
    if (!reply.trim()) {
      if (pushedUser) s.messages.pop();
      this.warn(r.aborted ? 'stopped before any text arrived' :
        'the model returned no text. Reasoning models can spend all tokens thinking - raise /set max 2048');
      return;
    }
    const msg = { role: 'assistant', content: reply, ts: Date.now() };
    if (r.aborted) msg.partial = true;
    s.messages.push(msg);
    sessions.autoTitle(s);
    this.saveSession();
    this.refreshBlocks();

    this.footer(r);
    if (this.cfg.ui.autoCopy && this.lastBlocks.length) {
      const b = this.lastBlocks[this.lastBlocks.length - 1];
      const c = clipboard.copy(b.code);
      if (c.ok) this.ok(`auto-copied block ${b.n}`);
    }
  }

  footer(r) {
    const u = this.usage();
    const bits = [];
    if (r.stats.completionTokens) bits.push(`${r.stats.completionTokens} tok`);
    if (r.stats.tps) bits.push(`${r.stats.tps.toFixed(1)} t/s`);
    bits.push(`ctx ${ui.fmtK(u.used)}/${ui.fmtK(u.budget)} (${u.pct}%)`);
    if (this.session.summary) bits.push('summary active');
    if (r.aborted) bits.push('stopped - partial reply kept');
    if (this.cfg.ui.stats) this.say('  ' + ui.gray('─ ' + bits.join(' · ')));
    if (this.lastBlocks.length) {
      const tags = this.lastBlocks.map((b) => `/copy ${b.n}`);
      if (this.lastBlocks.length > 1) tags.push('/copy all');
      this.say('  ' + ui.dim('copy: ') + ui.accent(tags.join(ui.gray('  ·  '))));
    }
    this.say();
  }

  // ---------- input ----------
  async handleInput(text) {
    text = text.replace(/\s+$/, '');
    if (!text.trim()) return;
    if (/^\/[a-zA-Z?]/.test(text) && !text.includes('\n')) {
      const keepGoing = await commands.run(this, text);
      return keepGoing;
    }
    await this.ask(text);
  }

  loadHistory() {
    try {
      return fs.readFileSync(config.HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-500).reverse();
    } catch { return []; }
  }
  rememberHistory(line) {
    if (!this.tty || !line.trim() || line.includes('\n')) return;
    try { fs.appendFileSync(config.HISTORY_FILE, line + '\n'); } catch { /* ignore */ }
  }

  exit(code = 0) {
    this.closed = true;
    this.spinner.stop();
    if (this.rl) this.rl.close();
    if (this.tty) console.log('\n  ' + ui.dim('bye - chats are saved in ' + config.HOME) + '\n');
    process.exit(code);
  }

  async start() {
    if (this.tty) { this.header(); await this.checkServer(); }

    const names = commands.names();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: this.tty,
      history: this.loadHistory(),
      historySize: 500,
      completer: (line) => {
        if (!line.startsWith('/') || line.includes(' ')) return [[], line];
        const hits = names.filter((n) => n.startsWith(line));
        return [hits.length ? hits : names, line];
      },
    });
    const rl = this.rl;

    let queue = Promise.resolve();
    let pending = [];
    let timer = null;
    let armed = false;

    const enqueue = (text) => {
      queue = queue
        .then(() => this.handleInput(text))
        .then((r) => { if (r === 'exit') this.exit(0); })
        .catch((e) => this.fail(e.message))
        .then(() => this.prompt());
    };

    rl.on('line', (line) => {
      if (!this.tty) { enqueue(line); return; }
      if (this.multi) {
        if (line.trim() === '"""') {
          const text = this.multi.join('\n');
          this.multi = null;
          this.rememberHistory(text);
          enqueue(text);
        } else { this.multi.push(line); this.prompt(); }
        return;
      }
      if (line.trim() === '"""') {
        this.multi = [];
        this.info('multi-line mode: finish with """ on its own line');
        this.prompt();
        return;
      }
      // Coalesce rapid lines so pasted multi-line text arrives as ONE message.
      pending.push(line);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = pending.join('\n');
        pending = [];
        this.rememberHistory(text);
        enqueue(text);
      }, 40);
    });

    rl.on('SIGINT', () => {
      if (this.busy && this.abort) { this.abort.abort(); return; }
      if (this.multi) { this.multi = null; this.say(); this.info('multi-line cancelled'); this.prompt(); return; }
      if (rl.line && rl.line.length) { rl.write(null, { ctrl: true, name: 'u' }); return; }
      if (armed) this.exit(0);
      armed = true;
      this.say();
      this.info('press Ctrl+C again (or type /exit) to quit');
      setTimeout(() => { armed = false; }, 2000);
      this.prompt();
    });

    rl.on('close', () => {
      this.closed = true;
      queue.then(() => process.exit(0));
    });

    this.prompt();
  }
}

module.exports = { App };
