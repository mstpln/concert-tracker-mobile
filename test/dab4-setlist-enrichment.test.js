'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.SETLISTFM_API_KEY = 'synthetic-setlist-key';

const setlistfm = require('../scripts/lib/setlistfm');
const spotify = require('../scripts/lib/spotify');
const { concertWriteRequired, finalConcertWritePayload } = require('../scripts/research');

function usage({ setlist = true, spotifyAllowed = true } = {}) {
  return {
    setlistCalls: 0,
    spotifyCalls: 0,
    notes: [],
    canCallSetlistfm: () => setlist,
    recordSetlistfmCall: async function () { this.setlistCalls += 1; },
    canCallSpotify: () => spotifyAllowed,
    recordSpotifyCall: async function () { this.spotifyCalls += 1; },
    note(message) { this.notes.push(message); },
  };
}

function concert(extra = {}) {
  return {
    id: 'concert-1',
    bandId: 'band-1',
    bandName: 'Example Band',
    venue: 'Example Hall',
    date: '2026-07-01',
    attending: true,
    rating: 5,
    notes: 'user note',
    ticketPrice: 450,
    unknownFutureField: { keep: true },
    ...extra,
  };
}

function providerSetlist(extra = {}) {
  return {
    eventDate: '01-07-2026',
    artist: { mbid: 'mbid-1', name: 'Example Band' },
    venue: { name: 'Example Hall' },
    sets: { set: [{ song: [{ name: 'Own Song' }] }] },
    ...extra,
  };
}

test('DAB4 setlist search 404 remains retryable instead of becoming durable absence', async () => {
  const calls = usage();
  const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), calls, {
    artistMbid: 'mbid-1',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(outcome, { kind: 'error', status: 404 });
  assert.equal(calls.setlistCalls, 1);
});

test('DAB4 preserves established history 404 contracts outside actual-show enrichment', async () => {
  const recent = await setlistfm.findRecentSetlistsForArtist('mbid-1', usage(), {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(recent, { kind: 'ok', setlists: [] });

  const historical = await setlistfm.findHistoricalSetlistsForArtist('mbid-1', usage(), {
    beforeDate: '2026-07-01',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(historical.kind, 'ok');
  assert.equal(historical.providerExhausted, true);
  assert.equal(historical.historyComplete, true);
  assert.equal(historical.pagesFetched, 1);
});

test('DAB4 preserves the legacy loose venue helper but actual-show matching requires venue evidence', () => {
  assert.equal(setlistfm.venueMatches('', 'Example Hall'), true);
  assert.equal(setlistfm.candidateMatchesShow(providerSetlist({ venue: {} }), concert(), 'mbid-1'), false);
});

test('DAB4 setlist empty success is no-match but malformed success is retryable error', async () => {
  const empty = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [] }) }),
  });
  assert.deepEqual(empty, { kind: 'no_match', reason: 'empty_results' });

  const malformed = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ unexpected: [] }) }),
  });
  assert.equal(malformed.kind, 'error');
  assert.equal(malformed.error, 'invalid_response');
});

test('DAB4 setlist network, HTTP, and usage-cap failures remain retryable', async () => {
  const network = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => { throw new Error('synthetic outage'); },
  });
  assert.equal(network.kind, 'error');

  const http = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(http, { kind: 'error', status: 503 });

  let providerCalled = false;
  const blocked = await setlistfm.findSetlistOutcomeForShow(concert(), usage({ setlist: false }), {
    fetchImpl: async () => { providerCalled = true; throw new Error('must not run'); },
  });
  assert.equal(blocked.kind, 'skipped');
  assert.equal(providerCalled, false);
});

test('DAB4 returned setlist identity must match artist, date, and venue', async () => {
  for (const candidate of [
    providerSetlist({ artist: { mbid: 'different-mbid', name: 'Different Band' } }),
    providerSetlist({ eventDate: '02-07-2026' }),
    providerSetlist({ venue: { name: 'Different Hall' } }),
  ]) {
    const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
      artistMbid: 'mbid-1',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [candidate] }) }),
    });
    assert.deepEqual(outcome, { kind: 'error', error: 'show_identity_conflict' });
  }

  const noMbid = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [providerSetlist({ artist: { name: 'Different Band' } })] }) }),
  });
  assert.deepEqual(noMbid, { kind: 'error', error: 'show_identity_conflict' });
});

