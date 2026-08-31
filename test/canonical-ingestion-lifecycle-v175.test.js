'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Ingestion = require('../scripts/lib/canonicalConcertIngestionV175');
const Canonical = require('../canonicalIdentityV174');
const ticketmaster = require('../scripts/lib/ticketmaster');
const { createWorkerClient } = require('../scripts/lib/workerClient');

process.env.TICKETMASTER_API_KEY = 'synthetic-test-key';

const venues = [
  { venueId: 'venue-aaaabbbb', name: 'Main Hall', city: 'Lund', country: 'Sweden', address: 'Main Street 1, Lund, Sweden', subLocations: [{ name: 'Room A', type: 'room' }], researchStatus: 'partial', schemaVersion: 1 },
  { venueId: 'venue-ccccdddd', name: 'Other Hall', city: 'Lund', country: 'Sweden', address: 'Other Street 2, Lund, Sweden', researchStatus: 'partial', schemaVersion: 1 },
];
const venueIndex = Canonical.buildVenueIndex(venues);
const options = { venueIndex, now: '2026-08-31T10:00:00.000Z' };

function stored(extra = {}) {
  return {
    id: 'stable-manual-id', bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', date: '2026-10-10', time: '19:00', manuallyAdded: true,
    attending: true, notes: 'Keep notes', rating: 5, ticketPrice: 700, ticketQuantity: 1, lineupRole: 'support',
    eventGroupId: 'event-user', unknownFutureField: { keep: true }, ...extra,
  };
}

function observation(extra = {}) {
  return {
    id: 'generated-provider-id', bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', date: '2026-10-10', time: '21:30', sourceProvider: 'ticketmaster',
    providerEventId: 'tm-standard', providerVenueId: 'tm-venue-main', providerAttractionId: 'tm-artist-a',
    providerEventName: 'Artist A', providerEventStatus: 'onsale', providerOfferType: 'standard',
    ticketUrl: 'https://tickets.example/standard', foundAt: '2026-08-31T10:00:00.000Z', ...extra,
  };
}

test('v175 canonical write reconciliation keeps one stable manual record across listings, times, offers and rooms', () => {
  let result = Ingestion.ingestCandidate([stored()], observation(), options);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'stable-manual-id');
  assert.equal(result.records[0].manuallyAdded, true);
  assert.equal(result.records[0].notes, 'Keep notes');

  result = Ingestion.ingestCandidate(result.records, observation({
    id: 'vip-row', providerEventId: 'tm-vip', providerEventName: 'Artist A VIP Hospitality Package',
    providerOfferType: 'alternate_offer', venue: 'Room A', time: '18:00',
  }), options);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].providerObservations.map((item) => item.providerEventId), ['tm-standard', 'tm-vip']);
  assert.deepEqual(result.records[0].roomOrStage, { name: 'Room A', type: 'room' });
});


test('v175 retains every collapsed Ticketmaster offer as a full provider observation', () => {
  const candidate = observation({
    alternateProviderOffers: [
      { providerEventId: 'tm-vip', providerEventName: 'Artist A VIP Package', providerOfferType: 'alternate_offer', ticketUrl: 'https://tickets.example/vip', time: '18:00', providerVenueId: 'tm-room-a', venue: 'Room A' },
      { providerEventId: 'tm-hotel', providerEventName: 'Artist A Hotel Package', providerOfferType: 'alternate_offer', ticketUrl: 'https://tickets.example/hotel', time: '17:30', providerVenueId: 'tm-room-a', venue: 'Room A' },
    ],
  });
  const merged = Ingestion.ingestCandidate([stored()], candidate, options).records[0];
  assert.deepEqual(merged.providerObservations.map((item) => item.providerEventId), ['tm-standard', 'tm-vip', 'tm-hotel']);
  assert.deepEqual(merged.providerObservations.map((item) => item.time), ['21:30', '18:00', '17:30']);
});

test('v175 prefers verified standard Ticketmaster presentation over weaker provider fields', () => {
  const weak = stored({ sourceProvider: 'tavily_groq', providerEventId: 'tavily-old', ticketRetailerVerified: false, ticketUrl: 'https://unverified.example', time: '18:00' });
  const merged = Ingestion.ingestCandidate([weak], observation({ ticketRetailerVerified: true }), options).records[0];
  assert.equal(merged.id, weak.id);
  assert.equal(merged.sourceProvider, 'ticketmaster');
  assert.equal(merged.providerEventId, 'tm-standard');
  assert.equal(merged.ticketUrl, 'https://tickets.example/standard');
  assert.equal(merged.time, '21:30');
  assert.deepEqual(merged.providerObservations.map((item) => item.providerEventId), ['tavily-old', 'tm-standard']);
});

