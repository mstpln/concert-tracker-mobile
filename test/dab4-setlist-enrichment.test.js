'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.SETLISTFM_API_KEY = 'synthetic-setlist-key';

const setlistfm = require('../scripts/lib/setlistfm');
const spotify = require('../scripts/lib/spotify');

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

test('DAB4 setlist 404 is a trustworthy no-match outcome', async () => {
  const calls = usage();
  const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), calls, {
    artistMbid: 'mbid-1',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(outcome, { kind: 'no_match', reason: 'not_found' });
  assert.equal(calls.setlistCalls, 1);
});

test('DAB4 setlist empty success is no-match but malformed success is retryable error', async () => {
  const empty = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [] }) }),
  });
  assert.equal(empty.kind, 'no_match');

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

test('DAB4 matching setlist outcome is normalized and trusted', async () => {
  const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    artistMbid: 'mbid-1',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ setlist: [{
        artist: { mbid: 'mbid-1' },
        venue: { name: 'Example Hall' },
        sets: { set: [{ song: [{ name: 'Own Song' }] }] },
      }] }),
    }),
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

  const noMatchConcert = concert();
  assert.deepEqual(setlistfm.applySetlistOutcome(noMatchConcert, { kind: 'no_match' }, checkedAt), { changed: true, found: false });
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
  assert.equal(noMatch.kind, 'no_match');

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
    { kind: 'no_match' },
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

test('DAB4 scheduled research is wired to structured setlist outcomes', () => {
  const source = fs.readFileSync('scripts/research.js', 'utf8');
  assert.match(source, /findSetlistOutcomeForShow\(c, usage, \{ artistMbid \}\)/);
  assert.match(source, /applySetlistOutcome\(c, outcome\)/);
  assert.doesNotMatch(source, /findSetlistForShow\(c, usage, \{ artistMbid \}\)/);
});
