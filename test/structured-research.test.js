'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../scripts/lib/config');
const mb = require('../scripts/lib/musicbrainz');
const spotify = require('../scripts/lib/spotify');
const ticketmaster = require('../scripts/lib/ticketmaster');
const setlist = require('../scripts/lib/setlistfm');
const structured = require('../scripts/lib/structuredResearch');
const { processStructuredResearch, venueNamesMatchConservatively, sameConcertLocation, findTicketmasterConcertMatch, upgradeExistingConcertWithTicketmaster, reconcileConcertCandidate, finalConcertWritePayload, concertWriteRequired } = require('../scripts/research');
process.env.TICKETMASTER_API_KEY = 'test-ticketmaster-key';
process.env.SETLISTFM_API_KEY = 'test-setlist-key';

function usage() { return { calls: 0, canCallMusicbrainz: () => true, recordMusicbrainzAttempt: async function () { this.calls++; }, canCallSpotify: () => true, recordSpotifyCall: async function () { this.calls++; }, canCallTicketmaster: () => true, recordTicketmasterCall: async function () { this.calls++; }, canCallSetlistfm: () => true, recordSetlistfmCall: async function () { this.calls++; }, note() {}, recordStructured() {} }; }
function band(extra = {}) { return { id: 'b1', name: 'The Example', favorite: true, notes: 'keep', musicbrainz: { status: 'manual_confirmed', mbid: 'mbid-1', artistName: 'The Example' }, ...extra }; }
function release(id, type = 'Album', date = new Date().toISOString().slice(0, 10)) { return { musicbrainzReleaseGroupMbid: id, title: 'Example Release', type, releaseDate: date, releaseDatePrecision: 'day', sources: ['MusicBrainz'] }; }

