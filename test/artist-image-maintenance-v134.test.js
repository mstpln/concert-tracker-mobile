'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const activity = require('../listeningBandActivity');
const maintenance = require('../scripts/lib/artistImageMaintenance');

const NOW = new Date('2026-08-16T12:00:00.000Z');
function band(id, extra = {}) {
  return { id, name: id, keep: { user: true }, ...extra, musicbrainz: { mbid: `00000000-0000-4000-8000-${id.padEnd(12, '0').slice(0, 12)}`, status: 'confirmed', metadata: { artistName: id }, ...(extra.musicbrainz || {}) } };
}
function trusted(id, images = []) { return { id: `spotify-${id}`, status: 'confirmed', artistName: id, images, keepProviderField: true }; }
function aggregateFor(bands, events = []) { return activity.buildAggregate(events, bands, NOW); }

test('eligibility excludes every usable image source before the cap', () => {
  const rows = [
    band('manual', { photoUrl: 'https://images.test/manual.jpg' }),
    band('spotify', { musicbrainz: { spotify: trusted('spotify', [{ url: 'https://images.test/spotify.jpg', width: 640, height: 640 }]) } }),
    band('official', { officialUrl: 'https://artist.test/', artistArtwork: { officialSite: { url: 'https://images.test/official.jpg', source: 'official_site_og_image', sourceUrl: 'https://artist.test/' } }, musicbrainz: { spotify: trusted('official') } }),
    band('missing', { musicbrainz: { spotify: trusted('missing') } }),
  ];
  const plan = maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW });
  assert.deepEqual(plan.items.map((item) => item.bandId), ['missing']);
});

test('all five exclusive listening windows sort in the required widening order', () => {
  const ids = ['recent', 'quarter', 'year', 'older', 'none'];
  const rows = ids.map((id) => band(id, { musicbrainz: { spotify: trusted(id) } }));
  const events = [
    { localBandId: 'recent', listenedAt: '2026-08-15T00:00:00.000Z' },
    { localBandId: 'quarter', listenedAt: '2026-07-01T00:00:00.000Z' },
    { localBandId: 'year', listenedAt: '2026-04-01T00:00:00.000Z' },
    { localBandId: 'older', listenedAt: '2025-01-01T00:00:00.000Z' },
  ];
  const plan = maintenance.planArtistImageMaintenance(rows, aggregateFor(rows, events), { now: NOW });
  assert.deepEqual(plan.items.map((item) => item.bucket), ['fourteenDays', 'threeMonths', 'oneYear', 'allTime', 'noHistory']);
  assert.equal(new Set(plan.items.map((item) => item.bandId)).size, 5);
});

test('priority is bucket, trusted-id subgroup, count, recency, then stable id and caps at ten', () => {
  const rows = [];
  for (let index = 0; index < 12; index += 1) rows.push(band(`b${String(index).padStart(2, '0')}`, { musicbrainz: { spotify: index % 2 ? trusted(String(index)) : undefined } }));
  const events = [
    { localBandId: 'b01', listenedAt: '2026-08-15T10:00:00.000Z' },
    { localBandId: 'b01', listenedAt: '2026-08-14T10:00:00.000Z' },
    { localBandId: 'b00', listenedAt: '2026-08-15T11:00:00.000Z' },
    { localBandId: 'b03', listenedAt: '2026-07-01T10:00:00.000Z' },
  ];
  const plan = maintenance.planArtistImageMaintenance(rows, aggregateFor(rows, events), { now: NOW });
  assert.equal(plan.items.length, 10);
  assert.deepEqual(plan.items.slice(0, 3).map((item) => item.bandId), ['b01', 'b00', 'b03']);
});

test('older all-time activity outranks no history and stale aggregate data disables the lane', () => {
  const rows = [band('older', { musicbrainz: { spotify: trusted('older') } }), band('none', { musicbrainz: { spotify: trusted('none') } })];
  const aggregate = aggregateFor(rows, [{ localBandId: 'older', listenedAt: '2024-01-01T00:00:00.000Z' }]);
  assert.deepEqual(maintenance.planArtistImageMaintenance(rows, aggregate, { now: NOW }).items.map((item) => item.bandId), ['older', 'none']);
  aggregate.generatedAt = '2026-08-01T00:00:00.000Z';
  assert.equal(maintenance.planArtistImageMaintenance(rows, aggregate, { now: NOW }).enabled, false);
});

