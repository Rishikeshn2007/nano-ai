'use strict';
const config = require('./config');
const { listModels } = require('./client');
const ui = require('./ui');

const { PARAMS, PRESETS } = config;

function showParams(app) {
  const eff = app.params();
  const over = app.session.params || {};
  app.say();
  for (const [k, info] of Object.entries(PARAMS)) {
    const val = eff[k] === null ? 'random' : eff[k];
    const tag = k in over ? ui.yellow(' (this chat)') : '';
    app.say(`  ${ui.accent(k.padEnd(15))} ${String(val).padEnd(8)} ${ui.gray(info.help)}${tag}`);
  }
  app.say();
  app.info('/set <name> <value>   ·   /set --global <name> <value>   ·   /preset precise|balanced|creative');
  app.say();
}

module.exports = [
  {
    name: 'set', usage: '/set [--global] <param> <value>', desc: 'change temperature, top_k, top_p, max, ctx, ...',
    run(app, arg) {
      let words = arg.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return showParams(app);
      let global = false;
      if (words[0] === '--global' || words[0] === '-g') { global = true; words.shift(); }
      if (words.length < 2) return app.warn('usage: /set <param> <value>   e.g.  /set temp 0.3');
      const key = config.resolveParam(words[0]);
      if (!key) return app.warn(`unknown parameter "${words[0]}". Try: ${Object.keys(PARAMS).join(', ')}`);
      const r = config.coerceParam(key, words[1]);
      if (r.error) return app.warn(r.error);
      if (global) { app.cfg.params[key] = r.value; delete app.session.params[key]; app.saveConfig(); }
      else app.session.params[key] = r.value;
      app.saveSession();
      app.ok(`${key} = ${r.value === null ? 'random' : r.value} ${ui.gray(global ? '(all chats)' : '(this chat)')}`);
    },
  },
  {
    name: 'params', alias: ['p'], usage: '/params', desc: 'show all sampling parameters',
    run(app) { showParams(app); },
  },
  {
    name: 'preset', usage: '/preset precise|balanced|creative', desc: 'one-shot sampling presets',
    run(app, arg) {
      const name = arg.trim().toLowerCase();
      const p = PRESETS[name];
      if (!p) return app.warn(`pick one of: ${Object.keys(PRESETS).join(', ')}`);
      Object.assign(app.session.params, p);
      app.saveSession();
      app.ok(`preset ${ui.bold(name)}: temp ${p.temperature} · top_p ${p.top_p} · top_k ${p.top_k}`);
    },
  },
  {
    name: 'reset', usage: '/reset', desc: 'drop this chat\'s overrides and its system prompt',
    run(app) {
      app.session.params = {};
      app.session.system = null;
      app.saveSession();
      app.ok('this chat now uses the global settings');
    },
  },
  {
    name: 'system', alias: ['sys'], usage: '/system [text|reset|--global text]', desc: 'view or set the system prompt',
    run(app, arg) {
      const t = arg.trim();
      if (!t) {
        const cur = app.session.system || app.cfg.systemPrompt;
        app.say();
        app.say('  ' + ui.bold('System prompt') + ui.gray(app.session.system ? ' (this chat)' : ' (global)'));
        app.say('  ' + cur);
        app.say();
        return;
      }
      if (t === 'reset') { app.session.system = null; app.saveSession(); return app.ok('using the global system prompt'); }
      if (t.startsWith('--global ')) {
        app.cfg.systemPrompt = t.slice(9).trim();
        app.saveConfig();
        return app.ok('global system prompt updated');
      }
      app.session.system = t;
      app.saveSession();
      app.ok('system prompt set for this chat');
    },
  },
  {
    name: 'url', usage: '/url <ngrok-link>', desc: 'set the Colab / ngrok server address',
    async run(app, arg) {
      if (!arg.trim()) return app.info(app.cfg.serverUrl || 'no server set. /url https://xxxx.ngrok-free.app');
      app.cfg.serverUrl = config.normalizeUrl(arg);
      app.saveConfig();
      app.ok(`server: ${ui.cyan(app.cfg.serverUrl)}`);
      await app.checkServer();
    },
  },
  {
    name: 'model', usage: '/model <name>', desc: 'choose which model to talk to',
    run(app, arg) {
      if (!arg.trim()) return app.info(`current model: ${app.cfg.model}`);
      app.cfg.model = arg.trim();
      app.saveConfig();
      app.ok(`model: ${app.cfg.model}`);
    },
  },
  {
    name: 'models', usage: '/models', desc: 'list the models available on the server',
    async run(app) {
      app.spinner.start('asking server');
      try {
        const { models } = await listModels(app.cfg);
        app.spinner.stop();
        if (!models.length) return app.warn('server has no models yet. In Colab: !ollama pull gpt-oss:20b');
        app.say();
        for (const m of models) app.say(`  ${m === app.cfg.model ? ui.accent('▸') : ' '} ${m}`);
        app.say();
        app.info('/model <name> to switch');
      } catch (e) { app.spinner.stop(); app.fail(e.message); }
    },
  },
  {
    name: 'api', usage: '/api ollama|openai', desc: 'server type (ollama = default for the Colab notebook)',
    run(app, arg) {
      const v = arg.trim().toLowerCase();
      if (!v) return app.info(`api type: ${app.cfg.apiType}`);
      if (v !== 'ollama' && v !== 'openai') return app.warn('use: ollama | openai');
      app.cfg.apiType = v;
      app.saveConfig();
      app.ok(`api type: ${v}`);
    },
  },
  {
    name: 'key', usage: '/key <token>', desc: 'bearer token for OpenAI-style servers (optional)',
    run(app, arg) {
      app.cfg.apiKey = arg.trim();
      app.saveConfig();
      app.ok(arg.trim() ? 'api key saved' : 'api key cleared');
    },
  },
  {
    name: 'ping', usage: '/ping', desc: 'test the connection',
    async run(app) { await app.checkServer(); },
  },
  {
    name: 'think', usage: '/think on|off', desc: 'show or hide the model\'s reasoning text',
    run(app, arg) {
      const v = arg.trim().toLowerCase();
      if (v !== 'on' && v !== 'off') return app.info(`reasoning display is ${app.cfg.ui.showThinking ? 'on' : 'off'}  (/think on|off)`);
      app.cfg.ui.showThinking = v === 'on';
      app.saveConfig();
      app.ok(`reasoning display ${v}`);
    },
  },
  {
    name: 'autocopy', usage: '/autocopy on|off', desc: 'auto-copy the last code block after every reply',
    run(app, arg) {
      const v = arg.trim().toLowerCase();
      if (v !== 'on' && v !== 'off') return app.info(`auto-copy is ${app.cfg.ui.autoCopy ? 'on' : 'off'}  (/autocopy on|off)`);
      app.cfg.ui.autoCopy = v === 'on';
      app.saveConfig();
      app.ok(`auto-copy ${v}`);
    },
  },
  {
    name: 'stats', usage: '/stats on|off', desc: 'show tokens/s and context usage after replies',
    run(app, arg) {
      const v = arg.trim().toLowerCase();
      if (v !== 'on' && v !== 'off') return app.info(`stats line is ${app.cfg.ui.stats ? 'on' : 'off'}  (/stats on|off)`);
      app.cfg.ui.stats = v === 'on';
      app.saveConfig();
      app.ok(`stats ${v}`);
    },
  },
  {
    name: 'config', usage: '/config [path value]', desc: 'view config, or edit any value e.g. /config memory.keepRecent 8',
    run(app, arg) {
      const t = arg.trim();
      if (!t) {
        const shown = { ...app.cfg, apiKey: app.cfg.apiKey ? '***' : '' };
        app.say();
        app.say(JSON.stringify(shown, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
        app.say();
        return app.info('file: ' + config.CONFIG_FILE);
      }
      const [path, ...rest] = t.split(/\s+/);
      if (!rest.length) return app.warn('usage: /config <path> <value>');
      if (!config.setPath(app.cfg, path, config.coerceLoose(rest.join(' ')))) return app.warn(`unknown setting "${path}"`);
      app.saveConfig();
      app.ok(`${path} updated`);
    },
  },
];