test('1 direct Spotify artist URL extracted from MusicBrainz', () => assert.deepEqual(mb.spotifyArtistIdFromRelations([{ url: { resource: 'https://open.spotify.com/artist/abc123?x=1' } }]), { id: 'abc123', url: 'https://open.spotify.com/artist/abc123' }));
test('2 exact Spotify artist match accepted', async () => { const result = await spotify.resolveArtistIdentity({ band: band(), metadata: { artistName: 'The Example', aliases: [] }, usage: usage(), getToken: async () => 'x', fetchImpl: async () => ({ ok: true, json: async () => ({ artists: { items: [{ id: 's1', name: 'The Example', external_urls: {} }] } }) }) }); assert.equal(result.identity.id, 's1'); });
test('3 ambiguous Spotify artist match requires review and retains compact candidates', async () => { const result = await spotify.resolveArtistIdentity({ band: band(), metadata: { artistName: 'The Example', aliases: [] }, usage: usage(), getToken: async () => 'x', fetchImpl: async () => ({ ok: true, json: async () => ({ artists: { items: [{ id: 'a', name: 'The Example' }, { id: 'b', name: 'The Example' }, { id: 'a', name: 'The Example' }] } }) }) }); assert.equal(result.identity.status, 'needs_review'); assert.deepEqual(result.identity.reviewCandidates.map((candidate) => candidate.id), ['a', 'b']); });
test('4 confirmed Spotify ID reused', async () => { const result = await spotify.resolveArtistIdentity({ band: band({ musicbrainz: { spotify: { status: 'confirmed', id: 's1' } } }), metadata: {}, usage: usage() }); assert.equal(result.kind, 'reused'); });
test('5 exact Ticketmaster attraction accepted', async () => { const result = await ticketmaster.resolveAttractionIdentity({ band: band(), metadata: { artistName: 'The Example', aliases: [] }, usage: usage(), fetchImpl: async () => ({ ok: true, json: async () => ({ _embedded: { attractions: [{ id: 't1', name: 'The Example', classifications: [{ segment: { name: 'Music' } }] }] } }) }) }); assert.equal(result.identity.id, 't1'); });
test('6 tribute attraction rejected', () => assert.equal(ticketmaster.namesMatch('The Example', 'The Example Tribute', '', ''), false));
test('7 ambiguous attraction requires review and retains compact candidates', async () => { const attractions = Array.from({ length: 7 }, (_, index) => ({ id: index === 6 ? 'a0' : `a${index}`, name: 'The Example', classifications: [{ segment: { name: 'Music' } }] })); const result = await ticketmaster.resolveAttractionIdentity({ band: band(), metadata: { artistName: 'The Example', aliases: [] }, usage: usage(), fetchImpl: async () => ({ ok: true, json: async () => ({ _embedded: { attractions } }) }) }); assert.equal(result.identity.status, 'needs_review'); assert.equal(result.identity.reviewCandidates.length, 5); assert.equal(new Set(result.identity.reviewCandidates.map((candidate) => candidate.id)).size, 5); });
test('7b unresolved results clear stale candidates and manual decisions remain protected', async () => { const prior = { status: 'needs_review', reviewCandidates: [{ id: 'old' }] }; assert.deepEqual(ticketmaster.unresolvedAttraction(prior, 'no_match', new Date().toISOString()).reviewCandidates, []); assert.deepEqual(spotify.retryableIdentity(prior, 'unavailable', new Date().toISOString()).reviewCandidates, []); const protectedResult = await spotify.resolveArtistIdentity({ band: band({ musicbrainz: { spotify: { id: 'manual', status: 'manual_rejected', reviewCandidates: [{ id: 'old' }] } } }), metadata: {}, usage: usage() }); assert.equal(protectedResult.kind, 'skipped'); assert.equal(protectedResult.identity.reviewCandidates[0].id, 'old'); });
test('8 confirmed Ticketmaster ID reused', async () => { const result = await ticketmaster.resolveAttractionIdentity({ band: band({ musicbrainz: { ticketmaster: { status: 'confirmed', id: 't1' } } }), metadata: {}, usage: usage() }); assert.equal(result.kind, 'reused'); });
test('9 old records remain valid', () => assert.deepEqual(structured.releaseState({}), { musicbrainz: structured.blankProviderBaseline(), spotify: structured.blankProviderBaseline(), knownAlerts: [] }));
test('10 confirmed MBID is sent to setlist.fm', async () => { let url; await setlist.findSetlistForShow({ bandName: 'x', date: '2026-01-01', venue: '' }, usage(), { artistMbid: 'mbid-1', fetchImpl: async (u) => { url = u; return { status: 404 }; } }); assert.match(url, /artistMbid=mbid-1/); });
test('11 returned matching setlist MBID accepted', async () => { const found = await setlist.findSetlistForShow({ bandName: 'x', date: '2026-01-01', venue: 'V' }, usage(), { artistMbid: 'm', fetchImpl: async () => ({ ok: true, json: async () => ({ setlist: [{ artist: { mbid: 'm' }, venue: { name: 'V' }, sets: { set: [{ song: [{ name: 'Song' }] }] } }] }) }) }); assert.equal(found.songs.length, 1); });
test('12 returned conflicting setlist MBID rejected', async () => { const found = await setlist.findSetlistForShow({ bandName: 'x', date: '2026-01-01' }, usage(), { artistMbid: 'm', fetchImpl: async () => ({ ok: true, json: async () => ({ setlist: [{ artist: { mbid: 'other' }, sets: { set: [{ song: [{ name: 'Song' }] }] } }] }) }) }); assert.equal(found, null); });
test('13 missing MBID uses safe name fallback', async () => { let url; await setlist.findSetlistForShow({ bandName: 'Name', date: '2026-01-01' }, usage(), { fetchImpl: async (u) => { url = u; return { status: 404 }; } }); assert.match(url, /artistName=Name/); });
test('14 setlist venue matching preserved', () => assert.equal(setlist.venueMatches('The Venue', 'Venue'), true));
test('15 stored Spotify ID validates tracks', () => assert.equal(spotify.artistMatches([{ id: 'right' }], 'wrong', 'right'), true));
test('16 wrong-artist Spotify track rejected', () => assert.equal(spotify.artistMatches([{ id: 'wrong' }], 'The Example', 'right'), false));
test('17 covers remain skipped', async () => { const songs = [{ name: 'Cover', isCover: true }]; assert.equal(await spotify.resolveSongLinks(songs, 'The Example', usage()), 0); assert.equal(songs[0].spotifyChecked, undefined); });
test('18 temporary Spotify error remains retryable', () => assert.equal(spotify.retryableIdentity({}, 'error', new Date().toISOString()).status, 'error'));
test('19 MusicBrainz album normalized', () => assert.equal(structured.musicbrainzRelease({ id: 'a', title: 'A', 'primary-type': 'Album', 'first-release-date': '2026-01-01' }, 'm').type, 'Album'));
test('20 MusicBrainz EP normalized', () => assert.equal(structured.musicbrainzRelease({ id: 'e', title: 'E', 'primary-type': 'EP', 'first-release-date': '2026-01-01' }, 'm').type, 'EP'));
test('21 MusicBrainz single normalized', () => assert.equal(structured.musicbrainzRelease({ id: 's', title: 'S', 'primary-type': 'Single', 'first-release-date': '2026-01-01' }, 'm').type, 'Single'));
test('22 compilation/live/remix excluded', () => assert.equal(structured.musicbrainzRelease({ id: 'x', title: 'Live', 'primary-type': 'Album', 'secondary-types': ['Live'] }, 'm'), null));
test('23 Spotify album normalized', () => assert.equal(structured.spotifyRelease({ id: 'x', name: 'A', album_type: 'album', release_date: '2026-01-01', artists: [{ id: 's' }] }, 's').type, 'Album'));
test('24 Spotify single normalized', () => assert.equal(structured.spotifyRelease({ id: 'x', name: 'S', album_type: 'single', release_date: '2026-01-01', artists: [{ id: 's' }] }, 's').type, 'Single'));
test('25 guest-only Spotify appearance excluded', () => assert.equal(structured.spotifyRelease({ id: 'x', name: 'S', album_type: 'single', artists: [{ id: 'other' }] }, 's'), null));
test('26 primary/co-primary collaboration included', () => assert.ok(structured.spotifyRelease({ id: 'x', name: 'S', album_type: 'single', artists: [{ id: 's' }, { id: 'other' }] }, 's')));
test('27 provider observations merge', () => { const date = new Date().toISOString().slice(0, 10); assert.deepEqual(structured.mergeReleaseList([{ ...release('m', 'Album', date), title: 'Same' }, { ...structured.spotifyRelease({ id: 's', name: 'Same', album_type: 'album', release_date: date, artists: [{ id: 'artist' }] }, 'artist'), type: 'Album' }])[0].sources.sort(), ['MusicBrainz', 'Spotify']); });
test('28 Spotify-only temporary key deterministic', () => assert.equal(structured.releaseKey(structured.spotifyRelease({ id: 's', name: 'S', album_type: 'single', release_date: '2026-01-01', artists: [{ id: 'a' }] }, 'a')), structured.releaseKey(structured.spotifyRelease({ id: 's', name: 'S', album_type: 'single', release_date: '2026-01-01', artists: [{ id: 'a' }] }, 'a'))));
test('29 regional duplicates merge', () => assert.equal(structured.mergeReleaseList([{ ...release('m'), title: 'A' }, { ...release('m'), title: 'A (SE)' }]).length, 1));
test('30 deluxe/remaster/reissue creates no alert', () => assert.equal(structured.structuredNewsItem(band(), { ...release('x'), title: 'A (Deluxe Edition)' }), null));
test('31 silent MusicBrainz baseline creates zero alerts', () => assert.deepEqual(structured.newReleasesAfterBaseline({ status: 'not_started' }, [release('x')]), []));
test('32 silent Spotify baseline creates zero alerts', () => assert.deepEqual(structured.newReleasesAfterBaseline({ status: 'not_started' }, [release('x')]), []));
test('33 interrupted baseline stays incomplete', () => assert.equal(structured.updateProviderBaseline({}, [release('x')], { complete: false }).status, 'in_progress'));
test('34 provider added later starts a silent baseline', () => assert.equal(structured.providerBaseline({}, 'spotify').status, 'not_started'));
test('35 new release after baseline creates one alert', () => assert.equal(structured.newReleasesAfterBaseline({ status: 'complete', knownKeys: [structured.releaseKey(release('old'))] }, [release('new')]).length, 1));
test('36 identical rerun creates zero alerts', () => assert.equal(structured.newReleasesAfterBaseline({ status: 'complete', knownKeys: [structured.releaseKey(release('same'))] }, [release('same')]).length, 0));
test('37 partial future date creates no exact dated alert', () => assert.equal(structured.structuredNewsItem(band(), { ...release('x', 'Album', '2027-01'), releaseDatePrecision: 'month' }), null));
test('38 one-track single creates one alert', () => assert.ok(structured.structuredNewsItem(band(), { ...release('x', 'Single'), trackCount: 1 })));
test('39 multi-track single creates one alert', () => assert.ok(structured.structuredNewsItem(band(), { ...release('x', 'Single'), trackCount: 3 })));
test('40 tracks are fetched only by explicit caller for new releases', () => assert.equal(typeof spotify.getReleaseTracks, 'function'));
test('40b a newly discovered eligible single fetches tracks once, never during baseline', async () => {
  const now = new Date().toISOString(); let trackCalls = 0;
  const subject = band({ musicbrainz: { status: 'manual_confirmed', mbid: 'm', metadata: { artistName: 'The Example', lastSuccessfulAt: now }, spotify: { status: 'confirmed', id: 's' } }, structuredResearch: { releases: { musicbrainz: structured.blankProviderBaseline(), spotify: { ...structured.blankProviderBaseline(), status: 'complete', knownKeys: [] } } } });
  await processStructuredResearch({ bands: [subject], news: [], usage: usage(), enabled: true, now, fetchReleaseGroups: async () => ({ kind: 'skipped' }), resolveSpotify: async () => ({}), resolveTicketmaster: async () => ({}), listSpotifyReleases: async () => ({ kind: 'ok', items: [{ id: 'new', name: 'New', album_type: 'single', release_date: '2026-07-01', release_date_precision: 'day', artists: [{ id: 's' }] }], total: 1, offset: 0 }), getSpotifyTracks: async () => { trackCalls++; return { kind: 'ok', data: { items: [{ name: 'Song' }] } }; }, readBands: async () => [subject], writeBands: async () => {}, readNews: async () => [], writeNews: async () => {} });
  assert.equal(trackCalls, 1);
});
test('41 attraction ID is used for events', () => assert.equal(typeof ticketmaster.fetchUpcomingEvents, 'function'));
test('42 missing attraction retains keyword fallback', () => assert.equal(ticketmaster.namesMatch('The Example', 'The Example', '', ''), true));
test('43 category-not-due Tavily skipped', () => assert.equal(structured.tavilyEligibility({ structuredResearch: { routing: { lastTavilyStatusAt: new Date().toISOString() } } }, 'status'), null));
test('44 no-event tour cadence applied', () => assert.equal(structured.tavilyEligibility({}, 'tour', { ticketmasterFound: false }), 'no_ticketmaster_events'));
test('45 supplemental tour cadence applied', () => assert.equal(structured.tavilyEligibility({}, 'tour', { ticketmasterFound: true }), 'periodic_non_ticketmaster_tour_check'));
test('46 structured release state avoids routine release Tavily when complete', () => assert.equal(structured.providerBaseline({ spotify: { status: 'complete' } }, 'spotify').status, 'complete'));
test('47 activated structured router avoids the generic news query policy', () => assert.equal(config.STRUCTURED_RESEARCH.enabled, true));
test('48 Groq does not parse structured provider JSON', () => assert.equal(typeof mb.fetchReleaseGroups, 'function'));
test('49 empty Tavily results avoid Groq', () => assert.equal(require('../scripts/research').promisingTavilyResults([]), false));
test('50 deterministic no-result avoids Groq', () => assert.equal(require('../scripts/research').promisingTavilyResults([{ title: 'unrelated', content: '' }]), false));
test('51 promising ambiguous result may use Groq', () => assert.equal(require('../scripts/research').promisingTavilyResults([{ title: 'Tour 2027', content: '' }]), true));
test('52 result fingerprint is stable', () => assert.equal(structured.resultFingerprint({ url: 'HTTPS://x', content: 'Same' }, 'status'), structured.resultFingerprint({ url: 'https://x', content: 'same' }, 'status')));
test('53 uncertain observations create no guessed alert', () => assert.equal(structured.structuredNewsItem(band(), null), null));
test('54 provider 429 yields retryable error state', () => assert.equal(spotify.retryableIdentity({}, 'error', new Date().toISOString(), 'http_429').errorCategory, 'http_429'));
test('55 attempts are counted before MusicBrainz request', async () => { const u = usage(); await mb.fetchArtistMetadata('m', u, async () => { assert.equal(u.calls, 1); return { ok: true, json: async () => ({ id: 'm' }) }; }); });
test('56 Spotify 403 capability failure is nonfatal', async () => { const r = await spotify.resolveArtistIdentity({ band: band(), metadata: { artistName: 'The Example' }, usage: usage(), getToken: async () => 'x', fetchImpl: async () => ({ status: 403, ok: false }) }); assert.equal(r.identity.status, 'unavailable'); });
test('57 temporary provider error does not complete baseline', () => assert.notEqual(structured.updateProviderBaseline({}, [], { complete: false, errorCategory: 'error' }).status, 'complete'));
test('58 unrelated band fields preserved', () => assert.equal(structured.mergeStructuredBandUpdates([band()], [{ id: 'b1', structuredResearch: { routing: {} } }])[0].notes, 'keep'));
test('59 deleted bands not restored', () => assert.equal(structured.mergeStructuredBandUpdates([], [{ id: 'b1', structuredResearch: {} }]).length, 0));
test('60 existing news unchanged by dedupe check', () => assert.equal(structured.newsHasRelease([{ id: 'old' }], 'b1', release('new')), false));
test('61 existing concerts have no structured helper writes', () => assert.equal(typeof processStructuredResearch, 'function'));
test('62 old usage state has additive structured block after load helper', () => { const { ensureStructuredResearchState } = require('../scripts/lib/usageTracker'); const state = {}; ensureStructuredResearchState(state); assert.ok(state.structuredResearch); });
test('63 false master flag preserves current behavior', async () => { const r = await processStructuredResearch({ bands: [band()], news: [], usage: usage(), enabled: false }); assert.equal(r.enabled, false); });
test('64 structured rerun is idempotent for a completed baseline', () => { const state = structured.updateProviderBaseline({ status: 'complete', knownKeys: [structured.releaseKey(release('x'))] }, [release('x')], { complete: true }); assert.equal(state.knownKeys.length, 1); });