test('exact lookup stores only validated provider images and preserves unrelated and manual fields', async () => {
  const rows = [band('alpha', { notes: 'mine', musicbrainz: { spotify: trusted('alpha') } })];
  const plan = maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW });
  let written = null;
  const usage = { state: { spotify: { callsThisRun: 0 } } };
  const result = await maintenance.runArtistImageMaintenance({
    plan, plannedBands: rows, bands: rows, usage,
    spotify: {}, getArtist: async (id) => { assert.equal(id, 'spotify-alpha'); usage.state.spotify.callsThisRun += 1; return { kind: 'ok', artist: { id, images: [{ url: 'https://images.test/a.jpg', width: 640, height: 640 }] } }; },
    worker: { readJson: async () => structuredClone(rows), writeJsonStrict: async (_path, value) => { written = value; } }, log: () => {},
  });
  assert.equal(result.updated, 1);
  assert.equal(written[0].photoUrl, undefined);
  assert.equal(written[0].notes, 'mine');
  assert.equal(written[0].musicbrainz.spotify.keepProviderField, true);
  assert.equal(written[0].musicbrainz.spotify.images[0].url, 'https://images.test/a.jpg');
  assert.equal(written[0].musicbrainz.spotify.artistImageMaintenance.status, 'complete');
});

test('missing identity uses conservative resolver first, then exact id lookup in the same selected item', async () => {
  const rows = [band('alpha')];
  const calls = [];
  let written;
  await maintenance.runArtistImageMaintenance({
    plan: maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW }), plannedBands: rows, bands: rows,
    usage: { state: { spotify: { callsThisRun: 0 } } }, spotify: {},
    resolveIdentity: async () => { calls.push('resolve'); return { kind: 'confirmed', identity: trusted('alpha') }; },
    getArtist: async () => { calls.push('exact'); return { kind: 'ok', artist: { id: 'spotify-alpha', images: [] } }; },
    worker: { readJson: async () => structuredClone(rows), writeJsonStrict: async (_path, value) => { written = value; } }, log: () => {},
  });
  assert.deepEqual(calls, ['resolve', 'exact']);
  assert.equal(written[0].musicbrainz.spotify.artistImageMaintenance.status, 'no_image');
  assert.deepEqual(written[0].musicbrainz.spotify.images, []);
});

test('needs-review identity never performs exact lookup or attaches artwork', async () => {
  const rows = [band('alpha')]; let exactCalls = 0; let written;
  await maintenance.runArtistImageMaintenance({
    plan: maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW }), plannedBands: rows, bands: rows,
    usage: { state: { spotify: { callsThisRun: 0 } } }, spotify: {},
    resolveIdentity: async () => ({ kind: 'needs_review', identity: { status: 'needs_review', id: null, reviewCandidates: [{ id: 'candidate' }] } }),
    getArtist: async () => { exactCalls += 1; return { kind: 'ok' }; },
    worker: { readJson: async () => structuredClone(rows), writeJsonStrict: async (_path, value) => { written = value; } }, log: () => {},
  });
  assert.equal(exactCalls, 0);
  assert.equal(written[0].musicbrainz.spotify.status, 'needs_review');
  assert.equal(written[0].musicbrainz.spotify.images, undefined);
});

test('duplicate trusted Spotify identities fail closed without consuming slots', () => {
  const rows = [band('alpha', { musicbrainz: { spotify: trusted('same') } }), band('beta', { musicbrainz: { spotify: trusted('same') } }), band('safe', { musicbrainz: { spotify: trusted('safe') } })];
  const plan = maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW });
  assert.deepEqual(plan.items.map((item) => item.bandId), ['safe']);
});

test('exact no-image outcome is not refreshed unless the trusted identity changes', () => {
  const future = new Date('2027-08-16T12:00:00.000Z');
  const rows = [band('alpha', { musicbrainz: { spotify: { ...trusted('alpha'), artistImageMaintenance: maintenance.attemptState('spotify-alpha', { kind: 'ok', artist: { images: [] } }, NOW) } } })];
  assert.equal(maintenance.planArtistImageMaintenance(rows, activity.buildAggregate([], rows, future), { now: future }).items.length, 0);
  rows[0].musicbrainz.spotify.id = 'spotify-new';
  assert.equal(maintenance.planArtistImageMaintenance(rows, activity.buildAggregate([], rows, future), { now: future }).items.length, 1);
});

