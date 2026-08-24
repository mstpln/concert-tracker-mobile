'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ticketmaster = require('../scripts/lib/ticketmaster');
const Integrity = require('../scripts/lib/ticketmasterConcertIntegrityV163');
const Audit = require('../scripts/ticketmasterConcertAuditV163');

process.env.TICKETMASTER_API_KEY = 'test-ticketmaster-key';

function band(name, id = name.toLowerCase().replace(/\s+/g, '-'), attractionId = `tm-${id}`) {
  return { id, name, musicbrainz: { status: 'confirmed', mbid: `mb-${id}`, ticketmaster: { id: attractionId, status: 'confirmed' } } };
}

function event({ id, attractionId, attractionName, name, venueId = 'venue-1', venue = 'Royal Arena', city = 'Copenhagen', country = 'Denmark', date = '2026-09-17', time = '20:30:00', status = 'onsale', url = null }) {
  return {
    id,
    name,
    url: url || `https://ticketmaster.test/${id}`,
    source: { name: 'ticketmaster' },
    dates: { start: { localDate: date, localTime: time }, status: { code: status } },
    _embedded: {
      attractions: [{ id: attractionId, name: attractionName }],
      venues: [{ id: venueId, name: venue, city: { name: city }, country: { name: country }, address: { line1: 'Example 1' } }],
    },
  };
}

function usage() {
  return { calls: 0, notes: [], canCallTicketmaster() { return true; }, async recordTicketmasterCall() { this.calls += 1; }, note(value) { this.notes.push(value); } };
}

test('KATSEYE standard plus two Vinyl Room package listings becomes one physical concert', async () => {
  const followed = band('KATSEYE', 'katseye', 'tm-katseye');
  const payload = {
    _embedded: { events: [
      event({ id: 'standard', attractionId: 'tm-katseye', attractionName: 'KATSEYE', name: 'KATSEYE' }),
      event({ id: 'vinyl-a', attractionId: 'tm-katseye', attractionName: 'KATSEYE', name: 'KATSEYE - Vinyl Room Package' }),
      event({ id: 'vinyl-b', attractionId: 'tm-katseye', attractionName: 'KATSEYE', name: 'KATSEYE - Vinyl Room Package' }),
    ] },
    page: { totalPages: 1 },
  };
  const result = await ticketmaster.fetchUpcomingEvents(followed, usage(), { fetchImpl: async () => ({ ok: true, json: async () => payload }), now: '2026-08-24T00:00:00.000Z' });
  assert.equal(result.length, 1);
  assert.equal(result[0].providerEventId, 'standard');
  assert.equal(result[0].providerOfferType, 'standard');
  assert.deepEqual(result[0].alternateProviderOffers.map((offer) => offer.providerEventId), ['vinyl-a', 'vinyl-b']);
});

test('Loreen standard plus VIP sound-check package becomes one physical concert', () => {
  const standard = { id: 'loreen-show', bandId: 'loreen', date: '2026-10-02', time: '20:00', venue: 'Uber Eats Music Hall', city: 'Berlin', country: 'Germany', providerVenueId: 'venue-berlin', providerAttractionId: 'tm-loreen', providerEventId: 'normal', providerEventName: 'Loreen', providerOfferType: 'standard', ticketUrl: 'https://ticketmaster.test/normal' };
  const vip = { ...standard, id: 'loreen-vip', providerEventId: 'vip', providerEventName: 'Loreen - VIP Sound Check Party Ticket', providerOfferType: 'alternate_offer', ticketUrl: 'https://ticketmaster.test/vip' };
  const [merged] = Integrity.collapseTicketmasterOffers([standard, vip]);
  assert.equal(merged.providerEventId, 'normal');
  assert.equal(merged.alternateProviderOffers[0].providerEventId, 'vip');
});

test('genuine same-day shows at the same venue remain separate when times differ materially', () => {
  const first = { bandId: 'artist', date: '2026-09-01', time: '15:00', providerVenueId: 'v1', providerAttractionId: 'a1', providerEventId: 'early', providerEventName: 'Artist', providerOfferType: 'standard' };
  const second = { ...first, time: '20:00', providerEventId: 'late' };
  assert.equal(Integrity.physicalPerformanceMatch(first, second).match, false);
  assert.equal(Integrity.collapseTicketmasterOffers([first, second]).length, 2);
});

test('multi-act same event does not cross-collapse two followed artists', () => {
  const a = { bandId: 'artist-a', date: '2026-09-01', time: '20:00', providerVenueId: 'v1', providerAttractionId: 'a1', providerEventId: 'event', providerEventName: 'Festival VIP Package', providerOfferType: 'alternate_offer' };
  const b = { ...a, bandId: 'artist-b', providerAttractionId: 'a2' };
  assert.equal(Integrity.physicalPerformanceMatch(a, b).match, false);
});

test('unsafe lifecycle events are held and not admitted as ordinary upcoming concerts', async () => {
  const followed = band('Artist', 'artist', 'tm-artist');
  const payload = { _embedded: { events: [event({ id: 'cancelled', attractionId: 'tm-artist', attractionName: 'Artist', name: 'Artist', status: 'canceled' })] }, page: { totalPages: 1 } };
  const tracker = usage();
  const result = await ticketmaster.fetchUpcomingEvents(followed, tracker, { fetchImpl: async () => ({ ok: true, json: async () => payload }), now: '2026-08-24T00:00:00.000Z' });
  assert.deepEqual(result, []);
  assert.match(tracker.notes.join('\n'), /canceled event held/);
});

