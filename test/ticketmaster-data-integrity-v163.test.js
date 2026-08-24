'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ticketmaster = require('../scripts/lib/ticketmaster');
const Integrity = require('../scripts/lib/ticketmasterConcertIntegrityV163');
const Audit = require('../scripts/ticketmasterConcertAuditV163');
const research = require('../scripts/research');

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

function packageAudit(packageState = {}) {
  const shared = {
    bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue-x',
    providerAttractionId: 'tm-artist', lineupRole: 'headliner',
  };
  const report = Audit.auditConcerts([
    { ...shared, id: 'standard', providerEventId: 'standard', providerEventName: 'Artist', providerOfferType: 'standard' },
    { ...shared, id: 'package', providerEventId: 'package', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer', ...packageState },
  ], [band('Artist', 'artist', 'tm-artist')]);
  return report.issues.find((issue) => issue.type === 'package_duplicate_group');
}

function legacyAudit({ standard = {}, alternate = {} } = {}) {
  const shared = {
    bandId: 'legacy-artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue-x',
    providerAttractionId: 'tm-legacy-artist', lineupRole: 'headliner',
  };
  return Audit.auditConcerts([
    { ...shared, id: 'legacy-standard', providerEventId: 'legacy-standard-event', ticketUrl: 'https://www.ticketmaster.test/event/legacy-standard', ...standard },
    { ...shared, id: 'legacy-alternate', providerEventId: 'legacy-alternate-event', ...alternate },
  ], [band('Legacy Artist', 'legacy-artist', 'tm-legacy-artist')]);
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

test('cross-run package reconciliation preserves the canonical stable ID and all user/unknown fields', () => {
  const existing = {
    id: 'katseye-stable-id', bandId: 'katseye', bandName: 'KATSEYE', date: '2026-09-17', time: '20:30',
    venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', providerVenueId: 'venue-1',
    sourceProvider: 'ticketmaster', providerAttractionId: 'tm-katseye', providerEventId: 'standard',
    providerEventName: 'KATSEYE', providerOfferType: 'standard', ticketUrl: 'https://ticketmaster.test/standard',
    attending: true, tickets: [{ id: 'ticket-1' }], ownedTickets: [{ id: 'owned-1' }], notes: 'Keep',
    eventGroupId: 'event-1', lineupRole: 'support', futureField: { keep: true },
  };
  const packageOffer = {
    ...existing, id: 'generated-package-id', providerEventId: 'vinyl-room',
    providerEventName: 'KATSEYE - Vinyl Room Package', providerOfferType: 'alternate_offer',
    ticketUrl: 'https://ticketmaster.test/vinyl-room', attending: undefined, tickets: undefined,
    ownedTickets: undefined, notes: undefined, eventGroupId: undefined, futureField: undefined,
  };
  const reconciliation = research.reconcileConcertCandidate([existing], [], packageOffer);
  assert.equal(reconciliation.action, 'merge_alternate_offer');
  const merged = research.upgradeExistingConcertWithTicketmaster(existing, reconciliation.candidate);
  assert.equal(merged.id, 'katseye-stable-id');
  assert.equal(merged.providerEventId, 'standard');
  assert.deepEqual(merged.alternateProviderOffers.map((offer) => offer.providerEventId), ['vinyl-room']);
  assert.equal(merged.attending, true);
  assert.deepEqual(merged.tickets, existing.tickets);
  assert.deepEqual(merged.ownedTickets, existing.ownedTickets);
  assert.equal(merged.notes, 'Keep');
  assert.equal(merged.eventGroupId, 'event-1');
  assert.equal(merged.lineupRole, 'support');
  assert.deepEqual(merged.futureField, { keep: true });
});

test('a later standard listing replaces a package primary without changing the stable app ID', () => {
  const packageRecord = { id: 'stable-id', bandId: 'loreen', date: '2026-10-02', time: '20:00', venue: 'Music Hall', city: 'Berlin', country: 'Germany', providerVenueId: 'venue-berlin', sourceProvider: 'ticketmaster', providerAttractionId: 'tm-loreen', providerEventId: 'vip', providerEventName: 'Loreen VIP Package', providerOfferType: 'alternate_offer', ticketUrl: 'https://ticketmaster.test/vip', notes: 'keep' };
  const standard = { ...packageRecord, id: 'generated', providerEventId: 'standard', providerEventName: 'Loreen', providerOfferType: 'standard', ticketUrl: 'https://ticketmaster.test/standard', notes: undefined };
  const reconciliation = research.reconcileConcertCandidate([packageRecord], [], standard);
  assert.equal(reconciliation.action, 'merge_alternate_offer');
  const merged = research.upgradeExistingConcertWithTicketmaster(packageRecord, reconciliation.candidate);
  assert.equal(merged.id, 'stable-id');
  assert.equal(merged.providerEventId, 'standard');
  assert.equal(merged.ticketUrl, 'https://ticketmaster.test/standard');
  assert.deepEqual(merged.alternateProviderOffers.map((offer) => offer.providerEventId), ['vip']);
  assert.equal(merged.notes, 'keep');
});

test('a concurrent provider identity change blocks an in-flight package merge', () => {
  const existing = { id: 'stable', bandId: 'artist', date: '2026-09-01', time: '20:00', venue: 'Arena', city: 'Stockholm', country: 'Sweden', providerVenueId: 'v1', sourceProvider: 'ticketmaster', providerAttractionId: 'a1', providerEventId: 'standard', providerEventName: 'Artist', providerOfferType: 'standard' };
  const packageOffer = { ...existing, id: 'generated', providerEventId: 'vip', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer' };
  const reconciliation = research.reconcileConcertCandidate([existing], [], packageOffer);
  const latest = { ...existing, providerEventId: 'concurrently-reviewed-event', notes: 'newer' };
  const merged = research.mergeTicketmasterConcertUpgrades([latest], [{ id: existing.id, candidate: reconciliation.candidate }]);
  assert.deepEqual(merged, [latest]);
});

test('genuine same-day shows at the same venue remain separate when times differ materially', () => {
  const first = { bandId: 'artist', date: '2026-09-01', time: '15:00', providerVenueId: 'v1', providerAttractionId: 'a1', providerEventId: 'early', providerEventName: 'Artist', providerOfferType: 'standard' };
  const second = { ...first, time: '20:00', providerEventId: 'late' };
  assert.equal(Integrity.physicalPerformanceMatch(first, second).match, false);
  assert.equal(Integrity.collapseTicketmasterOffers([first, second]).length, 2);
  assert.equal(research.reconcileConcertCandidate([{ ...first, sourceProvider: 'ticketmaster' }], [], { ...second, sourceProvider: 'ticketmaster' }).action, 'add');
});

test('cross-provider same-day performances with materially different times remain separate', () => {
  const existing = {
    id: 'artist-arena-x-1500', bandId: 'artist', bandName: 'Artist', date: '2026-09-01', time: '15:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', sourceProvider: 'tavily_groq',
    notes: 'Earlier performance', futureField: { keep: true },
  };
  const incoming = {
    id: 'artist-arena-x-2000', bandId: 'artist', bandName: 'Artist', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', sourceProvider: 'ticketmaster',
    providerEventId: 'tm-evening', providerAttractionId: 'tm-artist', providerEventName: 'Artist',
  };
  assert.deepEqual(research.crossProviderPerformanceRelationship(existing, incoming), { kind: 'distinct', reason: 'time_conflict' });
  assert.equal(research.findTicketmasterConcertMatch([existing], incoming).kind, 'none');
  assert.equal(research.reconcileConcertCandidate([existing], [], incoming).action, 'add');
  assert.equal(existing.sourceProvider, 'tavily_groq');
  assert.equal(existing.notes, 'Earlier performance');
  assert.deepEqual(existing.futureField, { keep: true });
});

test('strong same-show cross-provider evidence enriches the existing stable record', () => {
  const existing = {
    id: 'stable-tavily-id', bandId: 'artist', bandName: 'Artist', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', sourceProvider: 'tavily_groq',
    providerEventId: 'tavily-event-in-a-different-namespace',
    attending: true, lineupRole: 'support', notes: 'Keep', prepChecklist: { ticketReady: true },
    futureField: { keep: true },
  };
  const incoming = {
    id: 'generated-ticketmaster-id', bandId: 'artist', bandName: 'Artist', date: '2026-09-01', time: '20:04',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', sourceProvider: 'ticketmaster',
    providerEventId: 'tm-show', providerAttractionId: 'tm-artist', providerVenueId: 'venue-x',
    providerEventName: 'Artist', providerEventStatus: 'onsale', providerSource: 'ticketmaster',
  };
  const reconciliation = research.reconcileConcertCandidate([existing], [], incoming);
  assert.equal(reconciliation.action, 'upgrade');
  assert.equal(reconciliation.concert.id, 'stable-tavily-id');
  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, incoming);
  assert.equal(upgraded.id, 'stable-tavily-id');
  assert.equal(upgraded.providerEventId, 'tm-show');
  assert.equal(upgraded.sourceProvider, 'ticketmaster');
  assert.equal(upgraded.attending, true);
  assert.equal(upgraded.lineupRole, 'support');
  assert.equal(upgraded.notes, 'Keep');
  assert.deepEqual(upgraded.prepChecklist, { ticketReady: true });
  assert.deepEqual(upgraded.futureField, { keep: true });
});

test('missing cross-provider timing holds rather than upgrading, skipping or creating a salted duplicate', () => {
  const existing = {
    id: 'stable', bandId: 'artist', date: '2026-09-01', time: null,
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', sourceProvider: 'tavily_groq',
  };
  const incoming = {
    id: 'generated', bandId: 'artist', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', sourceProvider: 'ticketmaster',
    providerEventId: 'tm-show', providerAttractionId: 'tm-artist',
  };
  assert.deepEqual(research.crossProviderPerformanceRelationship(existing, incoming), { kind: 'ambiguous', reason: 'time_missing' });
  assert.equal(research.reconcileConcertCandidate([existing], [], incoming).action, 'hold_for_review');
  assert.equal(research.reconcileConcertCandidate([incoming], [], { ...existing, id: 'tavily-generated' }).action, 'hold_for_review');
});

test('multi-act same event does not cross-collapse two followed artists', () => {
  const a = { bandId: 'artist-a', date: '2026-09-01', time: '20:00', providerVenueId: 'v1', providerAttractionId: 'a1', providerEventId: 'event', providerEventName: 'Festival VIP Package', providerOfferType: 'alternate_offer' };
  const b = { ...a, bandId: 'artist-b', providerAttractionId: 'a2' };
  assert.equal(Integrity.physicalPerformanceMatch(a, b).match, false);
  assert.equal(research.reconcileConcertCandidate([{ ...a, sourceProvider: 'ticketmaster' }], [], { ...b, sourceProvider: 'ticketmaster' }).action, 'add');
});

test('ambiguous same-performance listings are held and never authorized for salted-ID creation', () => {
  const existing = { id: 'stable', bandId: 'artist', date: '2026-09-01', time: '20:00', venue: 'Arena', city: 'Stockholm', country: 'Sweden', providerVenueId: 'v1', sourceProvider: 'ticketmaster', providerAttractionId: 'a1', providerEventId: 'standard-a', providerEventName: 'Artist', providerOfferType: 'standard' };
  const secondStandard = { ...existing, id: 'generated', providerEventId: 'standard-b' };
  const missingTimePackage = { ...existing, id: 'generated-package', time: null, providerEventId: 'package', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer' };
  assert.deepEqual(research.reconcileConcertCandidate([existing], [], secondStandard), { action: 'hold_for_review', reason: 'same_performance_distinct_standard_listings' });
  assert.equal(research.reconcileConcertCandidate([existing], [], missingTimePackage).action, 'hold_for_review');
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

test('all confirmed wrong-artist collision examples fail to review instead of becoming trusted identities', async () => {
  const scenarios = [
    ['Queen', ['Josiah Queen', 'Velveteen Queen', 'Queen Nation', 'One Night of Queen']],
    ['The Beatles', ['The Beatles Dub Club']],
    ['Johnny Cash', ['Johnny Cash Roadshow', 'Johnny Cash - The Legacy Continues']],
  ];
  for (const [name, collisions] of scenarios) {
    const tracker = usage();
    const candidates = [name, ...collisions].map((candidateName, index) => ({
      id: `${name}-${index}`, name: candidateName, classifications: [{ segment: { name: 'Music' } }],
    }));
    const result = await ticketmaster.resolveAttractionIdentity({
      band: { id: name, name, musicbrainz: { status: 'confirmed' } },
      metadata: { artistName: name, aliases: [] },
      usage: tracker,
      now: '2026-08-24T00:00:00.000Z',
      fetchImpl: async () => ({ ok: true, json: async () => ({ _embedded: { attractions: candidates }, page: { totalElements: candidates.length } }) }),
    });
    assert.equal(result.kind, 'needs_review', name);
    assert.equal(result.identity.status, 'needs_review', name);
  }
});

test('alias-only Ticketmaster evidence remains needs_review', async () => {
  const result = await ticketmaster.resolveAttractionIdentity({
    band: { id: 'canonical', name: 'Canonical Artist', musicbrainz: { status: 'confirmed' } },
    metadata: { artistName: 'Canonical Artist', aliases: ['Stage Alias'] },
    usage: usage(),
    now: '2026-08-24T00:00:00.000Z',
    fetchImpl: async () => ({ ok: true, json: async () => ({
      _embedded: { attractions: [{ id: 'alias-only', name: 'Stage Alias', classifications: [{ segment: { name: 'Music' } }] }] },
      page: { totalElements: 1 },
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
  const packagePlan = report.issues.find((issue) => issue.type === 'package_duplicate_group');
  assert.equal(packagePlan.canonicalConcertId, 'standard');
  assert.equal(packagePlan.proposedMutation.retainConcertId, 'standard');
  assert.deepEqual(packagePlan.proposedMutation.removeConcertIds, ['package']);
  assert.deepEqual(packagePlan.alternateProviderOffers.map((offer) => offer.providerEventId), ['package']);
  assert.equal(packagePlan.proposedMutation.preservesCanonicalStableId, true);
});

test('legacy KATSEYE Vinyl Room package is recognized from URL-only stored evidence', () => {
  const report = legacyAudit({
    alternate: { ticketUrl: 'https://www.ticketmaster.dk/event/katseye-vinyl-room-upgrade-tickets/123' },
  });
  const issue = report.issues.find((candidate) => candidate.type === 'package_duplicate_group');
  assert.ok(issue);
  assert.equal(issue.canonicalConcertId, 'legacy-standard');
  assert.equal(issue.automaticRemediationSafe, true);
  const member = issue.members.find((candidate) => candidate.concertId === 'legacy-alternate');
  assert.equal(member.offerClassification.kind, 'alternate_offer');
  assert.equal(member.offerClassification.reason, 'legacy_ticket_url_package_pattern');
  assert.equal(issue.alternateProviderOffers[0].providerEventId, 'legacy-alternate-event');
  assert.equal(issue.alternateProviderOffers[0].ticketUrl, 'https://www.ticketmaster.dk/event/katseye-vinyl-room-upgrade-tickets/123');
  assert.equal(issue.alternateProviderOffers[0].offerClassificationReason, 'legacy_ticket_url_package_pattern');
});

test('legacy Loreen VIP sound-check package is recognized from its stored URL', () => {
  const report = legacyAudit({
    alternate: { ticketUrl: 'https://www.ticketmaster.de/event/loreen-vip-sound-check-party-ticket/456' },
  });
  const issue = report.issues.find((candidate) => candidate.type === 'package_duplicate_group');
  assert.ok(issue);
  assert.equal(issue.members.find((candidate) => candidate.concertId === 'legacy-alternate').offerClassification.reason, 'legacy_ticket_url_package_pattern');
});

test('stored provider event-name package evidence has an auditable classification reason', () => {
  const report = legacyAudit({
    alternate: {
      providerEventName: 'Artist VIP Sound Check Package',
      ticketUrl: 'https://www.ticketmaster.test/event/opaque-id',
    },
  });
  const issue = report.issues.find((candidate) => candidate.type === 'package_duplicate_group');
  assert.ok(issue);
  assert.equal(issue.members.find((candidate) => candidate.concertId === 'legacy-alternate').offerClassification.reason, 'provider_event_name_package_pattern');
});

test('two legacy standard listings without positive package evidence remain manual ambiguity', () => {
  const report = legacyAudit({
    alternate: { ticketUrl: 'https://www.ticketmaster.test/event/legacy-second-standard' },
  });
  assert.equal(report.issues.some((issue) => issue.type === 'package_duplicate_group'), false);
  const ambiguity = report.issues.find((issue) => issue.type === 'ticketmaster_listing_ambiguity');
  assert.ok(ambiguity);
  assert.equal(ambiguity.automaticRemediationSafe, false);
  assert.equal(ambiguity.proposedMutation.action, 'manual_review');
  assert.ok(ambiguity.members.every((member) => member.offerClassification.reason === 'no_positive_alternate_offer_evidence'));
});

test('legacy alternateProviderOffers linkage is deterministic package evidence', () => {
  const report = legacyAudit({
    standard: { alternateProviderOffers: [{ providerEventId: 'legacy-alternate-event', ticketUrl: 'https://www.ticketmaster.test/event/linked-offer' }] },
    alternate: { ticketUrl: 'https://www.ticketmaster.test/event/linked-offer' },
  });
  const issue = report.issues.find((candidate) => candidate.type === 'package_duplicate_group');
  assert.ok(issue);
  assert.equal(issue.members.find((candidate) => candidate.concertId === 'legacy-alternate').offerClassification.reason, 'referenced_by_alternate_provider_offers');
  assert.equal(issue.alternateProviderOffers[0].providerEventId, 'legacy-alternate-event');
});

test('user-owned fields force cleanup to manual review', () => {
  assert.equal(Integrity.hasUserOwnedData({ notes: 'keep this' }), true);
  assert.equal(Integrity.hasUserOwnedData({ ticketPrice: 0 }), true);
  assert.equal(Audit.cleanupSafety({ eventGroupId: 'event-1' }), 'manual_review_required');
  assert.equal(Audit.cleanupSafety({ futureField: { keep: true } }), 'manual_review_required');
});

test('cleanup protects support role, preparation, links, tickets and all meaningful user state', () => {
  const protectedCases = [
    ['lineupRole', { lineupRole: 'support' }],
    ['prepChecklist', { prepChecklist: { ticketReady: true } }],
    ['userLinks', { userLinks: [{ label: 'Official', url: 'https://example.test' }] }],
    ['playlistUrl', { playlistUrl: 'https://example.test/playlist' }],
    ['playlistProgress', { playlistProgress: { created: true } }],
    ['concertDay', { concertDay: { directionsOpened: true } }],
    ['ownedTickets', { ownedTickets: [{ id: 'ticket-1' }] }],
    ['ticketPrice', { ticketPrice: 0 }],
    ['ticketQuantity', { ticketQuantity: 1 }],
    ['notes', { notes: 'Keep this' }],
    ['attending', { attending: true }],
    ['attended', { attended: true }],
    ['rating', { rating: 5 }],
    ['photos', { photos: ['https://example.test/photo'] }],
    ['setlist', { setlist: { songs: [{ name: 'Song' }] } }],
    ['eventGroupId', { eventGroupId: 'event-1' }],
  ];
  for (const [field, state] of protectedCases) {
    const issue = packageAudit(state);
    assert.equal(issue.safety, 'manual_review_required', field);
    assert.equal(issue.automaticRemediationSafe, false, field);
    assert.equal(issue.proposedMutation.action, 'manual_review', field);
    assert.ok(issue.members.find((member) => member.concertId === 'package').userOwnedFields.includes(field), field);
  }
});

test('cleanup retains automatic package consolidation only for records without meaningful or unknown state', () => {
  const clean = packageAudit();
  assert.equal(clean.safety, 'automatic_candidate');
  assert.equal(clean.automaticRemediationSafe, true);
  assert.equal(clean.proposedMutation.action, 'merge_alternate_offers');
  assert.equal(Audit.cleanupSafety({ lineupRole: 'headliner' }), 'automatic_candidate');

  const unknown = packageAudit({ futureField: { keep: true } });
  assert.equal(unknown.safety, 'manual_review_required');
  assert.deepEqual(unknown.members.find((member) => member.concertId === 'package').unknownFields, ['futureField']);
});

test('cleanup requires manual review for headliner/support conflicts in either direction', () => {
  const canonicalHeadliner = packageAudit({ lineupRole: 'support' });
  assert.equal(canonicalHeadliner.automaticRemediationSafe, false);
  assert.deepEqual(canonicalHeadliner.cleanupAssessment.reasons, ['conflicting_lineup_role']);

  const shared = {
    bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue-x',
    providerAttractionId: 'tm-artist',
  };
  const report = Audit.auditConcerts([
    { ...shared, id: 'standard', providerEventId: 'standard', providerEventName: 'Artist', providerOfferType: 'standard', lineupRole: 'support' },
    { ...shared, id: 'package', providerEventId: 'package', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer', lineupRole: 'headliner' },
  ], [band('Artist', 'artist', 'tm-artist')]);
  const canonicalSupport = report.issues.find((issue) => issue.type === 'package_duplicate_group');
  assert.equal(canonicalSupport.automaticRemediationSafe, false);
  assert.deepEqual(canonicalSupport.cleanupAssessment.reasons, ['conflicting_lineup_role']);
});

test('cleanup allows clean matching headliners and matching support state already retained by canonical', () => {
  const headliners = packageAudit();
  assert.equal(headliners.automaticRemediationSafe, true);

  const sharedState = {
    lineupRole: 'support', notes: 'same note', tickets: [{ id: 'ticket-1' }], ticketPrice: 0,
  };
  const shared = {
    bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue-x',
    providerAttractionId: 'tm-artist', ...sharedState,
  };
  const report = Audit.auditConcerts([
    { ...shared, id: 'standard', providerEventId: 'standard', providerEventName: 'Artist', providerOfferType: 'standard' },
    { ...shared, id: 'package', providerEventId: 'package', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer' },
  ], [band('Artist', 'artist', 'tm-artist')]);
  const supports = report.issues.find((issue) => issue.type === 'package_duplicate_group');
  assert.equal(supports.automaticRemediationSafe, true);
  assert.deepEqual(supports.cleanupAssessment, {
    safety: 'automatic_candidate', reasons: [], protectedFields: [], unknownFields: [],
  });
});

test('cleanup compares user-owned values across the group and remains conservative for unknown fields', () => {
  const unpreserved = packageAudit({ notes: 'same note' });
  assert.equal(unpreserved.automaticRemediationSafe, false);
  assert.deepEqual(unpreserved.cleanupAssessment.protectedFields, ['notes']);

  const shared = {
    bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena X', city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue-x',
    providerAttractionId: 'tm-artist', lineupRole: 'headliner', notes: 'same note', futureField: { same: true },
  };
  const report = Audit.auditConcerts([
    { ...shared, id: 'standard', providerEventId: 'standard', providerEventName: 'Artist', providerOfferType: 'standard' },
    { ...shared, id: 'package', providerEventId: 'package', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer' },
  ], [band('Artist', 'artist', 'tm-artist')]);
  const issue = report.issues.find((candidate) => candidate.type === 'package_duplicate_group');
  assert.equal(issue.automaticRemediationSafe, false);
  assert.deepEqual(issue.cleanupAssessment.protectedFields, []);
  assert.deepEqual(issue.cleanupAssessment.unknownFields, ['futureField']);
  assert.deepEqual(issue.cleanupAssessment.reasons, ['unknown_future_state_requires_review']);
});

test('alternate provider provenance merge is monotonic for poorer and richer repeat observations', () => {
  const rich = {
    providerEventId: 'vip-1',
    ticketUrl: 'https://ticketmaster.test/vip-1',
    providerEventName: 'Artist VIP Package',
    providerEventStatus: 'onsale',
    providerSource: 'ticketmaster',
    providerOfferType: 'alternate_offer',
  };
  const [preserved] = Integrity.mergeOfferLists([rich], [{
    providerEventId: 'vip-1', ticketUrl: null, providerEventName: '', providerEventStatus: undefined,
  }]);
  assert.deepEqual(preserved, rich);
  const [preservedThroughEvidenceNormalization] = Integrity.mergeOfferLists(
    [rich],
    [Integrity.providerOfferEvidence({ providerEventId: 'vip-1', ticketUrl: null, providerEventName: null })]
  );
  assert.deepEqual(preservedThroughEvidenceNormalization, rich);
  const upgraded = research.upgradeExistingConcertWithTicketmaster(
    { id: 'stable', sourceProvider: 'ticketmaster', providerEventId: 'standard', alternateProviderOffers: [rich] },
    { sourceProvider: 'ticketmaster', providerEventId: 'standard', alternateProviderOffers: [{ providerEventId: 'vip-1', ticketUrl: null, providerEventName: null }] }
  );
  assert.deepEqual(upgraded.alternateProviderOffers, [rich]);

  const [enriched] = Integrity.mergeOfferLists(
    [{ providerEventId: 'vip-2', providerOfferType: 'alternate_offer' }],
    [{ providerEventId: 'vip-2', ticketUrl: 'https://ticketmaster.test/vip-2', providerEventName: 'Artist Lounge Package', providerEventStatus: 'offsale', providerSource: 'ticketmaster' }]
  );
  assert.deepEqual(enriched, {
    providerEventId: 'vip-2',
    providerOfferType: 'alternate_offer',
    ticketUrl: 'https://ticketmaster.test/vip-2',
    providerEventName: 'Artist Lounge Package',
    providerEventStatus: 'offsale',
    providerSource: 'ticketmaster',
  });
});

test('alternate-offer vocabulary is conservative for names and inspects URL paths only', () => {
  for (const value of [
    'Artist VIP Ticket', 'Artist Premium Ticket', 'Artist Hospitality', 'Artist Lounge Access',
    'Artist Sound Check', 'Artist Meet & Greet', 'Artist Early Entry', 'Artist Early Access',
    'Artist Upgrade', 'Artist Experience Package', 'Artist Vinyl Room', 'Artist Club Access',
    'Artist Suite Hospitality',
  ]) assert.equal(Integrity.alternateOfferVocabularyMatch(value), true, value);

  for (const value of ['The Eminem Experience', 'Premium', 'Lounge', 'Suite', 'Experience']) {
    assert.equal(Integrity.alternateOfferVocabularyMatch(value), false, value);
  }
  assert.equal(Integrity.alternateOfferVocabularyMatch('https://tickets.test/event/artist-%56IP-package', { source: 'url' }), true);
  assert.equal(Integrity.alternateOfferVocabularyMatch('https://tickets.test/event/artist_soundcheck+upgrade', { source: 'url' }), true);
  assert.equal(Integrity.alternateOfferVocabularyMatch('https://vip.ticketmaster.test/event/ordinary-show?campaign=vip-package#upgrade', { source: 'url' }), false);
  assert.equal(Integrity.alternateOfferVocabularyMatch('https://tickets.test/event/the-eminem-experience-tickets', { source: 'url' }), false);
});

test('explicit standard/package conflicts never merge or become automatic cleanup', () => {
  const shared = {
    id: 'standard', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena', city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue',
    providerAttractionId: 'artist-attraction', providerEventId: 'standard', lineupRole: 'headliner',
  };
  const conflict = { ...shared, id: 'conflict', providerEventId: 'conflict', providerEventName: 'Artist VIP Package', providerOfferType: 'standard' };
  assert.equal(Integrity.recordOfferClassification(conflict).kind, 'ambiguous');
  assert.equal(Integrity.mergeAlternateOffer(shared, conflict), null);
  assert.equal(Integrity.collapseTicketmasterOffers([shared, conflict]).length, 2);
  const finding = Audit.auditConcerts([shared, conflict]).issues.find((issue) => issue.type === 'package_relationship_review');
  assert.ok(finding);
  assert.equal(finding.automaticRemediationSafe, false);
  assert.equal(finding.reason, 'conflicting_provider_offer_evidence');
});

test('preventive package collapse is direct-match and input-order independent', () => {
  const shared = {
    bandId: 'artist', date: '2026-09-01', venue: 'Arena', city: 'Stockholm', country: 'Sweden',
    providerVenueId: 'venue', providerAttractionId: 'attraction', providerOfferType: 'standard',
    providerEventName: 'Artist',
  };
  const standard = { ...shared, id: 'standard', time: '20:00', providerEventId: 'standard' };
  const near = { ...shared, id: 'near', time: '20:04', providerEventId: 'near', providerOfferType: 'alternate_offer', providerEventName: 'Artist VIP Package' };
  const bridgeOnly = { ...shared, id: 'bridge-only', time: '20:08', providerEventId: 'bridge-only', providerOfferType: 'alternate_offer', providerEventName: 'Artist VIP Package' };
  for (const input of [[standard, near, bridgeOnly], [bridgeOnly, near, standard], [near, standard, bridgeOnly]]) {
    const output = Integrity.collapseTicketmasterOffers(input);
    assert.equal(output.length, 2);
    const canonical = output.find((record) => record.providerEventId === 'standard');
    assert.deepEqual(canonical.alternateProviderOffers.map((offer) => offer.providerEventId), ['near']);
    assert.ok(output.some((record) => record.providerEventId === 'bridge-only'));
  }
});

test('preventive package consolidation holds incomplete Ticketmaster location evidence', () => {
  const standard = {
    id: 'standard', bandId: 'artist', date: '2026-09-01', time: '20:00', venue: 'Same Arena',
    city: 'Stockholm', country: 'Sweden', providerAttractionId: 'attraction', providerEventId: 'standard',
    providerOfferType: 'standard', providerEventName: 'Artist', sourceProvider: 'ticketmaster',
  };
  const alternate = {
    ...standard, id: 'package', providerEventId: 'package', providerOfferType: 'alternate_offer',
    providerEventName: 'Artist VIP Package',
  };
  assert.equal(Integrity.physicalPerformanceRelationship(standard, alternate).kind, 'ambiguous');
  assert.equal(Integrity.mergeAlternateOffer(standard, alternate), null);
  assert.equal(Integrity.collapseTicketmasterOffers([standard, alternate]).length, 2);
  assert.equal(research.reconcileConcertCandidate([standard], [], alternate).action, 'hold_for_review');
});

test('cleanup bridge case validates every removal directly and is order independent', () => {
  const shared = {
    bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', venue: 'Arena',
    city: 'Stockholm', country: 'Sweden', providerVenueId: 'venue', providerAttractionId: 'attraction',
    lineupRole: 'headliner',
  };
  const records = [
    { ...shared, id: 'standard', time: '20:00', providerEventId: 'standard', providerOfferType: 'standard', providerEventName: 'Artist' },
    { ...shared, id: 'near', time: '20:04', providerEventId: 'near', providerOfferType: 'alternate_offer', providerEventName: 'Artist VIP Package' },
    { ...shared, id: 'bridge-only', time: '20:08', providerEventId: 'bridge-only', providerOfferType: 'alternate_offer', providerEventName: 'Artist VIP Package' },
  ];
  const decisions = [];
  for (const input of [records, [...records].reverse(), [records[1], records[2], records[0]]]) {
    const report = Audit.auditConcerts(input, [band('Artist', 'artist', 'attraction')]);
    const automatic = report.issues.find((issue) => issue.type === 'package_duplicate_group');
    assert.deepEqual(automatic.proposedMutation.removeConcertIds, ['near']);
    assert.ok(automatic.directCanonicalMatches.every((match) => match.kind === 'same'));
    assert.deepEqual(automatic.alternateProviderOffers.map((offer) => offer.providerEventId), ['near']);
    const held = report.issues.find((issue) => issue.type === 'package_relationship_review' && issue.concertId === 'bridge-only');
    assert.ok(held);
    assert.equal(held.automaticRemediationSafe, false);
    decisions.push({ retain: automatic.canonicalConcertId, remove: automatic.proposedMutation.removeConcertIds, held: held.concertId });
  }
  assert.deepEqual(decisions, [decisions[0], decisions[0], decisions[0]]);
});

test('positive package evidence with incomplete or conflicting performance evidence is always review-visible', () => {
  const standard = {
    id: 'standard', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena', city: 'Stockholm', country: 'Sweden', venueAddress: 'Arena 1, Stockholm, Sweden',
    providerVenueId: 'venue', providerAttractionId: 'attraction', providerEventId: 'standard',
    providerEventName: 'Artist', providerOfferType: 'standard', lineupRole: 'headliner',
  };
  const basePackage = {
    ...standard, id: 'package', providerEventId: 'package', providerEventName: 'Artist VIP Package',
    providerOfferType: 'alternate_offer',
  };
  const cases = [
    ['time_missing', { time: null }],
    ['attraction_missing', { providerAttractionId: null }],
    ['location_incomplete', { providerVenueId: null, venueAddress: null }],
    ['unknown_venue', { venue: 'TBA' }],
    ['location_incomplete', { providerVenueId: null, venueAddress: '' }],
    ['provider_venue_conflict', { providerVenueId: 'other-venue' }],
    ['attraction_conflict', { providerAttractionId: 'other-attraction' }],
  ];
  for (const [reason, change] of cases) {
    const finding = Audit.auditConcerts([standard, { ...basePackage, ...change }]).issues
      .find((issue) => issue.type === 'package_relationship_review');
    assert.ok(finding, reason);
    assert.equal(finding.safety, 'manual_review_required', reason);
    assert.equal(finding.automaticRemediationSafe, false, reason);
    assert.ok(finding.physicalRelationships.some((relationship) => relationship.reason === reason), reason);
  }

  const linkedStandard = { ...standard, alternateProviderOffers: [{ providerEventId: 'linked-package' }] };
  const linkedLegacy = {
    ...basePackage, id: 'linked', providerEventId: 'linked-package', providerEventName: null,
    providerOfferType: null, time: null,
  };
  const linkedFinding = Audit.auditConcerts([linkedStandard, linkedLegacy]).issues
    .find((issue) => issue.type === 'package_relationship_review' && issue.concertId === 'linked');
  assert.ok(linkedFinding);
  assert.ok(linkedFinding.packageEvidenceReasons.includes('referenced_by_alternate_provider_offers'));
  assert.ok(linkedFinding.physicalRelationships.some((relationship) => relationship.reason === 'time_missing'));
});

test('alternateProviderOffers evidence is scoped to the referencing band and date', () => {
  const owner = {
    id: 'owner', bandId: 'artist-a', date: '2026-09-01', sourceProvider: 'ticketmaster',
    providerEventId: 'owner-event', alternateProviderOffers: [{ providerEventId: 'reused-id' }],
  };
  const unrelated = {
    id: 'unrelated', bandId: 'artist-b', date: '2026-10-02', sourceProvider: 'ticketmaster',
    providerEventId: 'reused-id', ticketUrl: 'https://tickets.test/event/ordinary',
  };
  const references = Audit.referencedAlternateEventIds([owner, unrelated]);
  assert.equal(Audit.offerClassification(unrelated, references).kind, 'unknown');
});

test('missing or invalid lineup roles block automatic package cleanup', () => {
  for (const packageRole of [undefined, null, 'guest']) {
    const issue = packageAudit({ lineupRole: packageRole });
    assert.equal(issue.automaticRemediationSafe, false);
    assert.ok(issue.cleanupAssessment.reasons.includes('missing_or_invalid_lineup_role'));
  }
});

test('manually added concerts are explicit user-owned cleanup state', () => {
  const issue = packageAudit({ manuallyAdded: true });
  assert.equal(issue.automaticRemediationSafe, false);
  assert.ok(issue.cleanupAssessment.protectedFields.includes('manuallyAdded'));
});

test('wrong-artist cleanup fails closed for incomplete identity and protected state', () => {
  const base = {
    id: 'record', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena', providerVenueId: 'venue', providerEventId: 'event', providerAttractionId: 'wrong',
    lineupRole: 'headliner',
  };
  const trusted = band('Artist', 'artist', 'trusted');
  const conflict = Audit.auditConcerts([base], [trusted]).issues.find((issue) => issue.type === 'wrong_artist');
  assert.equal(conflict.automaticRemediationSafe, true);
  const protectedConflict = Audit.auditConcerts([{ ...base, notes: 'keep' }], [trusted]).issues.find((issue) => issue.type === 'wrong_artist');
  assert.equal(protectedConflict.automaticRemediationSafe, false);
  const unknownConflict = Audit.auditConcerts([{ ...base, futureField: true }], [trusted]).issues.find((issue) => issue.type === 'wrong_artist');
  assert.equal(unknownConflict.automaticRemediationSafe, false);
  assert.equal(Audit.auditConcerts([base], []).issues.find((issue) => issue.type === 'identity_review').reason, 'band_metadata_missing');
  assert.equal(Audit.auditConcerts([{ ...base, providerAttractionId: null }], [trusted]).issues.find((issue) => issue.type === 'identity_review').reason, 'provider_attraction_missing');
  assert.equal(Audit.auditConcerts([{ ...base, providerAttractionId: 'trusted', artistMatchMethod: 'validated_name_fallback' }], [trusted]).issues.find((issue) => issue.type === 'identity_review').reason, 'untrusted_name_fallback');
  const manualConfirmed = { ...trusted, musicbrainz: { ...trusted.musicbrainz, ticketmaster: { id: 'trusted', status: 'manual_confirmed' } } };
  assert.equal(Audit.auditConcerts([{ ...base, providerAttractionId: 'trusted' }], [manualConfirmed]).issues.some((issue) => issue.type === 'identity_review' || issue.type === 'wrong_artist'), false);
});

test('automatic cleanup requires current trusted band identity and a resolved role', () => {
  const shared = {
    id: 'standard', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: '20:00',
    venue: 'Arena', providerVenueId: 'venue', providerEventId: 'standard', providerAttractionId: 'trusted',
    providerEventName: 'Artist', providerOfferType: 'standard', lineupRole: 'headliner',
  };
  const alternate = { ...shared, id: 'package', providerEventId: 'package', providerEventName: 'Artist VIP Package', providerOfferType: 'alternate_offer' };
  const missingBand = Audit.auditConcerts([shared, alternate]).issues.find((issue) => issue.type === 'package_duplicate_group');
  assert.equal(missingBand.automaticRemediationSafe, false);
  assert.ok(missingBand.cleanupAssessment.reasons.includes('identity_not_proven'));

  const wrongRoleRecord = { ...shared, id: 'wrong-role', providerAttractionId: 'wrong', lineupRole: null };
  const wrongArtist = Audit.auditConcerts([wrongRoleRecord], [band('Artist', 'artist', 'trusted')]).issues.find((issue) => issue.type === 'wrong_artist');
  assert.equal(wrongArtist.automaticRemediationSafe, false);
});

test('offsale remains non-destructive while unsafe lifecycle states require review', () => {
  const base = { id: 'concert', bandId: 'artist', sourceProvider: 'ticketmaster', providerEventId: 'event', lineupRole: 'headliner', venue: 'Arena' };
  assert.equal(Audit.auditConcerts([{ ...base, providerEventStatus: 'offsale' }]).issues.some((issue) => issue.type === 'lifecycle_review'), false);
  for (const status of ['canceled', 'cancelled', 'postponed', 'rescheduled']) {
    const issue = Audit.auditConcerts([{ ...base, providerEventStatus: status }]).issues.find((candidate) => candidate.type === 'lifecycle_review');
    assert.ok(issue, status);
    assert.equal(issue.automaticRemediationSafe, false, status);
  }
});

test('incomplete attraction searches keep even long exact names in review', async () => {
  const result = await ticketmaster.resolveAttractionIdentity({
    band: { id: 'long-name', name: 'The Long Exact Artist Name', musicbrainz: { status: 'confirmed' } },
    metadata: { artistName: 'The Long Exact Artist Name', aliases: [] },
    usage: usage(),
    now: '2026-08-24T00:00:00.000Z',
    fetchImpl: async () => ({ ok: true, json: async () => ({
      _embedded: { attractions: [{ id: 'exact', name: 'The Long Exact Artist Name', classifications: [{ segment: { name: 'Music' } }] }] },
      page: { totalElements: 2 },
    }) }),
  });
  assert.equal(result.kind, 'needs_review');
});

test('placeholder embedded venues use one bounded provider venue recovery lookup', async () => {
  const calls = [];
  const tracker = usage();
  const result = await ticketmaster.fetchUpcomingEvents(band('Artist', 'artist', 'attraction'), tracker, {
    now: '2026-08-24T00:00:00.000Z',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/venues/venue-tba.json')) return { ok: true, json: async () => ({ id: 'venue-tba', name: 'Recovered Arena', city: { name: 'Stockholm' }, country: { name: 'Sweden' }, address: { line1: 'Arena 1' } }) };
      return { ok: true, json: async () => ({
        _embedded: { events: [event({ id: 'show', attractionId: 'attraction', attractionName: 'Artist', name: 'Artist', venueId: 'venue-tba', venue: 'TBA' })] },
        page: { totalPages: 1 },
      }) };
    },
  });
  assert.equal(result[0].venue, 'Recovered Arena');
  assert.equal(calls.filter((url) => url.includes('/venues/venue-tba.json')).length, 1);
  assert.equal(tracker.calls, 2);
});

test('legacy and malformed optional offer shapes remain additive and safe', () => {
  const legacy = {
    id: 'legacy', bandId: 'artist', sourceProvider: 'ticketmaster', date: '2026-09-01', time: null,
    venue: null, providerEventId: 'legacy-event', providerAttractionId: null, alternateProviderOffers: { malformed: true },
    lineupRole: 'headliner',
  };
  assert.doesNotThrow(() => Audit.auditConcerts([legacy]));
  assert.deepEqual(Integrity.mergeOfferLists(undefined, null, {}, [], [{ providerEventId: 'one' }, { providerEventId: 'one', ticketUrl: 'https://tickets.test/one' }]), [{ providerEventId: 'one', ticketUrl: 'https://tickets.test/one' }]);
});
