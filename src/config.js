'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.NANO_HOME || path.join(os.homedir(), '.nano-ai');
const CONFIG_FILE = path.join(HOME, 'config.json');
const SESSIONS_DIR = path.join(HOME, 'sessions');
const STATE_FILE = path.join(HOME, 'state.json');
const HISTORY_FILE = path.join(HOME, 'history.txt');

const DEFAULTS = {
  serverUrl: '',                 // paste your ngrok link here (or use /url)
  apiType: 'ollama',             // 'ollama' | 'openai'
  apiKey: '',
  model: 'gpt-oss:20b',
  systemPrompt:
    'You are Nano AI, a concise and helpful assistant inside a terminal. ' +
    'Use Markdown. Always put code in fenced code blocks with a language tag.',
  params: {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 1024,
    repeat_penalty: 1.1,
    seed: null,
    num_ctx: 8192,
  },
  memory: {
    enabled: true,       // summary-based context compression
    triggerRatio: 0.75,  // summarise when prompt reaches this share of (num_ctx - max_tokens)
    keepRecent: 6,       // newest messages that always stay verbatim
    summaryWords: 220,   // target size of the rolling summary
  },
  ui: { showThinking: false, autoCopy: false, stats: true },
  timeoutMs: 600000,
};

// name -> { alias list, min, max, int, help }
const PARAMS = {
  temperature:    { alias: ['temp', 't'],         min: 0,   max: 2,      help: 'randomness (0 = focused, 1+ = creative)' },
  top_p:          { alias: ['topp', 'p'],         min: 0,   max: 1,      help: 'nucleus sampling cutoff' },
  top_k:          { alias: ['topk', 'k'],         min: 0,   max: 1000, int: true, help: 'sample from the k likeliest tokens (0 = off)' },
  max_tokens:     { alias: ['max', 'maxtokens'],  min: 16,  max: 32768, int: true, help: 'max tokens per reply' },
  repeat_penalty: { alias: ['rep', 'repeat'],     min: 0.5, max: 2,      help: 'discourages repetition (1.0 = off)' },
  seed:           { alias: [],                    min: 0,   max: 2147483647, int: true, nullable: true, help: 'fixed seed for repeatable output (null = random)' },
  num_ctx:        { alias: ['ctx', 'context'],    min: 512, max: 131072, int: true, help: 'context window size sent to the server' },
};

const PRESETS = {
  precise:  { temperature: 0.2, top_p: 0.8,  top_k: 20,  repeat_penalty: 1.05 },
  balanced: { temperature: 0.7, top_p: 0.9,  top_k: 40,  repeat_penalty: 1.1 },
  creative: { temperature: 1.0, top_p: 0.95, top_k: 80,  repeat_penalty: 1.1 },
};

function ensureDirs() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

function save(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function load() {
  ensureDirs();
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* first run */ }
  const cfg = merge(DEFAULTS, saved);
  if (!fs.existsSync(CONFIG_FILE)) save(cfg);
  return cfg;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(st) {
  ensureDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

function normalizeUrl(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function resolveParam(name) {
  const n = String(name || '').toLowerCase();
  for (const [key, info] of Object.entries(PARAMS)) {
    if (key === n || info.alias.includes(n)) return key;
  }
  return null;
}

// Validate + coerce a user-typed parameter value. Returns { value } or { error }.
function coerceParam(key, raw) {
  const info = PARAMS[key];
  if (info.nullable && /^(null|none|off|random)$/i.test(raw)) return { value: null };
  const num = Number(raw);
  if (raw === '' || Number.isNaN(num)) return { error: `${key} needs a number` };
  if (num < info.min || num > info.max) return { error: `${key} must be between ${info.min} and ${info.max}` };
  return { value: info.int ? Math.round(num) : num };
}

function coerceLoose(str) {
  if (str === 'null') return null;
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str !== '' && !Number.isNaN(Number(str))) return Number(str);
  return str;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isObj(o[parts[i]])) return false;
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (!(last in o)) return false;
  o[last] = value;
  return true;
}

module.exports = {
  HOME, CONFIG_FILE, SESSIONS_DIR, HISTORY_FILE, DEFAULTS, PARAMS, PRESETS,
  load, save, readState, writeState, normalizeUrl, resolveParam, coerceParam, coerceLoose, setPath, ensureDirs,
};
