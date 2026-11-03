'use strict';
// Tiny fake Ollama server for testing Nano AI without a GPU.
const http = require('http');

function start(port = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/tags') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ models: [{ name: 'mock:1b' }] }));
      }
      if (req.url === '/api/chat') {
        const j = JSON.parse(body);
        requests.push(j);
        const last = j.messages[j.messages.length - 1].content;
        let reply;
        if (/running memory/.test(last)) reply = 'User is testing Nano AI; wants python help.';
        else if (/code/i.test(last)) reply = 'Here you go:\n```python\nprint("hi")\nfor i in range(3):\n    print(i)\n```\nAnd a second one:\n```js\nconsole.log(1)\n```\nDone.';
        else reply = 'Hello from mock.';
        res.setHeader('Content-Type', 'application/x-ndjson');
        const parts = reply.match(/[\s\S]{1,7}/g);
        let i = 0;
        const tick = () => {
          if (i < parts.length) {
            res.write(JSON.stringify({ message: { role: 'assistant', content: parts[i++] }, done: false }) + '\n');
            setTimeout(tick, 5);
          } else {
            res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 42, eval_count: parts.length, eval_duration: 1e9 }) + '\n');
          }
        };
        return tick();
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, requests, port: server.address().port })));
}

module.exports = { start };
