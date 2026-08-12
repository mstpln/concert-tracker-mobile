'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = require('../scripts/lib/config');
const structured = require('../scripts/lib/structuredResearch');
const { planMusicbrainzResearch } = require('../scripts/lib/musicbrainzResearchSchedule');
const { createMusicbrainzScheduledGate } = require('../scripts/lib/musicbrainzScheduledGate');

const NOW = '2026-08-12T12:00:00.000Z';
const DAY = 86400000;
function iso(daysBefore) { return new Date(Date.parse(NOW) - daysBefore * DAY).toISOString(); }
function future(daysAfter) { return new Date(Date.parse(NOW) + daysAfter * DAY).toISOString(); }
function band(id, extra = {}) {
  return {
    id,
    name: `Band ${id}`,
    musicbrainz: { status: 'manual_confirmed', mbid: `mbid-${id}`, ...(extra.musicbrainz || {}) },
    structuredResearch: extra.structuredResearch || {},
  };
}
function completeState({ metadataDays = 1, releaseDays = 1, releaseNext = future(6) } = {}) {
  return {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(metadataDays) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(releaseDays), nextEligibleCheckAt: releaseNext, knownKeys: [] } } },
  };
}

test('DAB5 schedules no MusicBrainz work when metadata and release state are fresh', () => {
  const b = band('fresh', completeState());
  const plan = planMusicbrainzResearch([b], { now: NOW, perRunCap: 5, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.dueCount, 0);
  assert.deepEqual(plan.selected, []);
});

test('DAB5 gives first-pass slots to distinct bands before a second task for one band', () => {
  const bands = Array.from({ length: 7 }, (_, index) => band(`b${index + 1}`));
  const plan = planMusicbrainzResearch(bands, { now: NOW, perRunCap: 5, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.dueCount, 14);
  assert.equal(plan.selected.length, 5);
  assert.equal(new Set(plan.selected.map((task) => task.bandId)).size, 5);
  assert.ok(plan.selected.every((task) => task.priority === 0));
});

test('DAB5 equal-age bootstrap work favors the band with older overall MusicBrainz activity across runs', () => {
  const alreadyServed = band('a-already-served', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(0) } },
  });
  const untouched = band('z-untouched');
  const plan = planMusicbrainzResearch([alreadyServed, untouched], { now: NOW, perRunCap: 1, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.selected[0].bandId, 'z-untouched');
  assert.equal(plan.selected[0].kind, 'metadata');
});

test('DAB5 unfinished work outranks routine retained refreshes', () => {
  const unfinished = band('unfinished', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(1) } },
    structuredResearch: { releases: { musicbrainz: { status: 'in_progress', continuation: { offset: 100 }, lastAttemptedAt: iso(1) } } },
  });
  const retained = band('retained', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(100) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(20), nextEligibleCheckAt: iso(10) } } },
  });
  const plan = planMusicbrainzResearch([retained, unfinished], { now: NOW, perRunCap: 1, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.selected[0].bandId, 'unfinished');
  assert.equal(plan.selected[0].kind, 'release');
});

test('DAB5 oldest due retained work wins deterministic ties without array-order dependence', () => {
  const newer = band('z-newer', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(95) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(2), nextEligibleCheckAt: future(5) } } },
  });
  const older = band('a-older', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(120) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(2), nextEligibleCheckAt: future(5) } } },
  });
  const plan = planMusicbrainzResearch([newer, older], { now: NOW, perRunCap: 1, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.selected[0].bandId, 'a-older');
  assert.equal(plan.selected[0].kind, 'metadata');
});

