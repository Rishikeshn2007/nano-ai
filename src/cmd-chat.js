'use strict';
const sessions = require('./sessions');
const ui = require('./ui');

const preview = (t, n = 110) => {
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

module.exports = [
  {
    name: 'new', alias: ['n'], usage: '/new [name]', desc: 'start a fresh chat (the current one stays saved)',
    run(app, arg) {
      const s = sessions.create(arg.trim() || undefined);
      app.switchTo(s);
      app.ok(`new chat: ${ui.bold(s.name)}`);
    },
  },
  {
    name: 'sessions', alias: ['ls', 'chats'], usage: '/sessions', desc: 'list saved chats (newest first)',
    run(app) {
      const all = sessions.list();
      if (!all.length) return app.info('no chats yet');
      app.say();
      all.slice(0, 30).forEach((s, i) => {
        const cur = s.id === app.session.id;
        const n = String(i + 1).padStart(2);
        const name = (s.name.length > 34 ? s.name.slice(0, 33) + '…' : s.name).padEnd(34);
        const meta = `${String(s.messages.length).padStart(3)} msgs  ${s.summary ? 'mem●' : '    '}  ${ui.ago(s.updated)}`;
        app.say(`  ${cur ? ui.accent('▸') : ' '} ${ui.gray(n)}  ${cur ? ui.bold(name) : name} ${ui.gray(meta)}`);
      });
      app.say();
      app.info('/switch <number|name> to open one');
    },
  },
  {
    name: 'switch', alias: ['open', 'sw'], usage: '/switch <n|name>', desc: 'open another saved chat',
    run(app, arg) {
      if (!arg.trim()) return app.warn('usage: /switch <number|name>  (see /sessions)');
      const s = sessions.find(arg);
      if (!s) return app.warn('no such chat');
      app.switchTo(s);
      app.ok(`opened ${ui.bold(s.name)} ${ui.gray(`(${s.messages.length} msgs${s.summary ? ', summary active' : ''})`)}`);
      const msgs = s.messages.slice(-2);
      for (const m of msgs) app.info(`${m.role === 'user' ? 'you' : 'nano'}: ${preview(m.content)}`);
    },
  },
  {
    name: 'rename', usage: '/rename <name>', desc: 'rename this chat',
    run(app, arg) {
      if (!arg.trim()) return app.warn('usage: /rename <name>');
      app.session.name = arg.trim().slice(0, 60);
      app.saveSession();
      app.ok('renamed');
    },
  },
  {
    name: 'delete', alias: ['rm'], usage: '/delete <n|name|current>', desc: 'delete a saved chat',
    run(app, arg) {
      const q = arg.trim();
      if (!q) return app.warn('usage: /delete <number|name|current>  (see /sessions)');
      const s = q === 'current' ? app.session : sessions.find(q);
      if (!s) return app.warn('no such chat');
      sessions.remove(s.id);
      app.ok(`deleted ${ui.bold(s.name)}`);
      if (s.id === app.session.id) {
        const next = sessions.list()[0] || sessions.create();
        app.switchTo(next);
        app.info(`now in: ${next.name}`);
      }
    },
  },
  {
    name: 'clear', usage: '/clear', desc: 'wipe this chat\'s messages and summary',
    run(app) {
      const s = app.session;
      s.messages = []; s.archive = []; s.summary = ''; s.summaryCount = 0;
      app.saveSession();
      app.refreshBlocks();
      app.ok('chat cleared');
    },
  },
  {
    name: 'retry', alias: ['regen', 'r'], usage: '/retry', desc: 'regenerate the last reply (tweak /set first!)',
    async run(app) {
      const s = app.session;
      if (s.messages.length && s.messages[s.messages.length - 1].role === 'assistant') s.messages.pop();
      if (!s.messages.length || s.messages[s.messages.length - 1].role !== 'user') return app.warn('nothing to retry');
      app.refreshBlocks();
      await app.ask(null, { regen: true });
    },
  },
  {
    name: 'undo', alias: ['u'], usage: '/undo', desc: 'remove the last question and answer',
    run(app) {
      const s = app.session;
      if (!s.messages.length) return app.warn('nothing to undo');
      if (s.messages[s.messages.length - 1].role === 'assistant') s.messages.pop();
      if (s.messages.length && s.messages[s.messages.length - 1].role === 'user') s.messages.pop();
      app.saveSession();
      app.refreshBlocks();
      app.ok('last exchange removed');
    },
  },
  {
    name: 'ctx', alias: ['context', 'usage'], usage: '/ctx', desc: 'show how full the context window is',
    run(app) {
      const u = app.usage();
      const s = app.session, m = app.cfg.memory;
      const w = 28, f = Math.min(w, Math.round((u.pct / 100) * w));
      const color = u.pct < 60 ? ui.green : u.pct < 85 ? ui.yellow : ui.red;
      app.say();
      app.say(`  ${color('█'.repeat(f))}${ui.gray('░'.repeat(w - f))}  ${u.pct}%  ${ui.gray(`${u.used} / ${u.budget} tokens (estimated)`)}`);
      app.say(`  ${ui.gray('live messages')} ${s.messages.length}   ${ui.gray('folded into summary')} ${s.summaryCount || 0}   ${ui.gray('memory')} ${m.enabled ? 'on' : 'off'}`);
      app.say(`  ${ui.gray(`auto-summary at ${Math.round(m.triggerRatio * 100)}% full · keeps the last ${m.keepRecent} messages verbatim · summary ≈ ${m.summaryWords} words`)}`);
      app.say();
    },
  },
  {
    name: 'summary', usage: '/summary', desc: 'show this chat\'s rolling summary',
    run(app) {
      const s = app.session;
      if (!s.summary) return app.info('no summary yet - it is created automatically when the context fills up, or run /summarize');
      app.say();
      app.say('  ' + ui.bold('Summary of earlier messages') + ui.gray(` (${s.summaryCount} folded)`));
      for (const line of s.summary.split('\n')) app.say('  ' + line);
      app.say();
    },
  },
  {
    name: 'summarize', alias: ['compress'], usage: '/summarize', desc: 'fold older messages into the summary now',
    async run(app) { await app.compress({ force: true }); },
  },
  {
    name: 'memory', alias: ['mem'], usage: '/memory [on|off|keep N|at PCT|words N]', desc: 'control summary-based memory',
    run(app, arg) {
      const [k, v] = arg.trim().split(/\s+/);
      const m = app.cfg.memory;
      const num = Number(v);
      if (!k) {
        return app.info(`memory ${m.enabled ? 'ON' : 'OFF'} · summarise at ${Math.round(m.triggerRatio * 100)}% · keep ${m.keepRecent} recent · summary ≈ ${m.summaryWords} words`);
      }
      if (k === 'on' || k === 'off') m.enabled = k === 'on';
      else if (k === 'keep' && num >= 2 && num <= 40) m.keepRecent = Math.round(num);
      else if (k === 'at' && num >= 10 && num <= 95) m.triggerRatio = num / 100;
      else if (k === 'words' && num >= 50 && num <= 800) m.summaryWords = Math.round(num);
      else return app.warn('usage: /memory on|off | keep <2-40> | at <10-95> | words <50-800>');
      app.saveConfig();
      app.ok('memory settings updated');
    },
  },
];