test('DAB4 multiple exact returned shows are ambiguous and remain retryable', async () => {
  const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    artistMbid: 'mbid-1',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [providerSetlist(), providerSetlist()] }) }),
  });
  assert.deepEqual(outcome, { kind: 'error', error: 'ambiguous_show_match' });
});

test('DAB4 matching setlist outcome is normalized and trusted', async () => {
  const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    artistMbid: 'mbid-1',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [providerSetlist()] }) }),
  });
  assert.equal(outcome.kind, 'found');
  assert.deepEqual(outcome.setlist.songs, [{ name: 'Own Song', isEncore: false, isCover: false }]);
});

test('DAB4 only trustworthy setlist outcomes advance checked state and user fields survive', () => {
  const checkedAt = '2026-08-12T12:00:00.000Z';
  const failureConcert = concert({ setlistCheckedAt: '2026-01-01T00:00:00.000Z' });
  const beforeFailure = structuredClone(failureConcert);
  assert.deepEqual(setlistfm.applySetlistOutcome(failureConcert, { kind: 'error', status: 503 }, checkedAt), { changed: false, found: false });
  assert.deepEqual(failureConcert, beforeFailure);

  const malformedFoundConcert = concert();
  const beforeMalformedFound = structuredClone(malformedFoundConcert);
  assert.deepEqual(setlistfm.applySetlistOutcome(malformedFoundConcert, { kind: 'found' }, checkedAt), { changed: false, found: false });
  assert.deepEqual(malformedFoundConcert, beforeMalformedFound);

  const malformedNoMatchConcert = concert();
  const beforeMalformedNoMatch = structuredClone(malformedNoMatchConcert);
  assert.deepEqual(setlistfm.applySetlistOutcome(malformedNoMatchConcert, { kind: 'no_match' }, checkedAt), { changed: false, found: false });
  assert.deepEqual(malformedNoMatchConcert, beforeMalformedNoMatch);

  const noMatchConcert = concert();
  assert.deepEqual(setlistfm.applySetlistOutcome(noMatchConcert, { kind: 'no_match', reason: 'empty_results' }, checkedAt), { changed: true, found: false });
  assert.equal(noMatchConcert.setlistCheckedAt, checkedAt);
  assert.equal(noMatchConcert.notes, 'user note');
  assert.equal(noMatchConcert.ticketPrice, 450);
  assert.deepEqual(noMatchConcert.unknownFutureField, { keep: true });

  const foundConcert = concert();
  const setlist = { songs: [{ name: 'Own Song', isEncore: false, isCover: false }] };
  assert.deepEqual(setlistfm.applySetlistOutcome(foundConcert, { kind: 'found', setlist }, checkedAt), { changed: true, found: true });
  assert.equal(foundConcert.setlistCheckedAt, checkedAt);
  assert.deepEqual(foundConcert.setlist, setlist);
  assert.equal(foundConcert.rating, 5);
});

test('DAB4 Spotify search distinguishes real no-match from transient provider failure', async () => {
  const noMatch = await spotify.searchTrackOutcome('Song', 'Example Band', usage(), {
    getToken: async () => 'synthetic-token',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tracks: { items: [] } }) }),
  });
  assert.deepEqual(noMatch, { kind: 'no_match', reason: 'no_artist_match' });

  const http = await spotify.searchTrackOutcome('Song', 'Example Band', usage(), {
    getToken: async () => 'synthetic-token',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(http, { kind: 'error', status: 503 });

  const malformed = await spotify.searchTrackOutcome('Song', 'Example Band', usage(), {
    getToken: async () => 'synthetic-token',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tracks: {} }) }),
  });
  assert.equal(malformed.kind, 'error');
  assert.equal(malformed.error, 'invalid_response');
});

test('DAB4 Spotify malformed token fails before track search', async () => {
  let providerCalled = false;
  const outcome = await spotify.searchTrackOutcome('Song', 'Example Band', usage(), {
    getToken: async () => '',
    fetchImpl: async () => { providerCalled = true; throw new Error('must not run'); },
  });
  assert.deepEqual(outcome, { kind: 'error', error: 'invalid_token' });
  assert.equal(providerCalled, false);
});

