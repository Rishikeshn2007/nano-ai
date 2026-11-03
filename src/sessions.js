'use strict';
const fs = require('fs');
const path = require('path');
const { SESSIONS_DIR, readState, writeState, ensureDirs } = require('./config');

const DEFAULT_NAME = 'New chat';

const fileOf = (id) => path.join(SESSIONS_DIR, `${id}.json`);
const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);

function create(name) {
  const now = Date.now();
  const s = {
    id: newId(),
    name: name || DEFAULT_NAME,
    created: now,
    updated: now,
    system: null,        // null = use the global system prompt
    params: {},          // per-chat overrides of the global sampling params
    summary: '',         // rolling summary of older messages
    summaryCount: 0,     // how many messages have been folded into the summary
    messages: [],        // live messages still sent verbatim: { role, content, ts }
    archive: [],         // messages already folded into the summary (kept for export)
  };
  save(s);
  return s;
}

function save(s) {
  ensureDirs();
  s.updated = Date.now();
  fs.writeFileSync(fileOf(s.id), JSON.stringify(s, null, 2));
}

function load(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
}

function list() {
  ensureDirs();
  const out = [];
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const s = load(f.slice(0, -5));
    if (s && s.id) out.push(s);
  }
  return out.sort((a, b) => b.updated - a.updated);
}

function remove(id) {
  try { fs.unlinkSync(fileOf(id)); return true; } catch { return false; }
}

// Resolve "3" (list index), an id, or a name fragment to a session.
function find(query) {
  const all = list();
  const q = String(query).trim();
  if (/^\d+$/.test(q)) return all[Number(q) - 1] || null;
  return all.find((s) => s.id === q) ||
         all.find((s) => s.name.toLowerCase().includes(q.toLowerCase())) || null;
}

function setCurrent(id) {
  const st = readState();
  st.current = id;
  writeState(st);
}

function loadCurrent() {
  const id = readState().current;
  return id ? load(id) : null;
}

function autoTitle(s) {
  if (s.name !== DEFAULT_NAME) return false;
  const first = s.messages.concat(s.archive).find((m) => m.role === 'user');
  if (!first) return false;
  const t = first.content.replace(/\s+/g, ' ').trim();
  s.name = t.length > 36 ? t.slice(0, 35) + '…' : t;
  return true;
}

module.exports = { DEFAULT_NAME, create, save, load, list, remove, find, setCurrent, loadCurrent, autoTitle };
