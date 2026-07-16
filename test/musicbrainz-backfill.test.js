'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../scripts/lib/config');
const { runMusicbrainzBackfill } = require('../scripts/musicbrainz-backfill');
const { UsageTracker, freshState, ensureMusicbrainzState } = require('../scripts/lib/usageTracker');

function fakeUsage() {
  return {
    state: { musicbrainz: { callsThisRun: 0 }, lastRun: { mode: 'weekly', preserved: true }, lastMusicbrainzRun: null },
    summaries: [], saveCalls: 0,
    finishMusicbrainzRun(summary) { this.state.lastMusicbrainzRun = { mode: 'musicbrainz-only', musicbrainzCalls: this.state.musicbrainz.callsThisRun, identityUpdates: 0, ...summary }; this.summaries.push(this.state.lastMusicbrainzRun); },
    async save() { this.saveCalls++; },
  };
}

test('weekly configuration keeps MusicBrainz disabled while the manual runner explicitly enables it', async () => {
  const usage = fakeUsage();
  let received;
  await runMusicbrainzBackfill({
    readBands: async () => [], loadUsage: async () => usage,
    processIdentities: async (options) => { received = options; return { updates: 0 }; }, log: () => {},
  });
  assert.equal(config.MUSICBRAINZ.enabled, false);
  assert.equal(config.MUSICBRAINZ.perRunCap, 5);
  assert.equal(received.enabled, true);
  assert.equal(received.perRunCap, 5);
});

test('manual runner saves MusicBrainz-only success usage without other provider calls', async () => {
  const usage = fakeUsage();
  const calls = [];
  await runMusicbrainzBackfill({
    readBands: async (filename) => { calls.push(filename); return [{ id: 'band' }]; }, loadUsage: async () => usage,
    processIdentities: async ({ bands, usage: receivedUsage }) => {
      calls.push('musicbrainz'); assert.equal(receivedUsage, usage); assert.equal(bands.length, 1);
      usage.state.musicbrainz.callsThisRun = 3;
      return { updates: 2 };
    }, log: () => {},
  });
  assert.deepEqual(calls, ['bands.json', 'musicbrainz']);
  assert.equal(usage.saveCalls, 1);
  assert.deepEqual(usage.summaries[0], { mode: 'musicbrainz-only', status: 'ok', identityUpdates: 2, musicbrainzCalls: 3 });
  assert.deepEqual(usage.state.lastRun, { mode: 'weekly', preserved: true });
  const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'musicbrainz-backfill.js'), 'utf8');
  assert.doesNotMatch(runnerSource, /(ticketmaster|tavily|groq|setlistfm|spotify)/i);
  assert.doesNotMatch(runnerSource, /(concerts\.json|news\.json)/);
});

test('manual runner saves real MusicBrainz usage after a failure', async () => {
  const usage = fakeUsage();
  await assert.rejects(runMusicbrainzBackfill({
    readBands: async () => [{ id: 'band' }], loadUsage: async () => usage,
    processIdentities: async () => { usage.state.musicbrainz.callsThisRun = 2; throw new Error('provider failure'); }, log: () => {},
  }), /provider failure/);
  assert.equal(usage.saveCalls, 1);
  assert.deepEqual(usage.summaries[0], { mode: 'musicbrainz-only', status: 'error', identityUpdates: 0, error: 'provider failure', musicbrainzCalls: 2 });
});

test('manual runner saves provider fatal results once and then fails the workflow', async () => {
  const usage = fakeUsage();
  await assert.rejects(runMusicbrainzBackfill({
    readBands: async () => [{ id: 'band' }], loadUsage: async () => usage,
    processIdentities: async () => { usage.state.musicbrainz.callsThisRun = 1; return { updates: 1, fatalError: 'MusicBrainz HTTP 503' }; }, log: () => {},
  }), /MusicBrainz HTTP 503/);
  assert.equal(usage.saveCalls, 1);
  assert.deepEqual(usage.summaries[0], { mode: 'musicbrainz-only', status: 'error', identityUpdates: 1, error: 'MusicBrainz HTTP 503', musicbrainzCalls: 1 });
});

test('manual and weekly run summaries remain separate and old state stays compatible', () => {
  const state = freshState();
  state.lastRun = { mode: 'weekly', stable: true };
  const tracker = new UsageTracker(state);
  tracker.state.musicbrainz.callsThisRun = 2;
  tracker.finishMusicbrainzRun({ status: 'ok', identityUpdates: 1 });
  assert.deepEqual(state.lastRun, { mode: 'weekly', stable: true });
  const manualSummary = JSON.parse(JSON.stringify(state.lastMusicbrainzRun));
  new UsageTracker(state).finishRun({ status: 'ok' });
  assert.deepEqual(state.lastMusicbrainzRun, manualSummary);
  const oldState = {}; ensureMusicbrainzState(oldState); assert.equal(oldState.lastMusicbrainzRun, null);
});

test('manual workflow is hardened, queues data writes, and receives no unrelated API secrets', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'musicbrainz.yml'), 'utf8');
  const weekly = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'research.yml'), 'utf8');
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(schedule|push|pull_request):/m);
  assert.match(workflow, /confirm:/); assert.match(workflow, /required: true/); assert.match(workflow, /type: boolean/); assert.match(workflow, /default: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/); assert.match(workflow, /contents: read/); assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /group: live-vault-data-writes/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /queue: max/);
  assert.match(weekly, /group: live-vault-data-writes/);
  assert.match(weekly, /cancel-in-progress: false/);
  assert.match(weekly, /queue: max/);
  const concurrency = (text) => text.match(/concurrency:\n(?:.*\n){0,3}?\s*queue: max/)[0];
  assert.equal(concurrency(workflow), concurrency(weekly));
  assert.match(workflow, /CF_WORKER_ENDPOINT/);
  assert.match(workflow, /CF_WORKER_TOKEN/);
  assert.doesNotMatch(workflow, /(TICKETMASTER|TAVILY|GROQ|SETLISTFM|SPOTIFY)/);
});

test('Settings links and saving guard remain static and safe', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /https:\/\/musicbrainz\.org\/artist\//); assert.match(app, /encodeURIComponent\(String\(c\.mbid/); assert.match(app, /Open MusicBrainz runs/);
  assert.match(app, /Weekly automatic MusicBrainz lookups are off/); assert.match(app, /Saving…/); assert.match(app, /lastMusicbrainzRun/);
});