test('missing venue name is recovered by provider venue ID with a bounded lookup', async () => {
  const followed = band('Artist', 'artist', 'tm-artist');
  const tracker = usage();
  const calls = [];
  const result = await ticketmaster.fetchUpcomingEvents(followed, tracker, {
    now: '2026-08-24T00:00:00.000Z',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/venues/venue-missing.json')) return { ok: true, json: async () => ({ id: 'venue-missing', name: 'Recovered Arena', city: { name: 'Stockholm' }, country: { name: 'Sweden' }, address: { line1: 'Arena 1' } }) };
      return { ok: true, json: async () => ({ _embedded: { events: [event({ id: 'event', attractionId: 'tm-artist', attractionName: 'Artist', name: 'Artist', venueId: 'venue-missing', venue: '' })] }, page: { totalPages: 1 } }) };
    },
  });
  assert.equal(result[0].venue, 'Recovered Arena');
  assert.equal(result[0].providerVenueId, 'venue-missing');
  assert.equal(calls.filter((url) => url.includes('/venues/venue-missing.json')).length, 1);
});

test('collision-prone exact attraction names fail to needs_review when similarly named music candidates exist', async () => {
  const tracker = usage();
  const result = await ticketmaster.resolveAttractionIdentity({
    band: { id: 'queen', name: 'Queen', musicbrainz: { status: 'confirmed' } },
    metadata: { artistName: 'Queen', aliases: [] }, tracker,
    usage: tracker,
    now: '2026-08-24T00:00:00.000Z',
    fetchImpl: async () => ({ ok: true, json: async () => ({
      _embedded: { attractions: [
        { id: 'queen', name: 'Queen', classifications: [{ segment: { name: 'Music' } }] },
        { id: 'josiah', name: 'Josiah Queen', classifications: [{ segment: { name: 'Music' } }] },
        { id: 'velveteen', name: 'Velveteen Queen', classifications: [{ segment: { name: 'Music' } }] },
      ] },
      page: { totalElements: 3 },
    }) }),
  });
  assert.equal(result.kind, 'needs_review');
  assert.equal(result.identity.status, 'needs_review');
});

test('namesake and tribute examples are not accepted by the legacy name helper', () => {
  assert.equal(ticketmaster.namesMatch('Queen', 'Josiah Queen'), true); // documents why this helper cannot authorize writes
  assert.equal(ticketmaster.namesMatch('Queen', 'One Night of Queen'), true);
  assert.equal(ticketmaster.namesMatch('Johnny Cash', 'Johnny Cash Roadshow'), false);
  assert.equal(ticketmaster.namesMatch('The Beatles', 'The Beatles Dub Club'), true); // also unsafe without provider identity
});

test('dry-run audit classifies identity, package, venue and lifecycle risks without mutating input', () => {
  const concerts = [
    { id: 'standard', bandId: 'katseye', sourceProvider: 'ticketmaster', date: '2026-09-17', time: '20:30', venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', providerVenueId: 'v1', providerAttractionId: 'tm-katseye', providerEventId: 'standard', providerEventName: 'KATSEYE', providerOfferType: 'standard', lineupRole: 'headliner', futureField: { keep: true } },
    { id: 'package', bandId: 'katseye', sourceProvider: 'ticketmaster', date: '2026-09-17', time: '20:30', venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', providerVenueId: 'v1', providerAttractionId: 'tm-katseye', providerEventId: 'package', providerEventName: 'KATSEYE Vinyl Room Package', providerOfferType: 'alternate_offer', lineupRole: 'headliner' },
    { id: 'wrong', bandId: 'queen', sourceProvider: 'ticketmaster', date: '2026-09-18', venue: 'Troxy', city: 'London', providerAttractionId: 'tm-josiah', providerEventId: 'wrong', artistMatchMethod: 'validated_name_fallback', lineupRole: 'headliner' },
    { id: 'unknown', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-10-01', venue: 'Unknown venue', providerVenueId: 'recover-me', providerEventId: 'u', lineupRole: 'headliner' },
    { id: 'postponed', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-10-02', venue: 'Arena', providerEventStatus: 'postponed', providerEventId: 'p', lineupRole: 'headliner' },
  ];
  const before = JSON.stringify(concerts);
  const bands = [band('KATSEYE', 'katseye', 'tm-katseye'), band('Queen', 'queen', 'tm-queen')];
  const report = Audit.auditConcerts(concerts, bands);
  assert.equal(JSON.stringify(concerts), before);
  assert.equal(report.mode, 'read_only_audit');
  assert.equal(report.counts.package_duplicate_group, 1);
  assert.equal(report.counts.wrong_artist, 1);
  assert.equal(report.counts.recoverable_venue, 1);
  assert.equal(report.counts.lifecycle_review, 1);
  assert.equal(report.issues.find((issue) => issue.type === 'package_duplicate_group').canonicalConcertId, 'standard');
});

test('user-owned fields force cleanup to manual review', () => {
  assert.equal(Integrity.hasUserOwnedData({ notes: 'keep this' }), true);
  assert.equal(Integrity.hasUserOwnedData({ ticketPrice: 0 }), true);
  assert.equal(Audit.cleanupSafety({ eventGroupId: 'event-1' }), 'manual_review_required');
});
