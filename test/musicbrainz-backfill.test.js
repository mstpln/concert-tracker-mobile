'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { UsageTracker, freshState, ensureMusicbrainzState } = require('../scripts/lib/usageTracker'); const { run } = require('../scripts/musicbrainzBackfill');

function usageWithState() { return new UsageTracker(freshState()); }
function band(id, status) { return { id, name: id, musicbrainz: status ? { status } : undefined }; }

test('weekly configuration keeps MusicBrainz disabled while the manual runner explicitly enables it', () => {
  const config = require('../scripts/lib/config'); assert.equal(config.MUSICBRAINZ.enabled, false);
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'musicbrainz.yml'), 'utf8');
  assert.match(workflow, /MUSICBRAINZ_MANUAL_ENABLED: 'true'/); assert.match(workflow, /node scripts\/musicbrainzBackfill\.js/);
});

test('manual runner saves MusicBrainz-only success usage without other provider calls', async () => {
  const usage = usageWithState(); let saved = 0;
  const result = await run({
    usage,
    loadUsage: async () => usage,
    readJson: async () => [band('one')],
    searchArtist: async (_band, tracker) => { tracker.state.musicbrainz.callsThisRun += 1; return { kind: 'ok', candidates: [] }; },
    identityResult: () => ({ status: 'no_match' }),
    writeJson: async () => {},
    saveUsage: async () => { saved += 1; },
    enabled: true,
  });
  assert.equal(result.status, 'ok'); assert.equal(saved, 1); assert.equal(usage.state.musicbrainz.callsThisRun, 1);
  assert.equal(usage.state.ticketmaster.callsThisRun, 0); assert.equal(usage.state.tavily.callsThisRun, 0); assert.equal(usage.state.groq.callsThisRun, 0);
  assert.equal(usage.state.lastMusicbrainzRun.status, 'ok'); assert.equal(usage.state.lastRun, null);
});

test('manual runner saves real MusicBrainz usage after a failure', async () => {
  const usage = usageWithState(); let saved = 0;
  await assert.rejects(() => run({
    usage,
    loadUsage: async () => usage,
    readJson: async () => [band('one')],
    searchArtist: async (_band, tracker) => { tracker.state.musicbrainz.callsThisRun += 1; throw new Error('boom'); },
    saveUsage: async () => { saved += 1; }, enabled: true,
  }), /boom/);
  assert.equal(saved, 1); assert.equal(usage.state.musicbrainz.callsThisRun, 1); assert.equal(usage.state.lastMusicbrainzRun.status, 'error'); assert.equal(usage.state.lastRun, null);
});

test('manual runner saves provider fatal results once and then fails the workflow', async () => {
  const usage = usageWithState(); let saved = 0;
  await assert.rejects(() => run({ usage, loadUsage: async () => usage, readJson: async () => [band('one')],
    searchArtist: async (_band, tracker) => { tracker.state.musicbrainz.callsThisRun += 1; return { kind: 'fatal', error: 'HTTP 429' }; },
    identityResult: () => null, writeJson: async () => {}, saveUsage: async () => { saved += 1; }, enabled: true }), /HTTP 429/);
  assert.equal(saved, 1); assert.equal(usage.state.musicbrainz.callsThisRun, 1); assert.equal(usage.state.lastMusicbrainzRun.status, 'error');
});

test('manual and weekly run summaries remain separate and old state stays compatible', () => {
  const state = freshState(); const manualSummary = { startedAt: 'a', finishedAt: 'b', status: 'ok' }; state.lastMusicbrainzRun = manualSummary;
  new UsageTracker(state).finishRun({ status: 'ok' });
  assert.deepEqual(state.lastMusicbrainzRun, manualSummary);
  const oldState = {}; ensureMusicbrainzState(oldState); assert.equal(oldState.lastMusicbrainzRun, null);
});

test('manual workflow is hardened, shares the data-write concurrency group, and receives no unrelated API secrets', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'musicbrainz.yml'), 'utf8');
  const structured = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'research.yml'), 'utf8');
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(schedule|push|pull_request):/m);
  assert.match(workflow, /confirm:/); assert.match(workflow, /required: true/); assert.match(workflow, /type: boolean/); assert.match(workflow, /default: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/); assert.match(workflow, /contents: read/); assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /group: live-vault-data-writes/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(structured, /group: live-vault-data-writes/);
  assert.match(structured, /cancel-in-progress: false/);
  assert.doesNotMatch(structured, /queue: max/);
  assert.match(workflow, /CF_WORKER_ENDPOINT/);
  assert.match(workflow, /CF_WORKER_TOKEN/);
  assert.doesNotMatch(workflow, /(TICKETMASTER|TAVILY|GROQ|SETLISTFM|SPOTIFY)/);
});

test('Settings links and saving guard remain static and safe', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /https:\/\/musicbrainz\.org\/artist\//); assert.match(app, /encodeURIComponent\(String\(c\.mbid/); assert.match(app, /Open MusicBrainz runs/);
  assert.match(app, /Weekly automatic MusicBrainz lookups are off/); assert.match(app, /Saving…/); assert.match(app, /lastMusicbrainzRun/);
});