test('v175 keeps different date, different canonical venue and different artist concerts separate', () => {
  const base = [stored()];
  assert.equal(Ingestion.ingestCandidate(base, observation({ date: '2026-10-11', providerEventId: 'next-day' }), options).records.length, 2);
  assert.equal(Ingestion.ingestCandidate(base, observation({ venue: 'Other Hall', venueAddress: 'Other Street 2, Lund, Sweden', providerVenueId: 'other', providerEventId: 'other-venue' }), options).records.length, 2);
  assert.equal(Ingestion.ingestCandidate(base, observation({ bandId: 'band-b', bandName: 'Artist B', providerAttractionId: 'tm-artist-b' }), options).records.length, 2);
});

test('v175 provider observations are namespace-scoped, monotonic and idempotent', () => {
  const first = Ingestion.ingestCandidate([stored()], observation(), options);
  const repeated = Ingestion.ingestCandidate(first.records, observation({ foundAt: '2026-09-01T10:00:00.000Z' }), options);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.records, first.records);

  const otherNamespace = Ingestion.ingestCandidate(first.records, observation({ sourceProvider: 'other_provider', providerEventId: 'tm-standard' }), options);
  assert.equal(otherNamespace.records[0].providerObservations.length, 2);
  assert.deepEqual(otherNamespace.records[0].providerObservations.map((item) => item.provider), ['ticketmaster', 'other_provider']);
});

test('v175 preserves user-owned, reviewed and unknown fields during provider enrichment', () => {
  const existing = stored({
    ownedTickets: [{ id: 'ticket-1' }], playlistUrl: 'https://playlist.example/user', photos: ['photo-1'],
    setlist: { songs: [{ name: 'Song' }] }, prepChecklist: { ticketReady: true }, concertDay: { directionsOpened: true },
    userLinks: [{ label: 'User', url: 'https://user.example' }], providerIdentityDecision: { status: 'manual_rejected', keep: true },
  });
  const merged = Ingestion.ingestCandidate([existing], observation(), options).records[0];
  for (const key of ['attending', 'notes', 'rating', 'ticketPrice', 'ticketQuantity', 'lineupRole', 'eventGroupId', 'manuallyAdded']) assert.deepEqual(merged[key], existing[key]);
  for (const key of ['ownedTickets', 'playlistUrl', 'photos', 'setlist', 'prepChecklist', 'concertDay', 'userLinks', 'providerIdentityDecision', 'unknownFutureField']) assert.deepEqual(merged[key], existing[key]);
});

test('v175 fails closed on duplicate user conflicts and writes no guessed partial record', () => {
  const duplicates = [stored({ id: 'one', notes: 'A' }), stored({ id: 'two', notes: 'B' })];
  const applied = Ingestion.ingestCandidate(duplicates, observation(), options);
  assert.equal(applied.result.action, 'hold_for_review');
  assert.equal(applied.result.reason, 'user_owned_conflict');
  assert.deepEqual(applied.result.conflicts, ['notes']);
  assert.deepEqual(applied.records, duplicates);
});

test('v175 cancellation retains the concert, stable ID and user history', () => {
  const existing = stored({ sourceProvider: 'ticketmaster', providerEventId: 'tm-standard' });
  const applied = Ingestion.ingestCandidate([existing], observation({ providerEventStatus: 'canceled' }), options);
  assert.equal(applied.records.length, 1);
  assert.equal(applied.records[0].id, existing.id);
  assert.equal(applied.records[0].date, existing.date);
  assert.equal(applied.records[0].lifecycleStatus, 'cancelled');
  assert.equal(applied.records[0].lifecycleHistory[0].type, 'cancelled');
  assert.equal(applied.records[0].notes, 'Keep notes');
});

test('v175 confirmed reschedule and replacement listing preserve ID and former date', () => {
  const existing = stored({ sourceProvider: 'ticketmaster', providerEventId: 'tm-old' });
  const sameListing = Ingestion.ingestCandidate([existing], observation({ providerEventId: 'tm-old', date: '2026-11-12' }), options);
  assert.equal(sameListing.records[0].id, existing.id);
  assert.equal(sameListing.records[0].date, '2026-11-12');
  assert.equal(sameListing.records[0].lifecycleHistory[0].previousDate, '2026-10-10');

  const replacement = Ingestion.ingestCandidate([existing], observation({ providerEventId: 'tm-new', providerRelatedEventIds: ['tm-old'], date: '2026-11-12' }), options);
  assert.equal(replacement.records[0].id, existing.id);
  assert.deepEqual(replacement.records[0].providerObservations.map((item) => item.providerEventId), ['tm-old', 'tm-new']);
  assert.equal(replacement.result.reason, 'provider_replacement_continuity');
});