test('DAB4 Spotify 429 retry is bounded and invalid delay uses conservative fallback', async () => {
  const calls = usage();
  let providerCalls = 0;
  const waits = [];
  const outcome = await spotify.searchTrackOutcome('Song', 'Example Band', calls, {
    getToken: async () => 'synthetic-token',
    sleepImpl: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      providerCalls += 1;
      return { ok: false, status: 429, headers: { get: () => '-1' } };
    },
  });
  assert.deepEqual(outcome, { kind: 'error', status: 429 });
  assert.equal(providerCalls, 2);
  assert.equal(calls.spotifyCalls, 2);
  assert.deepEqual(waits, [3000]);
});

test('DAB4 Spotify long Retry-After defers without sleeping or retrying', async () => {
  const calls = usage();
  let providerCalls = 0;
  let slept = false;
  const outcome = await spotify.searchTrackOutcome('Song', 'Example Band', calls, {
    getToken: async () => 'synthetic-token',
    sleepImpl: async () => { slept = true; },
    fetchImpl: async () => {
      providerCalls += 1;
      return { ok: false, status: 429, headers: { get: () => '120' } };
    },
  });
  assert.deepEqual(outcome, { kind: 'error', status: 429, retryAfter: 120 });
  assert.equal(providerCalls, 1);
  assert.equal(calls.spotifyCalls, 1);
  assert.equal(slept, false);
});

test('DAB4 Spotify usage skip makes zero provider calls and stays retryable', async () => {
  let tokenCalled = false;
  let providerCalled = false;
  const outcome = await spotify.searchTrackOutcome('Song', 'Example Band', usage({ spotifyAllowed: false }), {
    getToken: async () => { tokenCalled = true; return 'synthetic-token'; },
    fetchImpl: async () => { providerCalled = true; return { ok: true, status: 200 }; },
  });
  assert.equal(outcome.kind, 'skipped');
  assert.equal(tokenCalled, false);
  assert.equal(providerCalled, false);
});

test('DAB4 Spotify no-match becomes checked while provider error stays unchecked', async () => {
  const songs = [{ name: 'No Match', isCover: false }, { name: 'Provider Error', isCover: false }, { name: 'Later Song', isCover: false }];
  const outcomes = [
    { kind: 'no_match', reason: 'no_artist_match' },
    { kind: 'error', status: 503 },
    { kind: 'ok', url: 'https://open.spotify.com/track/should-not-run' },
  ];
  let index = 0;
  const added = await spotify.resolveSongLinks(songs, 'Example Band', usage(), {
    search: async () => outcomes[index++],
  });
  assert.equal(added, 0);
  assert.equal(index, 2);
  assert.equal(songs[0].spotifyChecked, true);
  assert.equal(songs[1].spotifyChecked, undefined);
  assert.equal(songs[2].spotifyChecked, undefined);
});

test('DAB4 Spotify malformed success and no-match stay unchecked and stop the pass', async () => {
  for (const malformed of [{ kind: 'ok' }, { kind: 'no_match' }]) {
    const songs = [{ name: 'Malformed', isCover: false }, { name: 'Later Song', isCover: false }];
    let calls = 0;
    const added = await spotify.resolveSongLinks(songs, 'Example Band', usage(), {
      search: async () => { calls += 1; return malformed; },
    });
    assert.equal(added, 0);
    assert.equal(calls, 1);
    assert.equal(songs[0].spotifyChecked, undefined);
    assert.equal(songs[0].spotifyUrl, undefined);
    assert.equal(songs[1].spotifyChecked, undefined);
  }
});

test('DAB4 Spotify preserves successful partial progress before a transient stop', async () => {
  const songs = [{ name: 'Matched', isCover: false }, { name: 'Fails', isCover: false }, { name: 'Cover', isCover: true }];
  const outcomes = [{ kind: 'ok', url: 'https://open.spotify.com/track/synthetic' }, { kind: 'error', error: 'network' }];
  let index = 0;
  const added = await spotify.resolveSongLinks(songs, 'Example Band', usage(), {
    search: async () => outcomes[index++],
  });
  assert.equal(added, 1);
  assert.equal(songs[0].spotifyChecked, true);
  assert.equal(songs[0].spotifyUrl, 'https://open.spotify.com/track/synthetic');
  assert.equal(songs[1].spotifyChecked, undefined);
  assert.equal(songs[2].spotifyChecked, undefined);
});

