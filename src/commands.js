'use strict';
const ui = require('./ui');

const core = [
  {
    name: 'help', alias: ['?'], usage: '/help', desc: 'show this list',
    run(app) {
      app.say();
      const groups = [
        ['Chat', ['new', 'sessions', 'switch', 'rename', 'delete', 'clear', 'retry', 'undo', 'history', 'last', 'file']],
        ['Code', ['copy', 'blocks', 'save', 'export']],
        ['Sampling', ['set', 'params', 'preset', 'reset', 'system']],
        ['Memory', ['ctx', 'summary', 'summarize', 'memory']],
        ['Server', ['url', 'model', 'models', 'api', 'key', 'ping']],
        ['Display', ['think', 'autocopy', 'stats', 'config']],
        ['App', ['help', 'exit']],
      ];
      for (const [title, names] of groups) {
        app.say('  ' + ui.bold(ui.accent(title)));
        for (const n of names) {
          const c = byName.get(n);
          if (c) app.say(`    ${c.usage.padEnd(40)} ${ui.gray(c.desc)}`);
        }
        app.say();
      }
      app.say('  ' + ui.dim('Tab completes commands · ↑/↓ recalls history · """ starts/ends a multi-line message · Ctrl+C stops a reply'));
      app.say();
    },
  },
  { name: 'exit', alias: ['quit', 'q'], usage: '/exit', desc: 'leave Nano AI', run() { return 'exit'; } },
];

const all = [
  ...core,
  ...require('./cmd-chat'),
  ...require('./cmd-settings'),
  ...require('./cmd-tools'),
];

const byName = new Map();
for (const c of all) {
  byName.set(c.name, c);
  for (const a of c.alias || []) byName.set(a, c);
}

function names() {
  return all.map((c) => '/' + c.name).sort();
}

async function run(app, line) {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(line.trim());
  if (!m) return;
  const key = m[1].toLowerCase();
  let cmd = byName.get(key);
  if (!cmd) {
    const pref = all.filter((c) => c.name.startsWith(key));
    if (pref.length === 1) cmd = pref[0];
    else {
      app.warn(pref.length > 1
        ? `ambiguous: ${pref.map((c) => '/' + c.name).join(', ')}`
        : `unknown command /${key} - try /help`);
      return;
    }
  }
  return cmd.run(app, m[2]);
}

module.exports = { run, names };
