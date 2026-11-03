'use strict';
const { chat } = require('./client');

const estimateTokens = (text) => Math.ceil(String(text || '').length / 3.6);

function systemText(session, cfg) {
  const base = session.system || cfg.systemPrompt;
  if (!session.summary) return base;
  return `${base}\n\nSummary of the earlier part of this conversation (treat as established context):\n${session.summary}`;
}

function effectiveParams(session, cfg) {
  return { ...cfg.params, ...(session.params || {}) };
}

// Tokens available for the prompt (context window minus room for the reply).
function promptBudget(session, cfg) {
  const p = effectiveParams(session, cfg);
  return Math.max(512, (p.num_ctx || 4096) - (p.max_tokens || 512));
}

function usedTokens(session, cfg) {
  let t = estimateTokens(systemText(session, cfg)) + 8;
  for (const m of session.messages) t += estimateTokens(m.content) + 6;
  return t;
}

function needsSummary(session, cfg) {
  if (!cfg.memory.enabled) return false;
  if (session.messages.length <= cfg.memory.keepRecent + 1) return false;
  return usedTokens(session, cfg) > promptBudget(session, cfg) * cfg.memory.triggerRatio;
}

// Messages to send to the model. Hard-trims the oldest as a last resort so a request never overflows.
function buildMessages(session, cfg) {
  const budget = promptBudget(session, cfg);
  const sys = { role: 'system', content: systemText(session, cfg) };
  const msgs = session.messages.map((m) => ({ role: m.role, content: m.content }));
  let total = estimateTokens(sys.content) + 8 + msgs.reduce((n, m) => n + estimateTokens(m.content) + 6, 0);
  let trimmed = 0;
  while (total > budget && msgs.length > 1) {
    const dropped = msgs.shift();
    total -= estimateTokens(dropped.content) + 6;
    trimmed++;
  }
  while (msgs.length > 1 && msgs[0].role !== 'user') { msgs.shift(); trimmed++; }
  return { messages: [sys, ...msgs], trimmed };
}

function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max) + ' …[cut]';
}

/**
 * Fold older messages into the rolling summary using the LLM itself.
 * Keeps the newest `keepRecent` messages verbatim (or fewer when force-folding a short chat).
 */
async function summarize(session, cfg, { force = false, signal } = {}) {
  const keep = force ? Math.min(2, cfg.memory.keepRecent) : cfg.memory.keepRecent;
  let cut = session.messages.length - keep;
  // the verbatim tail must start with a user message
  while (cut > 0 && cut < session.messages.length && session.messages[cut].role !== 'user') cut--;
  if (cut < 2) return { ok: false, reason: 'not enough older messages to summarise yet' };

  const old = session.messages.slice(0, cut);
  const transcript = old
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${clip(m.content, 1800)}`)
    .join('\n\n');

  const prompt =
    `You maintain a compact running memory of a chat so it can continue later with less context.\n\n` +
    `EXISTING SUMMARY:\n${session.summary || '(none yet)'}\n\n` +
    `NEW MESSAGES TO FOLD IN:\n${transcript}\n\n` +
    `Write the updated summary in at most ${cfg.memory.summaryWords} words. ` +
    `Keep: the user's goals, facts, names, decisions, preferences, file/function names, constraints, open tasks. ` +
    `Describe code in words instead of pasting it, unless a short snippet is essential. ` +
    `Output only the summary text.`;

  const params = { ...cfg.params, temperature: 0.2, top_p: 0.9, max_tokens: 600 };
  const r = await chat(cfg, {
    messages: [
      { role: 'system', content: 'You write faithful, compact conversation summaries.' },
      { role: 'user', content: prompt },
    ],
    params,
    signal,
  });
  const text = r.content.trim();
  if (r.aborted) return { ok: false, reason: 'cancelled' };
  if (!text) return { ok: false, reason: 'the model returned an empty summary' };

  session.summary = text;
  session.summaryCount = (session.summaryCount || 0) + old.length;
  session.archive = (session.archive || []).concat(old);
  session.messages = session.messages.slice(cut);
  return { ok: true, folded: old.length };
}

module.exports = {
  estimateTokens, systemText, effectiveParams, promptBudget, usedTokens, needsSummary, buildMessages, summarize,
};