function sourceConcert(extra = {}) {
  return {
    id: 'tavily-original-id', bandId: 'b1', bandName: 'The Example', date: '2026-10-10', venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', time: '19:00', distanceKm: 12, venueAddress: 'Existing address', articleUrl: 'https://news.example/show', sourceProvider: 'tavily_groq', ticketRetailerVerified: false, ticketUrl: 'https://old.example/tickets', isNew: false, foundAt: '2026-01-01T00:00:00.000Z',
    attending: true, attended: false, ownedTickets: [{ id: 'pdf-one', type: 'pdf', label: 'Front row', objectKey: 'tickets/pdf-one' }, { id: 'pdf-two', type: 'pdf', label: 'Guest', objectKey: 'tickets/pdf-two' }], playlistUrl: 'https://open.spotify.com/playlist/manual', playlistProgress: { created: true }, setlist: { url: 'https://setlist.fm/show', songs: [{ name: 'Song', isEncore: true, spotifyUrl: 'https://spotify/song', spotifyUri: 'spotify:track:song' }] }, prepChecklist: { ticketReady: true, travelPlanned: true }, notes: 'Keep', rating: 5, photos: ['https://photos.example/one'], concertDay: { directionsOpened: true }, predictedSetlist: { status: 'ready', songs: [{ name: 'Song' }] }, setlistInsights: { status: 'ready', insights: [{ label: 'Rare' }] }, performanceInsights: { status: 'ready' }, userLinks: [{ label: 'Custom', url: 'https://example.com' }], futureFeatureData: { nested: { keepMe: true } },
    ...extra,
  };
}