test('malformed images fail closed, transient outcomes remain retryable, and conditional conflicts propagate', async () => {
  assert.equal(maintenance.validatedImages([{ url: 'http://images.test/a.jpg', width: 1, height: 1 }]), null);
  assert.equal(maintenance.validatedImages([{ url: 'https://images.test/a.jpg', width: -1, height: 1 }]), null);
  assert.equal(maintenance.attemptState('id', { kind: 'error', status: 503 }, NOW).status, 'error');
  const rows = [band('alpha', { musicbrainz: { spotify: trusted('alpha') } })];
  await assert.rejects(() => maintenance.runArtistImageMaintenance({
    plan: maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW }), plannedBands: rows, bands: rows,
    usage: { state: { spotify: { callsThisRun: 0 } } }, spotify: {},
    getArtist: async () => ({ kind: 'ok', artist: { id: 'spotify-alpha', images: [] } }),
    worker: { readJson: async () => structuredClone(rows), writeJsonStrict: async () => { const error = new Error('conflict'); error.code = 'ETAG_CONFLICT'; throw error; } }, log: () => {},
  }), /conflict/);
});

test('429 stops later selected bands and records retry state without guessed images', async () => {
  const rows = ['alpha', 'beta'].map((id) => band(id, { musicbrainz: { spotify: trusted(id) } }));
  let providerCalls = 0; let written;
  await maintenance.runArtistImageMaintenance({
    plan: maintenance.planArtistImageMaintenance(rows, aggregateFor(rows), { now: NOW }), plannedBands: rows, bands: rows,
    usage: { state: { spotify: { callsThisRun: 0 } } }, spotify: {},
    getArtist: async () => { providerCalls += 1; return { kind: 'error', status: 429, retryAfter: '60' }; },
    worker: { readJson: async () => structuredClone(rows), writeJsonStrict: async (_path, value) => { written = value; } }, log: () => {},
  });
  assert.equal(providerCalls, 1);
  assert.equal(written[0].musicbrainz.spotify.artistImageMaintenance.reason, 'http_429');
  assert.deepEqual(written[0].musicbrainz.spotify.images, []);
  assert.equal(written[1].musicbrainz.spotify.artistImageMaintenance, undefined);
});

test('latest manual artwork or changed trusted identity wins before persistence', () => {
  const planned = [band('alpha', { musicbrainz: { spotify: trusted('alpha') } })];
  const updates = [{ bandId: 'alpha', expectedSpotifyId: 'spotify-alpha', images: [{ url: 'https://images.test/new.jpg', width: 1, height: 1 }], maintenance: { identityId: 'spotify-alpha', status: 'complete' } }];
  const manual = structuredClone(planned); manual[0].photoUrl = 'https://images.test/manual.jpg';
  assert.equal(maintenance.mergeMaintenanceUpdates(manual, planned, updates)[0].musicbrainz.spotify.images.length, 0);
  const changed = structuredClone(planned); changed[0].musicbrainz.spotify = trusted('other');
  assert.equal(maintenance.mergeMaintenanceUpdates(changed, planned, updates)[0].musicbrainz.spotify.id, 'spotify-other');
  const reviewed = structuredClone(planned); reviewed[0].musicbrainz.spotify.status = 'manual_confirmed'; reviewed[0].musicbrainz.spotify.reviewedAt = NOW.toISOString();
  const resolvedUpdate = [{ ...updates[0], expectedSpotifyId: null, identity: { ...trusted('alpha'), status: 'confirmed' } }];
  const mergedReviewed = maintenance.mergeMaintenanceUpdates(reviewed, planned, resolvedUpdate)[0].musicbrainz.spotify;
  assert.equal(mergedReviewed.status, 'manual_confirmed');
  assert.equal(mergedReviewed.reviewedAt, NOW.toISOString());
});

test('integration remains the existing M/W/F leased structured workflow with no new schedule', () => {
  const workflow = fs.readFileSync('.github/workflows/research.yml', 'utf8');
  const research = fs.readFileSync('scripts/research.js', 'utf8');
  assert.match(workflow, /cron:\s*'0 1 \* \* 1,3,5'/);
  assert.match(workflow, /run-with-scheduler-lease\.js structured-research/);
  assert.match(research, /runArtistImageMaintenance/);
  assert.ok(research.indexOf('runArtistImageMaintenance') > research.lastIndexOf("writeJson('news.json'"));
});
