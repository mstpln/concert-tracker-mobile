'use strict';
// Groq client — the "judgment" layer. Takes raw Tavily search results and
// turns them into validated structured JSON (tour dates or news items),
// enforcing the mandatory-year and sourcing rules via the prompt itself.
// Every call is paced through usageTracker's TPM-aware guard so the
// pipeline never trips Groq's free-tier rate limits.

const config = require('./config');

function apiKey() {
  const k = process.env[config.GROQ.apiKeyEnv];
  if (!k) throw new Error(`Missing required environment variable: ${config.GROQ.apiKeyEnv}`);
  return k;
}

function setOutcome(usage, value) {
  if (usage && typeof usage === 'object') usage._lastGroqOutcome = value;
}

// Sends a system+user prompt, asks for a JSON object response, and returns
// the parsed object (or null on any failure — callers must treat null as
// "found nothing", never as an error to guess around).
async function chatJson(systemPrompt, userPrompt, usage, { estimatedTokens = 1500 } = {}) {
  setOutcome(usage, 'pending');
  if (!usage.canCallGroq(estimatedTokens)) {
    setOutcome(usage, 'skipped');
    usage.note('Groq per-run/daily cap or safe daily token budget reached — skipping a classification call');
    return null;
  }
  await usage.waitForGroqSlot(estimatedTokens);
  usage.recordGroqAttempt();

  let res;
  try {
    res = await fetch(`${config.GROQ.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.GROQ.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
  } catch (e) {
    setOutcome(usage, 'failed');
    usage.note(`Groq request failed: ${e.message}`);
    return null;
  }

  if (!res.ok) {
    setOutcome(usage, 'failed');
    usage.note(`Groq returned ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }

  const data = await res.json();
  usage.recordGroqTokens(data?.usage?.total_tokens);

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) {
    setOutcome(usage, 'failed');
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    setOutcome(usage, 'success');
    return parsed;
  } catch {
    setOutcome(usage, 'failed');
    usage.note('Groq returned non-JSON content — discarding');
    return null;
  }
}

module.exports = { chatJson };