test('DAB5 respects MusicBrainz capacity already consumed earlier in the run', () => {
  const bands = Array.from({ length: 5 }, (_, index) => band(`b${index + 1}`));
  const plan = planMusicbrainzResearch(bands, { now: NOW, perRunCap: 5, callsAlreadyUsed: 3, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.remainingCapacity, 2);
  assert.equal(plan.selected.length, 2);
});

test('DAB5 fails closed when planner time or capacity state is invalid', () => {
  const b = band('unsafe');
  const invalidTime = planMusicbrainzResearch([b], { now: 'not-a-date', perRunCap: 5, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(invalidTime.remainingCapacity, 0);
  assert.deepEqual(invalidTime.selected, []);

  const invalidCap = planMusicbrainzResearch([b], { now: NOW, perRunCap: 'not-a-number', metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(invalidCap.remainingCapacity, 0);
  assert.deepEqual(invalidCap.selected, []);

  const invalidUsage = planMusicbrainzResearch([b], { now: NOW, perRunCap: 5, callsAlreadyUsed: -1, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(invalidUsage.remainingCapacity, 0);
  assert.deepEqual(invalidUsage.selected, []);
});

test('DAB5 retains old complete release state without polling a recent marker-less baseline', () => {
  const recent = band('recent', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(1) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(2), knownKeys: [] } } },
  });
  const old = band('old', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(1) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(20), knownKeys: [] } } },
  });
  const plan = planMusicbrainzResearch([recent, old], { now: NOW, perRunCap: 5, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.deepEqual(plan.selected.map((task) => task.key), ['old:release']);
});

test('DAB5 does not inherit a legacy three-day complete release marker', () => {
  const legacy = band('legacy', {
    musicbrainz: { metadata: { artistName: 'Known', lastSuccessfulAt: iso(1) } },
    structuredResearch: { releases: { musicbrainz: { status: 'complete', lastSuccessfulAt: iso(4), nextEligibleCheckAt: iso(1), knownKeys: [] } } },
  });
  const plan = planMusicbrainzResearch([legacy], { now: NOW, perRunCap: 5, metadataRefreshDays: 90, releaseRefreshDays: 7 });
  assert.equal(plan.dueCount, 0);
  assert.deepEqual(plan.selected, []);
});

test('DAB5 persists separate retained intervals for MusicBrainz and scheduled Spotify releases', () => {
  const originalSpotifyDays = config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays;
  config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays = 3;
  try {
    const musicbrainz = structured.updateProviderBaseline(
      structured.providerBaseline({}, 'musicbrainz'), [], { complete: true, now: NOW },
    );
    const spotify = structured.updateProviderBaseline(
      structured.providerBaseline({}, 'spotify'), [], { complete: true, now: NOW },
    );
    assert.equal(musicbrainz.nextEligibleCheckAt, future(config.STRUCTURED_RESEARCH.musicbrainzReleaseRefreshDays));
    assert.equal(spotify.nextEligibleCheckAt, future(3));
    assert.deepEqual(Object.getOwnPropertySymbols(musicbrainz), []);
    assert.deepEqual(Object.getOwnPropertySymbols(spotify), []);
  } finally {
    config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays = originalSpotifyDays;
  }
});

test('DAB5 scheduled gate executes only selected provider operations and keeps later bands eligible', async () => {
  const bands = Array.from({ length: 6 }, (_, index) => band(`b${index + 1}`));
  const calls = [];
  const musicbrainz = {
    fetchArtistMetadata: async (mbid) => { calls.push(`metadata:${mbid}`); return { kind: 'ok', metadata: { mbid } }; },
    fetchReleaseGroups: async (mbid) => { calls.push(`release:${mbid}`); return { kind: 'ok', offset: 0, count: 0, releaseGroups: [] }; },
  };
  const worker = { readJson: async (path) => { assert.equal(path, 'bands.json'); return bands; } };
  const notes = [];
  const usage = { state: { musicbrainz: { callsThisRun: 0 } }, note: (value) => notes.push(value) };
  const gate = createMusicbrainzScheduledGate({ musicbrainz, worker, config, now: () => NOW });

  for (const b of bands) {
    await gate.fetchArtistMetadata(b.musicbrainz.mbid, usage);
    await gate.fetchReleaseGroups(b.musicbrainz.mbid, usage);
  }

  assert.equal(calls.length, config.MUSICBRAINZ.perRunCap);
  assert.equal(new Set(calls.map((value) => value.split(':')[1])).size, config.MUSICBRAINZ.perRunCap);
  assert.ok(calls.includes('metadata:mbid-b5'));
  assert.ok(!calls.includes('metadata:mbid-b6'));
  assert.ok(notes.some((note) => /MusicBrainz scheduler: 12 safe due task\(s\), 5 selected/.test(note)));
});

test('DAB5 duplicate trusted MBIDs fail closed without consuming safe planner capacity', async () => {
  const bands = [
    band('one'),
    band('two', { musicbrainz: { mbid: 'mbid-one' } }),
    ...Array.from({ length: 5 }, (_, index) => band(`safe${index + 1}`)),
  ];
  const calls = [];
  const musicbrainz = {
    fetchArtistMetadata: async (mbid) => { calls.push(mbid); return { kind: 'ok', metadata: {} }; },
    fetchReleaseGroups: async () => { throw new Error('release should not be selected before first-pass metadata'); },
  };
  const usage = { state: { musicbrainz: { callsThisRun: 0 } }, note() {} };
  const gate = createMusicbrainzScheduledGate({ musicbrainz, worker: { readJson: async () => bands }, config, now: () => NOW });
  assert.deepEqual(await gate.fetchArtistMetadata('mbid-one', usage), { kind: 'skipped', reason: 'dab5_not_scheduled' });
  for (let index = 1; index <= 5; index++) await gate.fetchArtistMetadata(`mbid-safe${index}`, usage);
  assert.deepEqual(calls, ['mbid-safe1', 'mbid-safe2', 'mbid-safe3', 'mbid-safe4', 'mbid-safe5']);
});

test('DAB5 scheduler state-read failure skips provider work without failing the research caller', async () => {
  let providerCalls = 0;
  const notes = [];
  const musicbrainz = {
    fetchArtistMetadata: async () => { providerCalls++; return { kind: 'ok' }; },
    fetchReleaseGroups: async () => { providerCalls++; return { kind: 'ok' }; },
  };
  const usage = { state: { musicbrainz: { callsThisRun: 0 } }, note: (value) => notes.push(value) };
  const gate = createMusicbrainzScheduledGate({
    musicbrainz,
    worker: { readJson: async () => { throw new Error('synthetic read failure'); } },
    config,
    now: () => NOW,
  });
  assert.deepEqual(await gate.fetchArtistMetadata('mbid-any', usage), { kind: 'skipped', reason: 'dab5_not_scheduled' });
  assert.deepEqual(await gate.fetchReleaseGroups('mbid-any', usage), { kind: 'skipped', reason: 'dab5_not_scheduled' });
  assert.equal(providerCalls, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /scheduler state unavailable/);
});

test('DAB5 production preload wires the gate and no longer forces three-day MusicBrainz polling', () => {
  const source = fs.readFileSync('scripts/preloadStructuredRun.js', 'utf8');
  assert.match(source, /installMusicbrainzScheduledGate/);
  assert.doesNotMatch(source, /musicbrainzReleaseRefreshDays\s*=\s*3/);
  assert.match(source, /spotifyReleaseRefreshDays\s*=\s*3/);
});
