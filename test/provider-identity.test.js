'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const identities = require('../providerIdentityState');
const ticketmaster = require('../scripts/lib/ticketmaster');
const { mergeProviderIdentityUpdates, runProviderIdentityBackfill } = require('../scripts/provider-identity-backfill');
const { spotifyArtistIdentityForBand } = require('../scripts/research');

process.env.TICKETMASTER_API_KEY = 'test-ticketmaster-key';

const confirmedBand = (id, extra = {}) => ({ id, name: `Band ${id}`, favorite: true, notes: 'preserve', musicbrainz: { mbid: `mb-${id}`, status: 'confirmed', artistName: `Band ${id}` }, ...extra });
const identity = (id, provider = 'spotify') => provider === 'spotify'
  ? { id, artistName: id, url: `https://open.spotify.com/artist/${id}`, status: 'confirmed', confidence: 100, lastAttemptedAt: '2026-07-01T00:00:00.000Z', lastSuccessfulAt: '2026-07-01T00:00:00.000Z' }
  : { id, attractionName: id, url: `https://ticketmaster.test/${id}`, status: 'confirmed', confidence: 100, lastAttemptedAt: '2026-07-01T00:00:00.000Z', lastSuccessfulAt: '2026-07-01T00:00:00.000Z' };

test('provider coverage flags duplicate MusicBrainz, Ticketmaster, and Spotify IDs without counting them as healthy', () => {
  const bands = [
    confirmedBand('a', { musicbrainz: { mbid: 'same-mb', status: 'confirmed', ticketmaster: identity('same-tm', 'ticketmaster'), spotify: identity('same-sp') } }),
    confirmedBand('b', { musicbrainz: { mbid: 'same-mb', status: 'confirmed', ticketmaster: identity('same-tm', 'ticketmaster'), spotify: identity('same-sp') } }),
    confirmedBand('c', { musicbrainz: { mbid: 'unique-mb', status: 'confirmed', ticketmaster: identity('unique-tm', 'ticketmaster'), spotify: identity('unique-sp') } }),
  ];
  const coverage = identities.identityCoverage(bands, new Date('2026-07-10T00:00:00.000Z'));
  assert.equal(coverage.musicbrainz.confirmed, 1);
  assert.equal(coverage.ticketmaster.confirmed, 1);
  assert.equal(coverage.spotify.confirmed, 1);
  assert.equal(coverage.ticketmaster.counts.duplicate_conflict, 2);
  assert.deepEqual(coverage.spotify.duplicateConflicts[0].bandIds, ['a', 'b']);
});

test('provider coverage reports explicit retry, review, no-match, error, and unchecked states', () => {
  const now = new Date('2026-07-10T00:00:00.000Z');
  const bands = [
    confirmedBand('review', { musicbrainz: { mbid: 'm1', status: 'confirmed', ticketmaster: { status: 'needs_review' } } }),
    confirmedBand('retry', { musicbrainz: { mbid: 'm2', status: 'confirmed', ticketmaster: { status: 'error', nextEligibleCheckAt: '2026-07-11T00:00:00.000Z' } } }),
    confirmedBand('none', { musicbrainz: { mbid: 'm3', status: 'confirmed', ticketmaster: { status: 'no_match' } } }),
    confirmedBand('error', { musicbrainz: { mbid: 'm4', status: 'confirmed', ticketmaster: { status: 'error' } } }),
    confirmedBand('unchecked', { musicbrainz: { mbid: 'm5', status: 'confirmed' } }),
  ];
  const counts = identities.providerCoverage(bands, 'ticketmaster', now).counts;
  assert.equal(counts.needs_review, 1);
  assert.equal(counts.retry_pending, 1);
  assert.equal(counts.no_match, 1);
  assert.equal(counts.error, 1);
  assert.equal(counts.unchecked, 1);
});

test('provider update merge preserves unrelated fields, newer manual decisions, and deleted bands', () => {
  const existing = confirmedBand('a', { notes: 'keep this', musicbrainz: { mbid: 'm-a', status: 'manual_confirmed', spotify: { id: 'manual', status: 'manual_confirmed' } } });
  const merged = mergeProviderIdentityUpdates([existing], [{ id: 'a', spotify: identity('automatic'), ticketmaster: identity('tm', 'ticketmaster') }, { id: 'deleted', spotify: identity('gone') }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].notes, 'keep this');
  assert.equal(merged[0].musicbrainz.spotify.id, 'manual');
  assert.equal(merged[0].musicbrainz.ticketmaster.id, 'tm');
});

