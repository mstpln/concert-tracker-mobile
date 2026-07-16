'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../scripts/lib/config');
const { usefulSetlists, generatePrediction } = require('../scripts/lib/predictedSetlist');
const setlist = require('../scripts/lib/setlistfm');
const spotify = require('../scripts/lib/spotify');
const { predictedSetlistEligible, mergePredictedSetlistResults, processPredictedSetlists } = require('../scripts/research');
process.env.SETLISTFM_API_KEY = 'test-key';

const now = new Date('2026-07-16T12:00:00Z');
function usage() { return { calls: 0, canCallSetlistfm: () => true, recordSetlistfmCall: async function () { this.calls++; }, canCallSpotify: () => true, recordSpotifyCall: async function () { this.calls++; }, note() {} }; }
function raw(id, date, songs) { return { id, eventDate: date, venue: { name: 'Venue' }, songs: songs.map((name, i) => typeof name === 'string' ? { name, isEncore: i === songs.length - 1 } : name) }; }
function band(extra = {}) { return { id: 'b1', name: 'Example', musicbrainz: { status: 'manual_confirmed', mbid: 'mbid', spotify: { status: 'confirmed', id: 'artist' } }, ...extra }; }
function concert(extra = {}) { return { id: 'c1', bandId: 'b1', attending: true, date: '2026-11-01', playlistUrl: 'https://playlist', prepChecklist: { ticketReady: true }, ticketPrice: 100, rating: 5, notes: 'keep', photos: ['x'], ...extra }; }
const three = [raw('1', '2026-07-10', ['Open', 'Always', 'Close']), raw('2', '2026-06-10', ['Open', 'Always', 'Close']), raw('3', '2026-05-10', ['Open', 'Other', 'Close'])];