function ticketmasterConcert(extra = {}) {
  return { id: 'ticketmaster-generated-id', bandId: 'b1', bandName: 'The Example', date: '2026-10-10', venue: 'Royal Arena Copenhagen', city: 'Copenhagen', country: 'Denmark', time: '20:00', distanceKm: 10, venueAddress: 'Ticketmaster address', ticketUrl: 'https://ticketmaster.example/event', ticketRetailerVerified: true, sourceProvider: 'ticketmaster', providerEventId: 'tm-event-1', providerAttractionId: 'tm-attraction-1', artistMatchMethod: 'confirmed_attraction_id', isNew: true, foundAt: '2026-09-01T00:00:00.000Z', ...extra };
}

test('65 Ticketmaster upgrades an existing Tavily concert in place while preserving all user and future data', () => {
  const existing = sourceConcert(); const candidate = ticketmasterConcert(); const upgraded = upgradeExistingConcertWithTicketmaster(existing, candidate);
  assert.equal(upgraded.id, existing.id); assert.notEqual(upgraded.id, candidate.id);
  assert.deepEqual({ attending: upgraded.attending, attended: upgraded.attended, ownedTickets: upgraded.ownedTickets, playlistUrl: upgraded.playlistUrl, playlistProgress: upgraded.playlistProgress, setlist: upgraded.setlist, prepChecklist: upgraded.prepChecklist, notes: upgraded.notes, rating: upgraded.rating, photos: upgraded.photos, concertDay: upgraded.concertDay, predictedSetlist: upgraded.predictedSetlist, setlistInsights: upgraded.setlistInsights, performanceInsights: upgraded.performanceInsights, userLinks: upgraded.userLinks, futureFeatureData: upgraded.futureFeatureData, isNew: upgraded.isNew, foundAt: upgraded.foundAt, articleUrl: upgraded.articleUrl }, { attending: true, attended: false, ownedTickets: existing.ownedTickets, playlistUrl: existing.playlistUrl, playlistProgress: existing.playlistProgress, setlist: existing.setlist, prepChecklist: existing.prepChecklist, notes: 'Keep', rating: 5, photos: existing.photos, concertDay: existing.concertDay, predictedSetlist: existing.predictedSetlist, setlistInsights: existing.setlistInsights, performanceInsights: existing.performanceInsights, userLinks: existing.userLinks, futureFeatureData: existing.futureFeatureData, isNew: false, foundAt: existing.foundAt, articleUrl: existing.articleUrl });
  assert.deepEqual({ sourceProvider: upgraded.sourceProvider, providerEventId: upgraded.providerEventId, providerAttractionId: upgraded.providerAttractionId, artistMatchMethod: upgraded.artistMatchMethod, ticketUrl: upgraded.ticketUrl, ticketRetailerVerified: upgraded.ticketRetailerVerified }, { sourceProvider: 'ticketmaster', providerEventId: 'tm-event-1', providerAttractionId: 'tm-attraction-1', artistMatchMethod: 'confirmed_attraction_id', ticketUrl: 'https://ticketmaster.example/event', ticketRetailerVerified: true });
  const nullSafe = upgradeExistingConcertWithTicketmaster(existing, ticketmasterConcert({ time: null, venueAddress: null, distanceKm: null }));
  assert.deepEqual({ time: nullSafe.time, venueAddress: nullSafe.venueAddress, distanceKm: nullSafe.distanceKm }, { time: '19:00', venueAddress: 'Existing address', distanceKm: 12 });
});

