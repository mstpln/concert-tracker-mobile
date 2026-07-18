'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = app.indexOf(`function ${nextName}`, start);
  return app.slice(start, end);
}

test('ready predicted setlists use the dedicated ordered renderer with context, tags, metadata, and footer', () => {
  const panel = functionSource('predictedSetlistPanelHtml', 'predictedMixPanelHtml');
  assert.match(panel, /prediction\.sourceSetlistCount \|\| 0/);
  assert.match(panel, /\$\{confidenceLabel\} confidence/);
  assert.match(panel, /<ol class="setlist-song-list predicted-setlist-song-list">/);
  assert.match(panel, /class="predicted-setlist-song-title"/);
  assert.match(panel, /class="setlist-insight-tags"/);
  assert.match(panel, /class="setlist-insight-tag">\$\{escapeHtml\(song\.evidenceLabel\)\}/);
  assert.match(panel, /Played in \$\{song\.performanceRate \|\| 0\}% of recent setlists/);
  assert.match(panel, /song\.spotifyMatched \? ' · Spotify matched' : ''/);
  assert.match(panel, /class="predicted-setlist-footer"/);
  assert.match(panel, /Updated \$\{escapeHtml\(updated\)\} · setlist\.fm/);
  assert.match(panel, /Create a playlist from the Playlist section\./);
  assert.match(panel, /\.slice\(0, 10\)/);
});

test('predicted panel keeps all non-ready copy and the collapsed summary while replacing the inline ready template', () => {
  const group = functionSource('concertPrepGroupHtml', 'ticketCostFormHtml');
  assert.match(group, /const predicted = prediction\?\.status === 'ready'/);
  assert.match(group, /Prediction is being prepared/);
  assert.match(group, /Not enough recent setlists yet/);
  assert.match(group, /Prediction not available/);
  assert.match(group, /\['prediction', 'setlistOrdered', 'Predicted setlist', predicted, predictedSetlistPanelHtml\(c\)\]/);
  assert.doesNotMatch(group, /Played in \$\{s\.performanceRate/);
});

test('predicted setlist styling is narrow, uses existing tokens, and leaves actual setlist styles intact', () => {
  for (const selector of ['predicted-setlist-context', 'predicted-setlist-song-list', 'predicted-setlist-song-main', 'predicted-setlist-song-title', 'predicted-setlist-song-meta', 'predicted-setlist-footer']) assert.match(css, new RegExp(`\\.${selector}`));
  assert.match(css, /\.predicted-setlist-footer \{[^}]*border-top: 1px solid var\(--border\);/);
  assert.match(css, /\.predicted-setlist-song-meta \{[^}]*color: var\(--text-muted\);/);
  assert.match(css, /\.predicted-setlist-song-title \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.setlist-song-list \{ margin: 8px 0 0;/);
});

test('the generated predicted mix keeps its URL and changed-prediction review flow while its Open CTA becomes primary', () => {
  const panel = functionSource('predictedMixPanelHtml', 'weatherDateLabel');
  assert.match(panel, /<a class="btn-primary" href="\$\{escapeAttr\(generated\.spotifyUrl\)\}" target="_blank" rel="noopener">Open predicted mix<\/a>/);
  assert.match(panel, /The prediction has changed since this mix was created\./);
  assert.match(panel, /Review & create/);
  assert.doesNotMatch(panel, /<a class="btn-secondary"[^>]*>Open predicted mix/);
});
