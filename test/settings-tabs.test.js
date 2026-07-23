'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

test('Settings uses the existing segmented-tab treatment for Research, Review, and Data', () => {
  assert.match(app, /let settingsTab = 'research'/);
  assert.match(app, /settingsTab = 'research';\n  settingsExpandedTool = null;/);
  assert.match(app, /class="news-subtab-switch settings-subtab-switch"/);
  assert.match(app, /\['research', 'review', 'data'\]/);
  assert.match(app, /aria-label="Settings sections"/);
  assert.match(css, /\.settings-subtab-switch \{ margin-bottom: 18px; \}/);
});

test('Research shows compact expandable cards for the four research providers and retains full provider details', () => {
  assert.match(app, /researchToolOverviewHtml/);
  assert.match(app, /data-research-tool/);
  assert.match(app, /aria-expanded="\$\{isExpanded\}"/);
  assert.match(app, /id: 'ticketmaster'/);
  assert.match(app, /id: 'tavily'/);
  assert.match(app, /tv\.usageCounterEpoch === RESEARCH_KEY_METADATA\.tavily\.usageCounterEpoch/);
  assert.match(app, /id: 'groq'/);
  assert.match(app, /id: 'setlistfm'/);
  assert.doesNotMatch(app, /id: 'spotify',\n      name: 'Spotify'/);
  assert.match(app, /usageServiceCardHtml\(provider\)/);
  assert.match(css, /\.research-tool-details\.is-open \{ display: block; \}/);
});

test('Settings keeps Groq details in its expanded research card, MusicBrainz in Review, and Spotify connection in Data', () => {
  assert.match(app, /function groqSettingsHtml/);
  assert.match(app, /provider\.id === 'groq' \? provider\.groqSettingsHtml/);
  assert.match(app, /MusicBrainz artist review/);
  assert.match(app, /Matches to revisit/);
  assert.match(app, /Spotify playlist creation/);
  assert.match(app, /<p class="section-label">Band status<\/p>/);
  assert.match(app, /<p class="section-label">Data export<\/p>/);
});

test('Data shows duplicate-aware Artist identity coverage with primary statuses, retry timing, and safe compact candidates', () => {
  const coverage = app.slice(app.indexOf('function providerIdentityCoverageHtml'), app.indexOf('async function renderSettingsScreen'));
  assert.match(app, /function providerIdentityCoverageHtml/);
  assert.match(coverage, /Artist identity coverage/);
  assert.match(coverage, /Linked through the confirmed MusicBrainz MBID/);
  assert.match(coverage, /providerDetail\('Ticketmaster'/);
  assert.match(coverage, /providerDetail\('Spotify'/);
  assert.match(coverage, /duplicate conflict/i);
  assert.match(coverage, /temporary error/);
  assert.match(coverage, /retries scheduled/);
  assert.match(coverage, /providerIdentityCandidatesHtml/);
  assert.match(app, /providerIdentityCandidateUrl/);
  assert.doesNotMatch(coverage, /Retry pending/);
  assert.match(css, /\.provider-identity-row/);
  assert.match(css, /\.provider-identity-candidate/);
  assert.doesNotMatch(coverage, /token|secret|apikey/i);
});

test('Changing Settings tabs leaves existing controls mounted only where needed without changing the app shell', () => {
  assert.match(app, /el\('change-connection-btn'\)\?\.addEventListener/);
  assert.match(app, /el\('save-groq-key'\)\?\.addEventListener/);
  assert.match(app, /el\('recheck-btn'\)\?\.addEventListener/);
  assert.match(app, /wireArtistIdentityReview\(\);/);
  assert.match(app, /function showSettingsScreen[\s\S]*setHeaderChrome\(\{ showBack: true, title: 'Settings' \}\)/);
  assert.doesNotMatch(app, /settingsTabsHtml[\s\S]*brand-banner/);
});
