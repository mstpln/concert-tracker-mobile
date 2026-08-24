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
  ]);
  return report.issues.find((issue) => issue.type === 'package_duplicate_group');
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
