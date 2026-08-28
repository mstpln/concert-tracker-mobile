'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Model = require('../discoverModelV170.js');
const Provider = require('../discoverProviderV170.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const mbid = (n, base = 0x60000000) => `${(base + n).toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
const band = (id, name, artistMbid, status = 'auto_confirmed') => ({ id, name, musicbrainz: { mbid: artistMbid, status } });
const candidate = (artistMbid, name, similarityScore = 1) => ({ artistMbid, name, similarityScore });

test('seed selection uses 14-day count then recency and trusted MBID only', () => {
  const bands = [band('a', 'A', A), band('b', 'B', B), band('c', 'C', C, 'needs_review')];
  const records = {
    a: { bandId: 'a', buckets: { fourteenDays: { listenCount: 4, recencyRank: 2 } } },
    b: { bandId: 'b', buckets: { fourteenDays: { listenCount: 4, recencyRank: 1 } } },
    c: { bandId: 'c', buckets: { fourteenDays: { listenCount: 99, recencyRank: 1 } } },
  };
  assert.deepEqual(Model.selectSeeds({ records }, bands).map((row) => row.seedBandId), ['b', 'a']);
});

test('strongest source wins once and refresh order remains append-only', () => {
  const initial = Model.admitRefresh(Model.emptyState(null), [
    { seedBandId: 'a', seedMbid: A, seedName: 'A', candidates: [candidate(C, 'C', 8), candidate(D, 'D', 2)] },
    { seedBandId: 'b', seedMbid: B, seedName: 'B', candidates: [candidate(C, 'C', 9)] },
  ], [band('a', 'A', A), band('b', 'B', B)], '2026-08-28T09:00:00.000Z');
  assert.deepEqual(initial.groups.map((g) => g.seedMbid), [A, B]);
  assert.deepEqual(initial.groups[0].candidates.map((c) => c.artistMbid), [D]);
  assert.deepEqual(initial.groups[1].candidates.map((c) => c.artistMbid), [C]);
  const next = Model.admitRefresh(initial, [
    { seedBandId: 'b', seedMbid: B, seedName: 'B', candidates: [candidate(E, 'E', 99)] },
    { seedBandId: 'a', seedMbid: A, seedName: 'A', candidates: [candidate(mbid(99), 'F', 99)] },
  ], [band('a', 'A', A), band('b', 'B', B)], '2026-09-05T09:00:00.000Z');
  assert.deepEqual(next.groups.map((g) => g.seedMbid), [A, B]);
  assert.equal(next.groups[0].candidates.at(-1).name, 'F');
  assert.equal(next.groups[1].candidates.at(-1).name, 'E');
});

test('visibility is 10 while retention is 20 and resolution reveals queue tail at bottom', () => {
  const candidates = Array.from({ length: 25 }, (_, i) => candidate(mbid(i + 1), `Band ${i + 1}`, 100 - i));
  const state = Model.admitRefresh(Model.emptyState(null), [{ seedBandId: 'a', seedMbid: A, seedName: 'A', candidates }], [band('a', 'A', A)], '2026-08-28T09:00:00.000Z');
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].candidates.length, 20);
  const visible = Model.visibleGroups(state, [band('a', 'A', A)])[0].candidates;
  assert.equal(visible.length, 10);
  const resolved = Model.resolveCandidate(state, visible[2].artistMbid, 'dismissed', { now: '2026-08-28T10:00:00.000Z' });
  const nextVisible = Model.visibleGroups(resolved, [band('a', 'A', A)])[0].candidates;
  assert.equal(nextVisible.length, 10);
  assert.equal(nextVisible.at(-1).name, 'Band 11');
});

test('decisions and followed MBIDs suppress candidates globally', () => {
  let state = Model.admitRefresh(Model.emptyState(null), [{ seedBandId: 'a', seedMbid: A, seedName: 'A', candidates: [candidate(C, 'C')] }], [band('a', 'A', A)], '2026-08-28T09:00:00.000Z');
  state = Model.resolveCandidate(state, C, 'dismissed', { now: '2026-08-28T10:00:00.000Z' });
  state = Model.admitRefresh(state, [{ seedBandId: 'b', seedMbid: B, seedName: 'B', candidates: [candidate(C, 'C'), candidate(D, 'D')] }], [band('a', 'A', A), band('b', 'B', B), band('d', 'D', D)], '2026-09-05T09:00:00.000Z');
  assert.equal(state.groups.some((g) => g.candidates.some((c) => [C, D].includes(c.artistMbid))), false);
});

