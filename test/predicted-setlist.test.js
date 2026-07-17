'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../scripts/lib/config');
const { usefulSetlists, generatePrediction } = require('../scripts/lib/predictedSetlist');
const setlist = require('../scripts/lib/setlistfm');
const spotify = require('../scripts/lib/spotify');
const { TRUSTED_MUSICBRAINZ_STATUSES, confirmedMbid, predictedSetlistEligible, predictionDue, spotifySocialArtistId, spotifyArtistIdentityForBand, spotifyEnrichmentDue, enrichPredictionWithSpotify, predictionDiagnostics, mergePredictedSetlistResults, finalConcertWritePayload, processPredictedSetlists } = require('../scripts/research');
const { safeCounter } = require('../scripts/lib/usageTracker');
process.env.SETLISTFM_API_KEY = 'test-key';

const now = new Date('2026-07-16T12:00:00Z');
function usage() { return { calls: 0, canCallSetlistfm: () => true, recordSetlistfmCall: async function () { this.calls++; }, canCallSpotify: () => true, recordSpotifyCall: async function () { this.calls++; }, note() {} }; }
function diagnosticUsage(canCall = true) { return { state: { setlistfm: { callsThisRun: 0, callsToday: 0, dailyCap: config.SETLISTFM.dailyCap, perRunCap: config.SETLISTFM.perRunCap } }, canCallSetlistfm: () => canCall, canCallSpotify: () => true, recordSetlistfmCall: async () => {}, recordSpotifyCall: async () => {}, note() {} }; }
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
test('trusted MusicBrainz status compatibility is explicit and excludes uncertain records', () => {
  assert.deepEqual([...TRUSTED_MUSICBRAINZ_STATUSES].sort(), ['auto_confirmed', 'confirmed', 'manual_confirmed']);
  for (const status of TRUSTED_MUSICBRAINZ_STATUSES) assert.equal(confirmedMbid(band({ musicbrainz: { status, mbid: 'mbid' } })), true);
  assert.equal(confirmedMbid(band({ musicbrainz: { status: 'needs_review', mbid: 'mbid' } })), false);
  assert.equal(confirmedMbid(band({ musicbrainz: { status: 'manual_rejected', mbid: 'mbid' } })), false);
  assert.equal(confirmedMbid(band({ musicbrainz: { status: 'manual_confirmed' } })), false);
});
test('aggregate diagnostics classify eligibility without identifying concert or band records', () => {
  const ready = { status: 'ready', generatedAt: now.toISOString(), fingerprint: 'same' };
  const bands = [band(), band({ id: 'b2', musicbrainz: { status: 'auto_confirmed', mbid: 'm2' } }), band({ id: 'b3', musicbrainz: { status: 'confirmed', mbid: 'm3' } }), band({ id: 'b4', musicbrainz: { status: 'needs_review', mbid: 'm4' } }), band({ id: 'b5', musicbrainz: { mbid: 'm5' } }), band({ id: 'b6', musicbrainz: { status: 'manual_confirmed' } })];
  const concerts = [concert(), concert({ id: 'c2', bandId: 'b2' }), concert({ id: 'c3', bandId: 'b3' }), concert({ id: 'c4', bandId: 'b4' }), concert({ id: 'c5', bandId: 'b5' }), concert({ id: 'c6', bandId: 'b6' }), concert({ id: 'c7', bandId: 'missing' }), concert({ id: 'past', date: '2026-01-01' }), concert({ id: 'not-going', attending: false }), concert({ id: 'not-due', predictedSetlist: ready })];
  const { diagnostics } = predictionDiagnostics(concerts, bands, diagnosticUsage(), now);
  assert.deepEqual({ upcoming: diagnostics.upcomingAttending, missingBand: diagnostics.missingBand, missingMbid: diagnostics.missingMbid, unconfirmed: diagnostics.unconfirmedStatus, accepted: diagnostics.acceptedConfirmedMbid, notDue: diagnostics.predictionNotDue, eligible: diagnostics.eligibleDue }, { upcoming: 8, missingBand: 1, missingMbid: 1, unconfirmed: 2, accepted: 4, notDue: 1, eligible: 3 });
  assert.deepEqual(diagnostics.unacceptedStatuses, { needs_review: 1, missing: 1 });
  assert.deepEqual(diagnostics.quota, { callsThisRun: 0, callsToday: 0, dailyCap: config.SETLISTFM.dailyCap, perRunCap: config.SETLISTFM.perRunCap, blockedBeforeFirstRequest: false });
});
test('quota block prevents the first prediction history attempt and logs only aggregates', async () => {
  const logs = []; let historyCalls = 0;
  const result = await processPredictedSetlists({ concerts: [concert()], bands: [band({ name: 'Private Band', musicbrainz: { status: 'manual_confirmed', mbid: 'secret-mbid' } })], usage: diagnosticUsage(false), enabled: true, now, findHistory: async () => { historyCalls++; return { kind: 'ok', setlists: three }; }, readConcerts: async () => { throw new Error('no read'); }, writeConcerts: async () => { throw new Error('no write'); }, log: (line) => logs.push(line) });
  assert.equal(historyCalls, 0); assert.equal(result.diagnostics.historyRequestsAttempted, 0); assert.equal(result.diagnostics.setlistQuotaBlocked, 1); assert.equal(logs.join(' '), logs.join(' ').replace(/Private Band|secret-mbid/g, ''));
});
test('successful history requests and malformed quota counters produce safe aggregate diagnostics', async () => {
  const u = diagnosticUsage(); u.state.setlistfm.callsToday = 'bad'; u.state.setlistfm.callsThisRun = -1;
  assert.equal(safeCounter(u.state.setlistfm.callsToday), 0); assert.equal(safeCounter(u.state.setlistfm.callsThisRun), 0);
  let saved = [concert()]; const result = await processPredictedSetlists({ concerts: saved, bands: [band()], usage: u, enabled: true, now, findHistory: async () => ({ kind: 'ok', setlists: three }), generate: () => ({ status: 'ready', fingerprint: 'fresh', songs: [] }), readConcerts: async () => saved, writeConcerts: async (_name, value) => { saved = value; }, log: () => {} });
  assert.equal(result.diagnostics.historyRequestsAttempted, 1); assert.equal(result.diagnostics.historyRequestsSuccessful, 1); assert.equal(result.diagnostics.readyPredictionsGenerated, 1); assert.equal(result.diagnostics.updatesWritten, 1);
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
  const common = { concerts: cs, bands: [band()], usage: usage(), enabled: true, now, findHistory: async () => { histories++; return { kind: 'ok', setlists: three }; }, matchSong: async () => ({ kind: 'no_match' }), readConcerts: async () => saved, writeConcerts: async (_name, value) => { writes++; saved = value; }, log: () => {} };
  const first = await processPredictedSetlists(common); assert.equal(histories, 1); assert.equal(first.updates, 2); assert.equal(writes, 1);
  const laterWrite = first.concerts.map((item) => item.id === 'c2' ? { ...item, setlistCheckedAt: 'later' } : item); const finalSaved = finalConcertWritePayload(laterWrite, []); assert.equal(finalSaved[0].predictedSetlist.status, 'ready'); assert.equal(finalSaved[1].setlistCheckedAt, 'later');
  const rerun = await processPredictedSetlists({ ...common, concerts: saved, readConcerts: async () => saved }); assert.equal(rerun.updates, 0);
  const preserved = await processPredictedSetlists({ ...common, concerts: [concert({ predictedSetlist: saved[0].predictedSetlist })], findHistory: async () => ({ kind: 'error' }), readConcerts: async () => saved, writeConcerts: async () => { throw new Error('must not write'); } }); assert.equal(preserved.updates, 0);
});
test('Stage 2 released configuration enables prediction without altering Stage 1 paths', () => { assert.equal(config.PREDICTED_SETLIST.enabled, true); });
test('predicted Spotify search uses only title and band, then a title-only fallback without display metadata', async () => {
  const requests = []; const u = usage(); let call = 0;
  const response = (items) => ({ ok: true, json: async () => ({ tracks: { items } }) });
  const result = await spotify.matchPredictedSong({ name: 'All the Rage Back Home', performanceRate: 100, evidenceLabel: 'Likely opener', predictedPosition: 1 }, 'artist', u, { bandName: 'Interpol', getToken: async () => 'token', fetchImpl: async (url) => { requests.push(decodeURIComponent(url)); call += 1; return call === 1 ? response([]) : response([{ id: 'track', name: 'All the Rage Back Home', artists: [{ id: 'artist' }], album: { name: 'Album' } }]); } });
  assert.equal(result.kind, 'ok'); assert.equal(requests.length, 2); assert.match(requests[0], /track:"All the Rage Back Home" artist:"Interpol"/); assert.match(requests[1], /track:"All the Rage Back Home"/); assert.doesNotMatch(requests[1], /artist:/); for (const request of requests) assert.doesNotMatch(request, /Played in 100%|Likely opener|Common closer|predictedPosition/);
});
test('predicted Spotify matching accepts only exact title and artist, rejects unsuitable recordings, and constructs a missing URI', async () => {
  const u = usage(); const response = { tracks: { items: [
    { id: 'wrong-artist', name: 'Song', artists: [{ id: 'other' }], album: { name: 'Album' } },
    { id: 'wrong-title', name: 'Other Song', artists: [{ id: 'artist' }], album: { name: 'Album' } },
    { id: 'karaoke', name: 'Song', artists: [{ id: 'artist' }], album: { name: 'Karaoke' } },
    { id: 'cover', name: 'Song', artists: [{ id: 'artist' }], album: { name: 'Cover versions' } },
    { id: 'right', name: 'Song', artists: [{ id: 'artist' }], album: { name: 'Studio' }, popularity: 1 },
  ] } };
  const result = await spotify.matchPredictedSong({ name: 'Song' }, 'artist', u, { bandName: 'Band', getToken: async () => 'token', fetchImpl: async () => ({ ok: true, json: async () => response }) });
  assert.deepEqual(result.track, { spotifyTrackId: 'right', spotifyUri: 'spotify:track:right', spotifyUrl: null, spotifyMatched: true });
});
test('Interpol fixture enriches all ten clean predicted titles with mocked Spotify responses', async () => {
  const titles = ['All the Rage Back Home', 'Evil', 'Roland', 'Obstacle 1', 'Wings on Fire', 'The New', 'Slow Hands', 'The Rover', 'NYC', 'PDA'];
  const prediction = { status: 'ready', generatedAt: now.toISOString(), fingerprint: 'interpol', songs: titles.map((name, index) => ({ name, performanceRate: 100, evidenceLabel: index === 0 ? 'Likely opener' : index === 9 ? 'Common closer' : null, spotifyMatched: false })) };
  const requests = []; const enriched = await enrichPredictionWithSpotify(prediction, band({ name: 'Interpol' }), usage(), now, (song, artistId, u, options) => spotify.matchPredictedSong(song, artistId, u, { ...options, getToken: async () => 'token', fetchImpl: async (url) => { const decoded = decodeURIComponent(url); requests.push(decoded); const title = /track:"([^"]+)"/.exec(decoded)?.[1]; return { ok: true, json: async () => ({ tracks: { items: [{ id: `id-${title}`, name: title, artists: [{ id: 'artist' }], album: { name: 'Studio' } }] } }) }; } }));
  assert.equal(enriched.status, 'complete'); assert.equal(enriched.prediction.spotifyMatchedCount, 10); assert.equal(requests.length, 10); assert.ok(requests.every((request) => /artist:"Interpol"/.test(request))); assert.ok(requests.every((request) => !/Played in 100%|Likely opener|Common closer/.test(request)));
});
test('ready predictions missing matching metadata are enrichment-eligible before seven days without setlist.fm history', async () => {
  const ready = { status: 'ready', generatedAt: now.toISOString(), fingerprint: 'same', songs: [{ name: 'Song', spotifyMatched: false }] }; let historyCalls = 0; let saved = [concert({ predictedSetlist: ready })];
  assert.equal(predictionDue(ready, now), false); assert.equal(spotifyEnrichmentDue(ready, spotifyArtistIdentityForBand(band()), now), true);
  const result = await processPredictedSetlists({ concerts: saved, bands: [band()], usage: usage(), enabled: true, now, findHistory: async () => { historyCalls += 1; return { kind: 'ok', setlists: three }; }, matchSong: async () => ({ kind: 'ok', track: { spotifyTrackId: 'id', spotifyUri: 'spotify:track:id', spotifyUrl: null, spotifyMatched: true } }), readConcerts: async () => saved, writeConcerts: async (_name, value) => { saved = value; }, log: () => {} });
  assert.equal(historyCalls, 0); assert.equal(result.updates, 1); assert.equal(saved[0].predictedSetlist.spotifyMatchedCount, 1); assert.equal(saved[0].predictedSetlist.fingerprint, 'same');
});
test('enrichment retains earlier matches, continues after no-match, and records retryable provider outcomes', async () => {
  const ready = { status: 'ready', generatedAt: now.toISOString(), fingerprint: 'same', songs: [{ name: 'Already', spotifyMatched: true, spotifyUri: 'spotify:track:already' }, { name: 'Missing', spotifyMatched: false }, { name: 'Later', spotifyMatched: false }] };
  let calls = 0; const partial = await enrichPredictionWithSpotify(ready, band(), usage(), now, async (song) => { calls += 1; return song.name === 'Missing' ? { kind: 'no_match' } : { kind: 'ok', track: { spotifyTrackId: 'later', spotifyUri: 'spotify:track:later', spotifyMatched: true } }; });
  assert.equal(calls, 2); assert.equal(partial.status, 'partial'); assert.equal(partial.prediction.songs[0].spotifyUri, 'spotify:track:already'); assert.equal(partial.prediction.songs[2].spotifyMatched, true);
  const retry = await enrichPredictionWithSpotify(ready, band(), usage(), now, async () => ({ kind: 'error' }));
  assert.equal(retry.status, 'error'); assert.ok(Date.parse(retry.prediction.spotifyMatchNextEligibleAt) > now.getTime()); assert.equal(retry.prediction.songs[0].spotifyUri, 'spotify:track:already');
});
test('Spotify quota blocking preserves earlier matches, records a retry, and does not block enrichment-only work behind setlist quota', async () => {
  const ready = { status: 'ready', generatedAt: now.toISOString(), fingerprint: 'same', songs: [{ name: 'First', spotifyMatched: false }, { name: 'Second', spotifyMatched: false }] };
  const quotaUsage = { ...usage(), canCallSetlistfm: () => false, canCallSpotify: (() => { let checks = 0; return () => ++checks < 2; })() };
  const blocked = await enrichPredictionWithSpotify(ready, band(), quotaUsage, now, async () => ({ kind: 'ok', track: { spotifyTrackId: 'first', spotifyUri: 'spotify:track:first', spotifyMatched: true } }));
  assert.equal(blocked.status, 'quota_blocked'); assert.equal(blocked.prediction.spotifyMatchedCount, 1); assert.ok(Date.parse(blocked.prediction.spotifyMatchNextEligibleAt) > now.getTime());
  let saved = [concert({ predictedSetlist: ready })]; let historyCalls = 0;
  await processPredictedSetlists({ concerts: saved, bands: [band()], usage: { ...usage(), canCallSetlistfm: () => false }, enabled: true, now, findHistory: async () => { historyCalls += 1; return { kind: 'ok', setlists: three }; }, matchSong: async () => ({ kind: 'ok', track: { spotifyTrackId: 'id', spotifyUri: 'spotify:track:id', spotifyMatched: true } }), readConcerts: async () => saved, writeConcerts: async (_name, value) => { saved = value; }, log: () => {} });
  assert.equal(historyCalls, 0); assert.equal(saved[0].predictedSetlist.spotifyMatchedCount, 2);
});
test('current complete matching is not repeated, while old versions and retryable quota states are backfilled', () => {
  const complete = { status: 'ready', songs: [{ name: 'Song', spotifyMatched: true, spotifyUri: 'spotify:track:id' }], spotifyMatchVersion: config.PREDICTED_SETLIST.spotifyMatchVersion, spotifyMatchStatus: 'complete', spotifyMatchArtistId: 'artist' };
  assert.equal(spotifyEnrichmentDue(complete, { id: 'artist' }, now), false);
  assert.equal(spotifyEnrichmentDue({ ...complete, spotifyMatchVersion: 1 }, { id: 'artist' }, now), true);
  assert.equal(spotifyEnrichmentDue({ ...complete, spotifyMatchStatus: 'quota_blocked', spotifyMatchNextEligibleAt: new Date(now.getTime() - 1).toISOString() }, { id: 'artist' }, now), true);
});
test('Spotify artist identity prefers confirmed structured data and safely accepts only exact official social artist URLs', () => {
  assert.equal(spotifySocialArtistId('https://open.spotify.com/artist/social123?si=x'), 'social123');
  for (const url of ['https://open.spotify.com/playlist/x', 'https://open.spotify.com/album/x', 'https://open.spotify.com/track/x', 'https://open.spotify.com/artist/a/extra', 'https://spotify.com/artist/x', 'https://spoti.fi/x', 'not a url']) assert.equal(spotifySocialArtistId(url), null);
  assert.deepEqual(spotifyArtistIdentityForBand(band({ socials: { spotify: 'https://open.spotify.com/artist/social123' } })), { id: 'artist', source: 'structured_identity' });
  assert.deepEqual(spotifyArtistIdentityForBand(band({ musicbrainz: { status: 'manual_confirmed', mbid: 'mbid' }, socials: { spotify: 'https://open.spotify.com/artist/social123' } })), { id: 'social123', source: 'official_social_url' });
});
test('latest enrichment write preserves manual playlist and unrelated concert fields, while UI exposes state-specific Spotify copy', async () => {
  const ready = { status: 'ready', generatedAt: now.toISOString(), fingerprint: 'same', songs: [{ name: 'Song', spotifyMatched: false }] }; let saved = [concert({ predictedSetlist: ready, predictedPlaylist: { spotifyUrl: 'https://mix' }, setlistInsights: { status: 'ready' } })];
  await processPredictedSetlists({ concerts: saved, bands: [band()], usage: usage(), enabled: true, now, findHistory: async () => { throw new Error('must not fetch history'); }, matchSong: async () => ({ kind: 'ok', track: { spotifyTrackId: 'id', spotifyUri: 'spotify:track:id', spotifyMatched: true } }), readConcerts: async () => saved, writeConcerts: async (_name, value) => { saved = value; }, log: () => {} });
  assert.equal(saved[0].playlistUrl, 'https://playlist'); assert.deepEqual(saved[0].predictedPlaylist, { spotifyUrl: 'https://mix' }); assert.deepEqual(saved[0].setlistInsights, { status: 'ready' }); assert.equal(saved[0].notes, 'keep');
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8'); for (const copy of ['Spotify matching has not run yet.', 'Spotify matching could not be completed yet. It will retry.', 'predicted songs matched on Spotify.']) assert.match(app, new RegExp(copy.replace(/[.?]/g, '\\$&'))); assert.match(app, /if \(!matched\.length\)/);
});