test('v175 proven reschedule may move venue while retaining the stable concert and old provider evidence', () => {
  const existing = stored({ sourceProvider: 'ticketmaster', providerEventId: 'tm-old', providerVenueId: 'tm-venue-main', providerAttractionId: 'tm-artist-a', ticketRetailerVerified: true, providerOfferType: 'standard' });
  const moved = Ingestion.ingestCandidate([existing], observation({
    providerEventId: 'tm-new', providerRelatedEventIds: ['tm-old'], date: '2026-11-12', ticketRetailerVerified: true,
    venue: 'Other Hall', venueAddress: 'Other Street 2, Lund, Sweden', providerVenueId: 'tm-venue-other',
  }), options).records[0];
  assert.equal(moved.id, existing.id);
  assert.equal(moved.date, '2026-11-12');
  assert.equal(moved.venue, 'Other Hall');
  assert.equal(moved.canonicalVenueId, 'venue-ccccdddd');
  assert.deepEqual(moved.providerObservations.map((item) => item.providerEventId), ['tm-old', 'tm-new']);
});

test('v175 postponed without replacement becomes DATE TBD without inventing a date or year', () => {
  const existing = stored({ sourceProvider: 'ticketmaster', providerEventId: 'tm-old' });
  const postponed = Ingestion.ingestCandidate([existing], observation({ providerEventId: 'tm-old', providerEventStatus: 'postponed', date: null, time: null }), options).records[0];
  assert.equal(postponed.id, existing.id);
  assert.equal(postponed.date, null);
  assert.equal(postponed.time, null);
  assert.equal(postponed.lifecycleStatus, 'postponed');
  assert.equal(postponed.lifecycleHistory[0].previousDate, '2026-10-10');
  assert.equal(postponed.lifecycleHistory[0].replacementDate, null);
});

test('v175 provider lifecycle evidence cannot rewrite an attended historical date', () => {
  const existing = stored({ date: '2025-10-10', attended: true, sourceProvider: 'ticketmaster', providerEventId: 'tm-old' });
  const changed = Ingestion.ingestCandidate([existing], observation({ providerEventId: 'tm-old', date: '2026-11-12' }), options).records[0];
  assert.equal(changed.date, '2025-10-10');
  assert.equal(changed.lifecycleHistory[0].type, 'provider_date_conflict');
  const postponed = Ingestion.ingestCandidate([existing], observation({ providerEventId: 'tm-old', providerEventStatus: 'postponed', date: null }), options).records[0];
  assert.equal(postponed.date, '2025-10-10');
  assert.equal(postponed.lifecycleStatus, undefined);
});

test('v175 legacy attending past concerts are immutable historical attendance', () => {
  const existing = stored({
    date: '2025-10-10', attending: true, attended: undefined,
    sourceProvider: 'ticketmaster', providerEventId: 'tm-old',
  });
  const changed = Ingestion.ingestCandidate([existing], observation({
    providerEventId: 'tm-old', date: '2026-11-12',
  }), options).records[0];
  assert.equal(changed.date, '2025-10-10');
  assert.equal(changed.lifecycleHistory[0].type, 'provider_date_conflict');
});

test('v175 ambiguous or weak replacement continuity fails closed', () => {
  const unrelated = observation({ providerEventId: 'tm-new', providerRelatedEventIds: [], date: '2026-11-12' });
  assert.equal(Ingestion.reconcileCandidate([stored({ sourceProvider: 'ticketmaster', providerEventId: 'tm-old' })], unrelated, options).action, 'add');

  const collision = [
    stored({ id: 'one', sourceProvider: 'ticketmaster', providerEventId: 'tm-old' }),
    stored({ id: 'two', sourceProvider: 'ticketmaster', providerEventId: 'tm-old', venue: 'Other Hall', venueAddress: 'Other Street 2, Lund, Sweden' }),
  ];
  const held = Ingestion.reconcileCandidate(collision, observation({ providerEventId: 'tm-new', providerRelatedEventIds: ['tm-old'], date: '2026-11-12' }), options);
  assert.equal(held.action, 'hold_for_review');
  assert.equal(held.reason, 'provider_identity_collision');
});

test('v175 batch replay is idempotent and retains Build 1 canonical venue behavior', () => {
  const candidates = [observation(), observation({ providerEventId: 'tm-vip', venue: 'Room A', providerOfferType: 'alternate_offer' })];
  const first = Ingestion.reconcileBatch([stored()], candidates, options);
  const second = Ingestion.reconcileBatch(first.records, candidates, options);
  assert.deepEqual(second.records, first.records);
  assert.equal(first.records.length, 1);
  assert.equal(Canonical.canonicalConcertIdentity(first.records[0], venueIndex).kind, 'same');
});

