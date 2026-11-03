#!/usr/bin/env node
'use strict';
const path = require('path');

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error('Nano AI needs Node.js 18 or newer (you have ' + process.versions.node + ').');
  process.exit(1);
}

const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') {
    console.log(`Nano AI - manual-transmission chat for your own Colab LLM

Usage: nanoai [options]
  --url <link>      set the ngrok / server URL (saved)
  --model <name>    set the model (saved)
  --api <type>      ollama | openai (saved)
  --new             start in a fresh chat instead of resuming the last one
  -v, --version     print version
  -h, --help        this help

Inside the app type /help.`);
    process.exit(0);
  } else if (a === '-v' || a === '--version') {
    console.log(require(path.join(__dirname, '..', 'package.json')).version);
    process.exit(0);
  } else if (a === '--url') opts.url = args[++i];
  else if (a === '--model') opts.model = args[++i];
  else if (a === '--api') opts.api = args[++i];
  else if (a === '--new') opts.fresh = true;
  else { console.error('Unknown option: ' + a + '  (see --help)'); process.exit(1); }
}

const { App } = require(path.join(__dirname, '..', 'src', 'app.js'));
new App(opts).start();
