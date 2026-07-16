'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../scripts/lib/config');
const { runMusicbrainzBackfill } = require('../scripts/musicbrainz-backfill');

function fakeUsage() {
  return {
    state: { musicbrainz: { callsThisRun: 0 } },
    summaries: [], saveCalls: 0,
    finishRun(summary) { this.summaries.push({ ...summary, musicbrainzCalls: this.state.musicbrainz.callsThisRun }); },
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
  assert.deepEqual(usage.summaries[0], { mode: 'musicbrainz-only', status: 'success', identityUpdates: 2, musicbrainzCalls: 3 });
  const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'musicbrainz-backfill.js'), 'utf8');
  assert.doesNotMatch(runnerSource, /(ticketmaster|tavily|groq|setlistfm|spotify)/i);
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

test('manual workflow is dispatch-only, queues data writes, and receives no unrelated API secrets', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'musicbrainz.yml'), 'utf8');
  const weekly = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'research.yml'), 'utf8');
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(schedule|push|pull_request):/m);
  assert.match(workflow, /group: live-vault-data-writes/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(weekly, /group: live-vault-data-writes/);
  assert.match(weekly, /cancel-in-progress: false/);
  assert.match(workflow, /CF_WORKER_ENDPOINT/);
  assert.match(workflow, /CF_WORKER_TOKEN/);
  assert.doesNotMatch(workflow, /(TICKETMASTER|TAVILY|GROQ|SETLISTFM|SPOTIFY)/);
});
