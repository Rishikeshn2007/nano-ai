'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const mock = require('./mock-server');

const BIN = path.join(__dirname, '..', 'bin', 'nanoai.js');

function runCli(home, port, lines, extra = []) {
  return new Promise((resolve) => {
    const p = spawn('node', [BIN, '--url', `http://127.0.0.1:${port}`, '--model', 'mock:1b', ...extra], {
      env: { ...process.env, NANO_HOME: home, NO_COLOR: '1' },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
    p.stdin.end(lines.join('\n') + '\n');
  });
}

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-test-'));
  const m = await mock.start();
  let n = 0;
  const ok = (name) => console.log(`  ok ${++n} - ${name}`);

  // 1. plain chat + params + code blocks
  let out = await runCli(home, m.port, [
    '/set temp 0.3', '/set topk 25', '/set top_p 5', 'hello there', 'write code please', '/blocks', '/save 1 ' + path.join(home, 'out.py'), '/ctx',
  ]);
  assert(out.includes('temperature = 0.3'), 'temp set');
  assert(out.includes('top_k = 25'), 'topk alias set');
  assert(out.includes('top_p must be between'), 'validation rejects top_p 5');
  assert(out.includes('Hello from mock.'), 'streamed reply shown');
  assert(out.includes('╭─ 1 · python') && out.includes('╭─ 2 · js'), 'numbered code boxes');
  ok('chat, params, validation, streaming, code boxes');

  const req = m.requests[0];
  assert.strictEqual(req.options.temperature, 0.3);
  assert.strictEqual(req.options.top_k, 25);
  assert.strictEqual(req.messages[0].role, 'system');
  ok('sampling params reach the server');

  const req2 = m.requests[1];
  assert.strictEqual(req2.messages.length, 4, 'history resent: system + 3 msgs');
  assert.strictEqual(req2.messages[1].content, 'hello there');
  ok('previous messages are resent (context)');

  assert.strictEqual(fs.readFileSync(path.join(home, 'out.py'), 'utf8'), 'print("hi")\nfor i in range(3):\n    print(i)\n');
  ok('/save writes the code block');

  // 2. persistence: new process resumes same chat
  const before = m.requests.length;
  await runCli(home, m.port, ['what did I say first?']);
  const resumed = m.requests[before];
  assert(resumed.messages.some((x) => x.content === 'hello there'), 'old messages loaded');
  ok('session persists across restarts');

  // 3. multiple sessions
  out = await runCli(home, m.port, ['/new Second', 'fresh topic', '/sessions', '/switch 2', '/history 2']);
  assert(out.includes('Second') && out.includes('hello there'), 'two sessions listed');
  ok('multiple chats: /new /sessions /switch');

  // 4. summary memory (force)
  out = await runCli(home, m.port, ['/new Mem', 'one', 'two', 'three code', 'four', 'five', '/summarize', '/summary', 'after summary']);
  assert(out.includes('folded'), 'folded message');
  assert(out.includes('User is testing Nano AI'), 'summary text shown');
  const last = m.requests[m.requests.length - 1];
  assert(last.messages[0].content.includes('User is testing Nano AI'), 'summary injected into system prompt');
  assert(last.messages.length < 9, 'fewer messages sent after summarising');
  ok('summary-based memory compresses and is injected');

  // 5. auto summary with tiny context
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-test-'));
  const lines = ['/set ctx 512', '/set max 100', '/memory keep 2'];
  for (let i = 0; i < 6; i++) lines.push('please remember item ' + i + ' ' + 'x'.repeat(200));
  out = await runCli(home2, m.port, lines);
  assert(out.includes('memory: folded'), 'auto-summary fired');
  ok('auto-summary triggers when context fills');

  // 6. error handling: dead server, nothing is lost
  out = await runCli(home, 1, ['hi']);
  assert(/Cannot reach|not sent/.test(out), 'friendly network error');
  ok('unreachable server gives a friendly error');

  // 7. unknown command, help
  out = await runCli(home, m.port, ['/bogus', '/help']);
  assert(out.includes('unknown command') && out.includes('/copy'), 'help + unknown');
  ok('/help and unknown commands');

  m.server.close();
  console.log(`\nall ${n} checks passed`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