test('v175 latest-state ETag retry reruns reconciliation and preserves a newer user edit', async () => {
  const base = [stored({ notes: 'Old note' })];
  const latest = [stored({ notes: 'Newer user edit' })];
  let step = 0;
  const response = (status, value, etag) => new Response(value === undefined ? '' : JSON.stringify(value), { status, headers: etag ? { ETag: etag } : {} });
  const fetchImpl = async (_url, init = {}) => {
    step += 1;
    if (step === 1) return response(200, base, 'v1');
    if (step === 2) return response(412);
    if (step === 3) return response(200, latest, 'v2');
    const written = JSON.parse(init.body);
    assert.equal(written[0].notes, 'Newer user edit');
    assert.equal(written[0].providerObservations[0].providerEventId, 'tm-standard');
    return response(200, undefined, 'v3');
  };
  const client = createWorkerClient({ endpointEnv: 'WORKER_URL', tokenEnv: 'WORKER_TOKEN', env: { WORKER_URL: 'https://worker.test', WORKER_TOKEN: 'token' }, fetchImpl });
  await client.readJson('concerts.json', []);
  const output = await client.writeJsonReconciled('concerts.json', (records) => Ingestion.reconcileBatch(records, [observation()], options).records);
  assert.equal(output[0].notes, 'Newer user edit');
  assert.equal(step, 4);
});

test('v175 Ticketmaster conversion retains cancellation and postponed DATE TBD observations', async () => {
  const followed = { id: 'band-a', name: 'Artist A', musicbrainz: { ticketmaster: { id: 'tm-artist-a', status: 'confirmed' } } };
  const event = (id, status, start = {}) => ({
    id, name: 'Artist A', url: `https://tickets.example/${id}`, source: { name: 'ticketmaster' },
    dates: { start: { localDate: '2026-10-10', localTime: '19:00:00', ...start }, status: { code: status } },
    _embedded: { attractions: [{ id: 'tm-artist-a', name: 'Artist A' }], venues: [{ id: 'tm-venue-main', name: 'Main Hall', city: { name: 'Lund' }, country: { name: 'Sweden' }, address: { line1: 'Main Street 1' } }] },
  });
  const payload = { _embedded: { events: [event('cancelled', 'canceled'), event('postponed', 'postponed', { dateTBD: true })] }, page: { totalPages: 1 } };
  const usage = { canCallTicketmaster: () => true, recordTicketmasterCall: async () => {}, note: () => {} };
  const results = await ticketmaster.fetchUpcomingEvents(followed, usage, { now: '2026-08-31T00:00:00.000Z', fetchImpl: async () => ({ ok: true, json: async () => payload }) });
  assert.equal(results.find((item) => item.providerEventId === 'cancelled').providerEventStatus, 'canceled');
  assert.equal(results.find((item) => item.providerEventId === 'postponed').date, null);
});


test('v175 Ticketmaster collapse keeps alternate offer time and venue evidence for canonical ingestion', async () => {
  const followed = { id: 'band-a', name: 'Artist A', musicbrainz: { ticketmaster: { id: 'tm-artist-a', status: 'confirmed' } } };
  const rawEvent = (id, name, time) => ({
    id, name, url: `https://tickets.example/${id}`, source: { name: 'ticketmaster' },
    dates: { start: { localDate: '2026-10-10', localTime: time }, status: { code: 'onsale' } },
    _embedded: { attractions: [{ id: 'tm-artist-a', name: 'Artist A' }], venues: [{ id: 'tm-venue-main', name: 'Main Hall', city: { name: 'Lund' }, country: { name: 'Sweden' }, address: { line1: 'Main Street 1' } }] },
  });
  const payload = { _embedded: { events: [rawEvent('standard', 'Artist A', '19:00:00'), rawEvent('vip', 'Artist A VIP Package', '19:04:00')] }, page: { totalPages: 1 } };
  const usage = { canCallTicketmaster: () => true, recordTicketmasterCall: async () => {}, note: () => {} };
  const [candidate] = await ticketmaster.fetchUpcomingEvents(followed, usage, { now: '2026-08-31T00:00:00.000Z', fetchImpl: async () => ({ ok: true, json: async () => payload }) });
  assert.equal(candidate.providerEventId, 'standard');
  assert.equal(candidate.alternateProviderOffers[0].providerEventId, 'vip');
  assert.equal(candidate.alternateProviderOffers[0].time, '19:04:00');
  assert.equal(candidate.alternateProviderOffers[0].providerVenueId, 'tm-venue-main');
  const merged = Ingestion.ingestCandidate([stored()], candidate, options).records[0];
  assert.deepEqual(merged.providerObservations.map((item) => item.providerEventId), ['standard', 'vip']);
});

test('v175 UI presents postponed DATE TBD and suppresses invalid calendar actions', () => {
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  assert.match(source, /POSTPONED · DATE TBD/);
  assert.match(source, /nextConcert\.lifecycleStatus === 'postponed'/);
  assert.match(source, /\$\{c\.date \? `<a class="btn-secondary"/);
});