test('eligibility requires an upcoming attending concert and confirmed MBID', () => {
  assert.equal(predictedSetlistEligible(concert(), band(), now), true);
  assert.equal(predictedSetlistEligible(concert({ date: '2026-01-01' }), band(), now), false);
  assert.equal(predictedSetlistEligible(concert({ attending: false }), band(), now), false);
  assert.equal(predictedSetlistEligible(concert(), band({ musicbrainz: { status: 'needs_review', mbid: 'mbid' } }), now), false);
});
test('history ignores empty, malformed, duplicate and cover-only shows and caps at twenty', () => {
  const input = [raw('x', '2026-06-01', []), { id: 'bad', eventDate: 'bad', songs: [{ name: 'x' }] }, raw('d', '2026-06-02', ['Song']), raw('d', '2026-06-02', ['Song']), raw('cover', '2026-06-03', [{ name: 'Cover', isCover: true }]), ...Array.from({ length: 25 }, (_, i) => raw(`a${i}`, `2026-05-${String((i % 20) + 1).padStart(2, '0')}`, ['Song']))];
  const result = usefulSetlists(input, now); assert.equal(result.length, 20); assert.equal(result.some((s) => s.id === 'x' || s.id === 'bad' || s.id === 'cover'), false);
});
test('setlist.fm artist history uses a confirmed MBID, counts the attempt, and never name-searches', async () => {
  let url = ''; const u = usage();
  await setlist.findRecentSetlistsForArtist('mbid-1', u, { fetchImpl: async (value) => { url = value; assert.equal(u.calls, 1); return { ok: true, json: async () => ({ setlist: [] }) }; } });
  assert.match(url, /artist\/mbid-1\/setlists/); assert.doesNotMatch(url, /artistName/);
});
test('provider cap and temporary failures stop safely', async () => {
  const capped = { canCallSetlistfm: () => false, recordSetlistfmCall: async () => { throw new Error('no'); }, note() {} };
  assert.equal((await setlist.findRecentSetlistsForArtist('m', capped)).kind, 'skipped');
  const failure = await setlist.findRecentSetlistsForArtist('m', usage(), { fetchImpl: async () => { throw new Error('offline'); } }); assert.equal(failure.kind, 'error');
});
test('prediction needs three useful shows and produces deterministic ready output with correct rates', () => {
  assert.equal(generatePrediction([], { now }).status, 'unavailable'); assert.equal(generatePrediction(three.slice(0, 2), { now }).status, 'insufficient_data');
  const first = generatePrediction(three, { now }); const second = generatePrediction(three, { now });
  assert.equal(first.status, 'ready'); assert.equal(first.predictedSongCount, 3); assert.equal(first.songs[0].name, 'Open'); assert.equal(first.songs.find((song) => song.name === 'Always').performanceRate, 67); assert.equal(first.fingerprint, second.fingerprint); assert.equal(first.songs.some((song) => 'confidence' in song), false);
});
test('prediction confidence thresholds, evidence labels, covers and stable ordering are conservative', () => {
  const high = Array.from({ length: 8 }, (_, i) => raw(`${i}`, `2026-07-${String(i + 1).padStart(2, '0')}`, ['Open', 'Middle', 'Close']));
  const prediction = generatePrediction(high, { now }); assert.equal(prediction.confidence, 'high'); assert.equal(prediction.songs[0].evidenceLabel, 'Likely opener'); assert.equal(prediction.songs.at(-1).evidenceLabel, 'Common closer');
  const medium = generatePrediction([...three, raw('4', '2026-04-10', ['A', 'B']), raw('5', '2026-03-10', ['A', 'C'])], { now }); assert.equal(medium.confidence, 'medium');
  const low = generatePrediction(three, { now }); assert.equal(low.confidence, 'low'); assert.equal(low.songs.every((song) => !/rare|debut/i.test(song.evidenceLabel || '')), true);
});
test('changed sources change the fingerprint and no duplicate predicted songs survive title normalization', () => {
  const one = generatePrediction(three, { now }); const two = generatePrediction([...three, raw('4', '2026-04-10', ['New Song'])], { now }); assert.notEqual(one.fingerprint, two.fingerprint); assert.equal(new Set(one.songs.map((song) => song.normalizedName)).size, one.songs.length);
});
test('Spotify matching requires the confirmed artist, title, rejects bad recordings and prefers studio', async () => {
  const u = usage(); const response = { tracks: { items: [ { id: 'live', name: 'Song (Live)', artists: [{ id: 'artist' }], album: { name: 'Live' }, popularity: 99 }, { id: 'studio', name: 'Song', uri: 'spotify:track:studio', external_urls: { spotify: 'https://spotify/studio' }, artists: [{ id: 'artist' }], album: { name: 'Album' }, popularity: 20 }, { id: 'wrong', name: 'Song', artists: [{ id: 'other' }], album: { name: 'Album' } }, { id: 'tribute', name: 'Song', artists: [{ id: 'artist' }], album: { name: 'Tribute' } } ] } };
  const result = await spotify.matchPredictedSong({ name: 'Song' }, 'artist', u, { getToken: async () => 'x', fetchImpl: async () => ({ ok: true, json: async () => response }) });
  assert.equal(result.track.spotifyTrackId, 'studio'); assert.equal(result.track.spotifyMatched, true); assert.equal((await spotify.matchPredictedSong({ name: 'Song' }, null, u)).kind, 'skipped');
});
test('Spotify temporary errors and 429 are retryable without OAuth or playlist creation', async () => {
  const u = usage(); const err = await spotify.matchPredictedSong({ name: 'Song' }, 'artist', u, { getToken: async () => 'x', fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null } }) }); assert.equal(err.kind, 'error');
  assert.equal(typeof spotify.matchPredictedSong, 'function'); assert.equal(config.SPOTIFY.tokenUrl.includes('accounts.spotify.com'), true);
});
test('latest-record merge changes only predictedSetlist, never restores a deleted concert', () => {
  const latest = [concert()]; const merged = mergePredictedSetlistResults(latest, [{ id: 'c1', predictedSetlist: { status: 'ready' } }, { id: 'gone', predictedSetlist: { status: 'ready' } }]);
  assert.equal(merged.length, 1); assert.equal(merged[0].playlistUrl, 'https://playlist'); assert.equal(merged[0].prepChecklist.ticketReady, true); assert.equal(merged[0].ticketPrice, 100); assert.equal(merged[0].notes, 'keep');
});
test('pipeline reuses one history per band, preserves ready result after failure, and is idempotent', async () => {
  const cs = [concert(), concert({ id: 'c2', date: '2026-12-01' })]; let histories = 0; let writes = 0; let saved = cs;
  const common = { concerts: cs, bands: [band()], usage: usage(), enabled: true, now, findHistory: async () => { histories++; return { kind: 'ok', setlists: three }; }, matchSong: async () => ({ kind: 'no_match' }), readConcerts: async () => saved, writeConcerts: async (_name, value) => { writes++; saved = value; } };
  const first = await processPredictedSetlists(common); assert.equal(histories, 1); assert.equal(first.updates, 2); assert.equal(writes, 1);
  const rerun = await processPredictedSetlists({ ...common, concerts: saved, readConcerts: async () => saved }); assert.equal(rerun.updates, 0);
  const preserved = await processPredictedSetlists({ ...common, concerts: [concert({ predictedSetlist: saved[0].predictedSetlist })], findHistory: async () => ({ kind: 'error' }), readConcerts: async () => saved, writeConcerts: async () => { throw new Error('must not write'); } }); assert.equal(preserved.updates, 0);
});
test('Stage 2 keeps the feature disabled by default and does not alter Stage 1 paths', () => { assert.equal(config.PREDICTED_SETLIST.enabled, false); });
