'use strict';
// Tavily Search API client — used only as a fallback for tour dates
// Ticketmaster didn't cover, and as the source for all news categories.
// This module just returns raw search results; Groq (groq.js) is what
// turns those into validated structured data.

const config = require('./config');

function apiKey() {
  const k = process.env[config.TAVILY.apiKeyEnv];
  if (!k) throw new Error(`Missing required environment variable: ${config.TAVILY.apiKeyEnv}`);
  return k;
}

// Returns { results: [{ title, url, content, publishedDate }] } or null if
// the call was skipped/failed. Every call costs Tavily credits, so every
// call site MUST check usage.canCallTavily() before calling this.
async function search(query, usage, { maxResults = 5, days = null, topic = 'general' } = {}) {
  if (!usage.canCallTavily()) {
    usage.note(`Tavily monthly/run cap reached — skipping query "${query}"`);
    return null;
  }
  await usage.recordTavilyCall();

  const body = {
    query,
    max_results: maxResults,
    search_depth: 'basic',
    include_answer: false,
    topic,
  };
  if (days) body.days = days; // restricts to results published in the last N days (topic: 'news' only)

  let res;
  try {
    res = await fetch(`${config.TAVILY.baseUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    usage.note(`Tavily request failed for "${query}": ${e.message}`);
    return null;
  }
  if (!res.ok) {
    usage.note(`Tavily returned ${res.status} for "${query}"`);
    return null;
  }
  const data = await res.json();
  const results = (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    publishedDate: r.published_date || null,
  }));
  return { results };
}

module.exports = { search };
