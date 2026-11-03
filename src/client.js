'use strict';
const { normalizeUrl } = require('./config');

class NanoError extends Error {}

function headers(cfg) {
  const h = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    'User-Agent': 'nano-ai/1.0',
  };
  if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey;
  return h;
}

function ollamaOptions(p) {
  const o = {};
  if (p.temperature != null) o.temperature = p.temperature;
  if (p.top_p != null) o.top_p = p.top_p;
  if (p.top_k != null) o.top_k = p.top_k;
  if (p.repeat_penalty != null) o.repeat_penalty = p.repeat_penalty;
  if (p.max_tokens != null) o.num_predict = p.max_tokens;
  if (p.seed != null) o.seed = p.seed;
  if (p.num_ctx != null) o.num_ctx = p.num_ctx;
  return o;
}

function openaiBody(cfg, messages, p, stream) {
  const b = { model: cfg.model, messages, stream };
  if (p.temperature != null) b.temperature = p.temperature;
  if (p.top_p != null) b.top_p = p.top_p;
  if (p.max_tokens != null) b.max_tokens = p.max_tokens;
  if (p.seed != null) b.seed = p.seed;
  // Non-standard but accepted by vLLM / llama.cpp servers; ignored elsewhere.
  if (p.top_k != null) b.top_k = p.top_k;
  if (p.repeat_penalty != null) b.repetition_penalty = p.repeat_penalty;
  if (stream) b.stream_options = { include_usage: true };
  return b;
}

function friendlyNetwork(e, base) {
  const code = (e.cause && e.cause.code) || e.code || '';
  if (e.name === 'AbortError') return e;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|UND_ERR/.test(code) || /fetch failed/i.test(e.message)) {
    return new NanoError(`Cannot reach ${base}. Is the Colab server running, and is this the current ngrok link? (/url <link>)`);
  }
  return e;
}

function httpError(status, text, model) {
  if (/ERR_NGROK|ngrok/i.test(text) && status >= 400) {
    return new NanoError('The ngrok tunnel is offline - the Colab session probably stopped. Re-run the Colab cells, then /url <new-link>.');
  }
  let msg = '';
  try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch { /* not json */ }
  if (/not found/i.test(msg) && /model/i.test(msg)) {
    return new NanoError(`Model "${model}" is not on the server. Pull it in Colab (!ollama pull ${model}) or pick one with /models.`);
  }
  return new NanoError(`Server replied HTTP ${status}${msg ? ': ' + msg : text ? ': ' + text.slice(0, 160).replace(/\s+/g, ' ') : ''}`);
}

/**
 * Stream a chat completion.
 * Returns { content, aborted, stats: { promptTokens, completionTokens, tps } }.
 */
async function chat(cfg, { messages, params, signal, onToken, onThinking }) {
  const base = normalizeUrl(cfg.serverUrl);
  if (!base) throw new NanoError('No server URL set. Paste your ngrok link with:  /url https://xxxx.ngrok-free.app');
  const ollama = cfg.apiType === 'ollama';
  const url = base + (ollama ? '/api/chat' : '/v1/chat/completions');
  const body = ollama
    ? { model: cfg.model, messages, stream: true, options: ollamaOptions(params), keep_alive: '30m' }
    : openaiBody(cfg, messages, params, true);

  const ac = new AbortController();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  const timer = setTimeout(() => ac.abort(new NanoError('Timed out waiting for the server')), cfg.timeoutMs);

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    if (ac.signal.aborted && !(signal && signal.aborted)) throw ac.signal.reason instanceof Error ? ac.signal.reason : e;
    if (signal && signal.aborted) return { content: '', aborted: true, stats: {} };
    throw friendlyNetwork(e, base);
  }
  clearTimeout(timer);
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''), cfg.model);

  let content = '';
  const stats = {};
  let firstTokenAt = 0;
  const t0 = Date.now();

  const handle = (line) => {
    if (ollama) {
      const o = JSON.parse(line);
      if (o.error) throw new NanoError(o.error);
      const m = o.message || {};
      if (m.thinking && onThinking) onThinking(m.thinking);
      if (m.content) {
        if (!firstTokenAt) firstTokenAt = Date.now();
        content += m.content;
        if (onToken) onToken(m.content);
      }
      if (o.done) {
        stats.promptTokens = o.prompt_eval_count;
        stats.completionTokens = o.eval_count;
        if (o.eval_count && o.eval_duration) stats.tps = o.eval_count / (o.eval_duration / 1e9);
      }
    } else {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      const o = JSON.parse(payload);
      if (o.error) throw new NanoError(o.error.message || String(o.error));
      const d = (o.choices && o.choices[0] && o.choices[0].delta) || {};
      const think = d.reasoning_content || d.reasoning;
      if (think && onThinking) onThinking(think);
      if (d.content) {
        if (!firstTokenAt) firstTokenAt = Date.now();
        content += d.content;
        if (onToken) onToken(d.content);
      }
      if (o.usage) {
        stats.promptTokens = o.usage.prompt_tokens;
        stats.completionTokens = o.usage.completion_tokens;
      }
    }
  };

  let aborted = false;
  try {
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    }
    if (buf.trim()) handle(buf.trim());
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) aborted = true;
    else if (e instanceof NanoError) throw e;
    else throw friendlyNetwork(e, base);
  }

  if (!stats.tps && stats.completionTokens && firstTokenAt) {
    const secs = (Date.now() - firstTokenAt) / 1000;
    if (secs > 0.2) stats.tps = stats.completionTokens / secs;
  }
  stats.totalMs = Date.now() - t0;
  return { content, aborted, stats };
}

async function listModels(cfg) {
  const base = normalizeUrl(cfg.serverUrl);
  if (!base) throw new NanoError('No server URL set. Use /url <ngrok-link>');
  const url = base + (cfg.apiType === 'ollama' ? '/api/tags' : '/v1/models');
  const t0 = Date.now();
  let res;
  try { res = await fetch(url, { headers: headers(cfg), signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw friendlyNetwork(e, base); }
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''), cfg.model);
  const j = await res.json();
  const models = cfg.apiType === 'ollama'
    ? (j.models || []).map((m) => m.name)
    : (j.data || []).map((m) => m.id);
  return { models, latencyMs: Date.now() - t0 };
}

module.exports = { chat, listModels, NanoError };