test('30 active groups are never discarded to admit a 31st', () => {
  let state = Model.emptyState(null);
  const bands = [];
  for (let i = 0; i < 30; i += 1) {
    const seed = mbid(i + 1, 0x70000000);
    const cand = mbid(i + 1, 0x71000000);
    bands.push(band(`s${i}`, `Seed ${i}`, seed));
    state = Model.admitRefresh(state, [{ seedBandId: `s${i}`, seedMbid: seed, seedName: `Seed ${i}`, candidates: [candidate(cand, `Candidate ${i}`)] }], bands, new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString());
  }
  assert.equal(state.groups.length, 30);
  const extraSeed = mbid(99, 0x72000000);
  const next = Model.admitRefresh(state, [{ seedBandId: 'extra', seedMbid: extraSeed, seedName: 'Extra', candidates: [candidate(mbid(100, 0x73000000), 'Extra Candidate')] }], [...bands, band('extra', 'Extra', extraSeed)], '2026-09-01T00:00:00.000Z');
  assert.equal(next.groups.length, 30);
  assert.equal(next.groups.some((g) => g.seedMbid === extraSeed), false);
});

test('unknown future fields survive append and decision merges', () => {
  const state = Model.admitRefresh({ ...Model.emptyState(null), futureRoot: { keep: true } }, [{ seedBandId: 'a', seedMbid: A, seedName: 'A', futureGroup: 'x', candidates: [{ ...candidate(C, 'C'), futureCandidate: 7 }] }], [band('a', 'A', A)], '2026-08-28T09:00:00.000Z');
  assert.deepEqual(state.futureRoot, { keep: true });
  assert.equal(state.groups[0].candidates[0].futureCandidate, 7);
  state.groups[0].futureGroup = 'x';
  const resolved = Model.resolveCandidate(state, C, 'dismissed', { now: '2026-08-28T10:00:00.000Z' });
  assert.deepEqual(resolved.futureRoot, { keep: true });
});

test('Spotify URL is local name search and tags normalize to two values', () => {
  assert.equal(Model.spotifySearchUrl('Björk & Friends'), 'https://open.spotify.com/search/Bj%C3%B6rk%20%26%20Friends');
  assert.deepEqual(Model.normalizeTags(['Post Punk', 'post-punk', 'Alternative Rock']), ['Post Punk', 'Alternative Rock']);
});

test('freshness threshold is seven days', () => {
  const state = Model.emptyState(null); state.lastSuccessfulRefreshAt = '2026-08-21T09:00:00.000Z';
  assert.equal(Model.isStale(state, Date.parse('2026-08-28T08:59:59.999Z')), false);
  assert.equal(Model.isStale(state, Date.parse('2026-08-28T09:00:00.000Z')), true);
});

test('provider parser and metadata adapter fail closed around malformed rows', () => {
  const rows = Provider.parseSimilarRows([{ artist_mbid: C, name: 'C', score: 3, reference_mbid: A }, { artist_mbid: D, score: 4, reference_mbid: A }, { artist_mbid: E, name: 'E', score: 5, reference_mbid: B }], A);
  assert.deepEqual(rows.map((r) => r.artistMbid), [C]);
  assert.equal(Provider.metadataCandidate({ artist_mbid: C, name: 'C', area: 'Sweden', begin_year: 2001, tag: { artist: [{ tag: 'indie', count: 2 }] } }).beginYear, 2001);
});

test('static shell uses Discover globe, Stats-compatible classes, local Spotify and no Spotify API', () => {
  const ui = fs.readFileSync('discoverV170.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(ui, /TAB_NAV_ICONS\.concerts = 'globe'/);
  assert.match(ui, /class=\"stats-subtabs discover-subtabs news-subtab-switch\"/);
  assert.match(ui, /icon\('spotify'\)/);
  assert.match(ui, /DISCOVER<\/span>\$\{suffix\}/);
  assert.doesNotMatch(ui, /api\.spotify\.com/i);
  assert.match(html, />Discover<\/button>/);
  assert.match(html, /discoverV170\.js/);
});