test('provider backfill re-reads latest bands before writing and skips already confirmed identities', async () => {
  const original = confirmedBand('a');
  const latest = confirmedBand('a', { notes: 'new user note', musicbrainz: { mbid: 'mb-a', status: 'confirmed', spotify: { id: 'manual-spotify', status: 'manual_confirmed' } } });
  let reads = 0; let written = null; let saves = 0;
  const usage = { state: { ticketmaster: { callsThisRun: 0 }, spotify: { callsThisRun: 0 } }, finishProviderIdentityRun() {}, save: async () => { saves++; } };
  const summary = await runProviderIdentityBackfill({
    readBands: async () => (++reads === 1 ? [original] : [latest]), writeBands: async (_file, value) => { written = value; }, loadUsage: async () => usage,
    resolveTicketmaster: async () => ({ kind: 'confirmed', identity: identity('tm-a', 'ticketmaster') }),
    resolveSpotify: async () => ({ kind: 'confirmed', identity: identity('sp-a') }), log: () => {}, now: '2026-07-10T00:00:00.000Z',
  });
  assert.equal(reads, 2);
  assert.equal(saves, 1);
  assert.equal(summary.ticketmaster.confirmed, 1);
  assert.equal(written[0].notes, 'new user note');
  assert.equal(written[0].musicbrainz.spotify.id, 'manual-spotify');
  assert.equal(written[0].musicbrainz.ticketmaster.id, 'tm-a');
});

test('manual confirmed provider identities are reused by Ticketmaster and Spotify research', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      assert.match(String(url), /attractionId=manual-tm/);
      return { ok: true, json: async () => ({ _embedded: { events: [] } }) };
    };
    const band = confirmedBand('manual', { musicbrainz: { mbid: 'mb-manual', status: 'confirmed', ticketmaster: { id: 'manual-tm', status: 'manual_confirmed' }, spotify: { id: 'manual-sp', status: 'manual_confirmed' } } });
    await ticketmaster.fetchUpcomingEvents(band, { canCallTicketmaster: () => true, recordTicketmasterCall: async () => {} });
    assert.deepEqual(spotifyArtistIdentityForBand(band), { id: 'manual-sp', source: 'structured_identity' });
  } finally { global.fetch = originalFetch; }
});

test('provider backfill persists real usage summary after a partial failure', async () => {
  let saved = false; let recorded = null;
  const usage = { state: { ticketmaster: { callsThisRun: 1 }, spotify: { callsThisRun: 0 } }, finishProviderIdentityRun: (value) => { recorded = value; }, save: async () => { saved = true; } };
  await assert.rejects(runProviderIdentityBackfill({ readBands: async () => [confirmedBand('a')], loadUsage: async () => usage, resolveTicketmaster: async () => { throw new Error('temporary failure'); }, log: () => {} }), /temporary failure/);
  assert.equal(saved, true);
  assert.equal(recorded.status, 'error');
});

test('Ticketmaster events retain stable provider provenance for attraction and fallback matches', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ _embedded: { events: [{ id: 'event-1', name: 'Band a live', url: 'https://ticketmaster.test/event-1', dates: { start: { localDate: '2026-08-01', localTime: '20:00' } }, _embedded: { attractions: [{ id: 'tm-a', name: 'Band a' }], venues: [{ name: 'Venue', city: { name: 'City' }, country: { name: 'Sweden' } }] } }] } }) });
    const usage = { canCallTicketmaster: () => true, recordTicketmasterCall: async () => {} };
    const [byId] = await ticketmaster.fetchUpcomingEvents(confirmedBand('a', { musicbrainz: { mbid: 'mb-a', status: 'confirmed', ticketmaster: identity('tm-a', 'ticketmaster') } }), usage);
    const [fallback] = await ticketmaster.fetchUpcomingEvents(confirmedBand('a'), usage);
    assert.deepEqual({ sourceProvider: byId.sourceProvider, providerEventId: byId.providerEventId, providerAttractionId: byId.providerAttractionId, artistMatchMethod: byId.artistMatchMethod }, { sourceProvider: 'ticketmaster', providerEventId: 'event-1', providerAttractionId: 'tm-a', artistMatchMethod: 'confirmed_attraction_id' });
    assert.equal(fallback.artistMatchMethod, 'validated_name_fallback');
  } finally { global.fetch = originalFetch; }
});

test('provider backfill workflow is manual, main-only, and uses the shared write queue with only provider secrets', () => {
  const workflow = fs.readFileSync('.github/workflows/provider-identity-backfill.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /BACKFILL_PROVIDER_IDENTITIES/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /group: live-vault-data-writes/);
  assert.match(workflow, /TICKETMASTER_API_KEY/);
  assert.match(workflow, /SPOTIFY_CLIENT_ID/);
  assert.doesNotMatch(workflow, /TAVILY_API_KEY|GROQ_API_KEY|SETLISTFM_API_KEY/);
  assert.doesNotMatch(workflow, /schedule:|pull_request:|push:/);
});