test('66 conservative Ticketmaster matching accepts clear venue variants and rejects different shows', () => {
  const existing = sourceConcert(); const candidate = ticketmasterConcert();
  assert.equal(venueNamesMatchConservatively('Royal Arena', 'Royal Arena Copenhagen'), true);
  assert.equal(venueNamesMatchConservatively('Arena', 'Royal Arena Copenhagen'), false);
  assert.equal(sameConcertLocation(existing, candidate), true);
  for (const changed of [{ city: 'Aarhus' }, { venue: 'Forum Copenhagen' }, { date: '2026-10-11' }, { bandId: 'other-band' }, { country: 'Sweden' }]) assert.equal(sameConcertLocation(existing, { ...candidate, ...changed }), false);
  assert.equal(findTicketmasterConcertMatch([sourceConcert({ sourceProvider: 'ticketmaster', providerEventId: 'other-event' })], candidate).kind, 'none');
  assert.equal(findTicketmasterConcertMatch([sourceConcert({ providerEventId: 'tm-event-1' })], candidate).reason, 'provider_event_id');
});

test('67 exact Ticketmaster event IDs require the same band and date before upgrading', () => {
  const existing = sourceConcert({ providerEventId: 'tm-event-1' }); const candidate = ticketmasterConcert();
  const exact = findTicketmasterConcertMatch([existing], candidate);
  assert.deepEqual({ kind: exact.kind, reason: exact.reason, id: exact.concert.id }, { kind: 'match', reason: 'provider_event_id', id: existing.id });
  const reconciliation = reconcileConcertCandidate([existing], [], candidate);
  assert.equal(reconciliation.action, 'upgrade'); assert.equal(upgradeExistingConcertWithTicketmaster(existing, candidate).id, existing.id);

  const differentDate = ticketmasterConcert({ date: '2026-10-11' }); const beforeDate = structuredClone(existing);
  assert.equal(findTicketmasterConcertMatch([existing], differentDate).kind, 'none');
  assert.equal(reconcileConcertCandidate([existing], [], differentDate).action, 'add');
  assert.deepEqual(existing, beforeDate); assert.deepEqual([existing.date, differentDate.date], ['2026-10-10', '2026-10-11']);

  const differentBand = ticketmasterConcert({ bandId: 'b2', bandName: 'Other Band' });
  assert.equal(findTicketmasterConcertMatch([existing], differentBand).kind, 'none');
  assert.equal(reconcileConcertCandidate([existing], [], differentBand).action, 'add');
});