test('DAB4 latest-read concert merge preserves newer setlist data and only adds compatible Spotify fields', () => {
  const stale = concert({
    setlistCheckedAt: '2026-08-12T12:00:00.000Z',
    setlist: {
      tourName: 'Old Tour',
      songs: [
        { name: 'Own Song', isEncore: false, isCover: false, spotifyChecked: true, spotifyUrl: 'https://open.spotify.com/track/stale' },
        { name: 'Second Song', isEncore: false, isCover: false, spotifyChecked: true },
      ],
    },
  });
  const latest = concert({
    setlistCheckedAt: '2026-08-12T13:00:00.000Z',
    notes: 'newer user note',
    unknownFutureField: { keep: 'newer' },
    setlist: {
      tourName: 'New Tour',
      futureSetlistField: { keep: true },
      songs: [
        { name: 'Own Song', isEncore: false, isCover: false, spotifyChecked: true, spotifyUrl: 'https://open.spotify.com/track/newer', futureSongField: 1 },
        { name: 'Second Song', isEncore: false, isCover: false, futureSongField: 2 },
      ],
    },
  });
  const [merged] = finalConcertWritePayload([stale], [], {
    latestConcerts: [latest],
    pipelineUpdatedIds: new Set([stale.id]),
  });
  assert.equal(merged.notes, 'newer user note');
  assert.deepEqual(merged.unknownFutureField, { keep: 'newer' });
  assert.equal(merged.setlistCheckedAt, '2026-08-12T13:00:00.000Z');
  assert.equal(merged.setlist.tourName, 'New Tour');
  assert.deepEqual(merged.setlist.futureSetlistField, { keep: true });
  assert.equal(merged.setlist.songs[0].spotifyUrl, 'https://open.spotify.com/track/newer');
  assert.equal(merged.setlist.songs[0].futureSongField, 1);
  assert.equal(merged.setlist.songs[1].spotifyChecked, true);
  assert.equal(merged.setlist.songs[1].futureSongField, 2);
});

test('DAB4 latest-read concert merge fails closed when setlist song identity changed concurrently', () => {
  const stale = concert({
    setlistCheckedAt: '2026-08-12T12:00:00.000Z',
    setlist: { songs: [{ name: 'Own Song', isEncore: false, isCover: false, spotifyChecked: true }] },
  });
  const latest = concert({
    setlistCheckedAt: '2026-08-12T13:00:00.000Z',
    setlist: { songs: [{ name: 'Different Song', isEncore: false, isCover: false, futureSongField: true }] },
  });
  const [merged] = finalConcertWritePayload([stale], [], {
    latestConcerts: [latest],
    pipelineUpdatedIds: new Set([stale.id]),
  });
  assert.deepEqual(merged.setlist, latest.setlist);
  assert.equal(merged.setlistCheckedAt, latest.setlistCheckedAt);
});

test('DAB4 concert write gate uses trusted mutations at the production call site', () => {
  assert.equal(concertWriteRequired({ pipelineUpdates: 0 }), false);
  assert.equal(concertWriteRequired({ pipelineUpdates: 1 }), true);
});

test('DAB4 scheduled research is wired to structured setlist outcomes and mutation-only writes', () => {
  const source = fs.readFileSync('scripts/research.js', 'utf8');
  assert.match(source, /findSetlistOutcomeForShow\(c, usage, \{ artistMbid \}\)/);
  assert.match(source, /applySetlistOutcome\(c, outcome\)/);
  assert.doesNotMatch(source, /findSetlistForShow\(c, usage, \{ artistMbid \}\)/);
  assert.match(source, /pipelineUpdates: pipelineUpdatedIds\.size/);
  assert.doesNotMatch(source, /concertWriteRequired\(\{ newConcerts, ticketmasterUpgrades: \[\.\.\.ticketmasterUpgrades\.values\(\)\], setlistChecksAttempted, spotifyConcertsProcessed \}\)/);
});