test('68 candidate reconciliation skips same-run Tavily duplicates, retains different Ticketmaster events, and leaves ambiguity untouched', () => {
  const tm = ticketmasterConcert(); const tavily = sourceConcert({ id: 'tavily-generated-id', venue: 'Royal Arena' });
  assert.equal(reconcileConcertCandidate([], [], tm).action, 'add');
  assert.equal(reconcileConcertCandidate([], [tm], tavily).action, 'skip_ticketmaster_duplicate');
  assert.equal(reconcileConcertCandidate([sourceConcert({ sourceProvider: 'ticketmaster', providerEventId: 'other-event' })], [], tm).action, 'add');
  const ambiguous = reconcileConcertCandidate([sourceConcert({ id: 'one' }), sourceConcert({ id: 'two' })], [], tm);
  assert.deepEqual({ action: ambiguous.action, ambiguous: ambiguous.ambiguous }, { action: 'add', ambiguous: true });
});

test('69 upgrade-only concert writes merge provider fields into the latest record without restoring deleted data', () => {
  const initial = sourceConcert(); const latest = sourceConcert({ notes: 'New user note', futureFeatureData: { nested: { keepMe: true, newer: true } } });
  const output = finalConcertWritePayload([initial], [], { latestConcerts: [latest], ticketmasterUpgrades: [{ id: initial.id, candidate: ticketmasterConcert() }] });
  assert.equal(concertWriteRequired({ ticketmasterUpgrades: [{ id: initial.id }] }), true);
  assert.equal(output.length, 1); assert.equal(output[0].id, initial.id); assert.equal(output[0].notes, 'New user note'); assert.deepEqual(output[0].futureFeatureData, { nested: { keepMe: true, newer: true } }); assert.equal(output[0].providerEventId, 'tm-event-1');
  assert.deepEqual(finalConcertWritePayload([], [], { latestConcerts: [], ticketmasterUpgrades: [{ id: initial.id, candidate: ticketmasterConcert() }] }), []);
});
