'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../scripts/research');

function existingConcert(overrides = {}) {
  return {
    id: 'le-sserafim-2026-10-12-kobenhavn-s',
    bandId: 'le-sserafim',
    bandName: 'LE SSERAFIM',
    date: '2026-10-12',
    time: '20:00:00',
    venue: 'Unknown venue',
    city: 'København S',
    country: 'Denmark',
    venueAddress: 'Hannemanns Allé 18-20, København S, Denmark',
    attending: true,
    ticketUrl: 'https://www.ticketmaster.dk/event/synthetic-le-sserafim',
    ticketPrice: 950,
    ticketQuantity: 1,
    notes: 'User note must survive.',
    playlistUrl: 'https://open.spotify.com/playlist/user-owned',
    photos: ['https://photos.example/user-owned'],
    futureField: { preserve: true },
    ...overrides,
  };
}

function ticketmasterCandidate(overrides = {}) {
  return {
    id: 'le-sserafim-2026-10-12-kobenhavn-s',
    bandId: 'le-sserafim',
    bandName: 'LE SSERAFIM',
    date: '2026-10-12',
    time: '20:00:00',
    venue: 'Royal Arena',
    city: 'København S',
    country: 'Denmark',
    venueAddress: 'Hannemanns Allé 18-20, København S, Denmark',
    ticketUrl: 'https://www.ticketmaster.dk/event/synthetic-le-sserafim',
    ticketRetailerVerified: true,
    sourceProvider: 'ticketmaster',
    providerEventId: 'tm-synthetic-le-sserafim',
    providerAttractionId: 'tm-le-sserafim',
    artistMatchMethod: 'confirmed_attraction_id',
    distanceKm: 42,
    ...overrides,
  };
}

function assertProtectedFieldsPreserved(upgraded, existing) {
  assert.equal(upgraded.id, existing.id);
  assert.equal(upgraded.attending, true);
  assert.equal(upgraded.ticketUrl, existing.ticketUrl);
  assert.equal(upgraded.ticketPrice, 950);
  assert.equal(upgraded.ticketQuantity, 1);
  assert.equal(upgraded.venueAddress, existing.venueAddress);
  assert.equal(upgraded.city, existing.city);
  assert.equal(upgraded.country, existing.country);
  assert.equal(upgraded.notes, existing.notes);
  assert.equal(upgraded.playlistUrl, existing.playlistUrl);
  assert.deepEqual(upgraded.photos, existing.photos);
  assert.deepEqual(upgraded.futureField, { preserve: true });
  assert.equal(Object.hasOwn(upgraded, '_venueRecoveryOnly'), false);
}

test('GAU4 recovers an unknown venue from a unique Ticketmaster candidate with exact address evidence', () => {
  const existing = existingConcert();
  const candidate = ticketmasterCandidate({
    providerEventId: null,
    ticketUrl: 'https://different.example/provider-ticket',
  });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), true);
  const match = research.findTicketmasterConcertMatch([existing], candidate);
  assert.equal(match.kind, 'match');
  assert.equal(match.reason, 'trusted_venue_evidence');
  assert.equal(match.concert.id, existing.id);
});

test('GAU4 accepts an exact Ticketmaster ticket URL as strong recovery evidence when address evidence is absent', () => {
  const existing = existingConcert({ venueAddress: null });
  const candidate = ticketmasterCandidate({ venueAddress: null, providerEventId: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), true);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).reason, 'trusted_venue_evidence');
});

test('exact provider-event matches retain the existing full Ticketmaster allowlist upgrade path', () => {
  const existing = existingConcert({
    sourceProvider: 'ticketmaster',
    providerEventId: 'tm-synthetic-le-sserafim',
  });
  const candidate = ticketmasterCandidate({
    time: '21:15:00',
    venueAddress: 'Provider Canonical Address',
    ticketUrl: 'https://www.ticketmaster.dk/event/provider-canonical-link',
    distanceKm: 77,
  });

  const match = research.findTicketmasterConcertMatch([existing], candidate);
  assert.equal(match.kind, 'match');
  assert.equal(match.reason, 'provider_event_id');

  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, candidate);
  assert.equal(upgraded.venue, 'Royal Arena');
  assert.equal(upgraded.time, '21:15:00');
  assert.equal(upgraded.venueAddress, 'Provider Canonical Address');
  assert.equal(upgraded.ticketUrl, 'https://www.ticketmaster.dk/event/provider-canonical-link');
  assert.equal(upgraded.distanceKm, 77);
  assert.equal(upgraded.providerEventId, 'tm-synthetic-le-sserafim');
  assert.equal(upgraded.notes, existing.notes);
  assert.equal(upgraded.ticketPrice, existing.ticketPrice);
  assert.equal(upgraded.ticketQuantity, existing.ticketQuantity);
  assert.equal(upgraded.playlistUrl, existing.playlistUrl);
  assert.deepEqual(upgraded.photos, existing.photos);
  assert.deepEqual(upgraded.futureField, existing.futureField);
});

test('GAU4 does not guess a venue from city/date alone', () => {
  const existing = existingConcert({ venueAddress: null, ticketUrl: 'https://tickets.example/user-link' });
  const candidate = ticketmasterCandidate({ venueAddress: null, ticketUrl: 'https://www.ticketmaster.dk/event/other', providerEventId: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).kind, 'ambiguous');
});

test('GAU4 rejects non-HTTPS ticket URLs as recovery evidence', () => {
  const existing = existingConcert({ venueAddress: null, ticketUrl: 'http://tickets.example/same' });
  const candidate = ticketmasterCandidate({ venueAddress: null, ticketUrl: 'http://tickets.example/same', providerEventId: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).kind, 'ambiguous');
});

test('GAU4 rejects non-Ticketmaster venue candidates even with matching address evidence', () => {
  const existing = existingConcert();
  const candidate = ticketmasterCandidate({ sourceProvider: 'tavily_groq', providerEventId: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
});

test('GAU4 never replaces an already named venue through the recovery path', () => {
  const existing = existingConcert({ venue: 'User Named Venue' });
  const candidate = ticketmasterCandidate({ providerEventId: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
});

test('GAU4 fails closed when provider event IDs conflict', () => {
  const existing = existingConcert({ providerEventId: 'tm-other-event' });
  const candidate = ticketmasterCandidate({ providerEventId: 'tm-synthetic-le-sserafim' });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).kind, 'none');
});

test('GAU4 leaves Unknown venue when the trusted candidate also lacks a real venue name', () => {
  const existing = existingConcert();
  const candidate = ticketmasterCandidate({ venue: 'Unknown venue', providerEventId: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
});

test('venue-only recovery preserves stable ID and every unrelated/user-owned field', () => {
  const existing = existingConcert();
  const candidate = { ...ticketmasterCandidate({ providerEventId: null }), _venueRecoveryOnly: true };
  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, candidate);

  assert.equal(upgraded.venue, 'Royal Arena');
  assertProtectedFieldsPreserved(upgraded, existing);
});

test('latest user correction wins over an in-flight venue-only provider recovery', () => {
  const original = existingConcert();
  const candidate = { ...ticketmasterCandidate({ providerEventId: null }), _venueRecoveryOnly: true };
  const latest = { ...original, venue: 'User corrected venue', notes: 'Newer user note' };

  const merged = research.mergeTicketmasterConcertUpgrades([latest], [{ id: original.id, candidate }]);
  assert.equal(merged[0].venue, 'User corrected venue');
  assert.equal(merged[0].notes, 'Newer user note');
  assert.equal(merged[0].ticketUrl, original.ticketUrl);
});

test('latest same-ID record must still satisfy trusted venue evidence before persistence', () => {
  const original = existingConcert();
  const candidate = {
    ...ticketmasterCandidate({
      providerEventId: null,
      ticketUrl: 'https://different.example/provider-ticket',
    }),
    _venueRecoveryOnly: true,
  };
  assert.equal(research.trustedVenueRecoveryMatch(original, candidate), true);

  const latest = {
    ...original,
    city: 'User corrected city',
    venueAddress: 'User corrected address',
    ticketUrl: 'https://tickets.example/new-user-link',
    notes: 'Newer user evidence must win.',
  };
  const merged = research.mergeTicketmasterConcertUpgrades([latest], [{ id: original.id, candidate }]);

  assert.equal(merged[0].venue, 'Unknown venue');
  assert.equal(merged[0].city, 'User corrected city');
  assert.equal(merged[0].venueAddress, 'User corrected address');
  assert.equal(merged[0].ticketUrl, 'https://tickets.example/new-user-link');
  assert.equal(merged[0].notes, 'Newer user evidence must win.');
});

test('latest conflicting provider event identity blocks an in-flight venue-only recovery', () => {
  const original = existingConcert();
  const candidate = { ...ticketmasterCandidate(), _venueRecoveryOnly: true };
  assert.equal(research.trustedVenueRecoveryMatch(original, candidate), true);

  const latest = { ...original, providerEventId: 'tm-newer-conflicting-event' };
  const merged = research.mergeTicketmasterConcertUpgrades([latest], [{ id: original.id, candidate }]);

  assert.equal(merged[0].venue, 'Unknown venue');
  assert.equal(merged[0].providerEventId, 'tm-newer-conflicting-event');
});

test('latest matching ticket evidence can still complete a venue-only recovery when address changes', () => {
  const original = existingConcert({ venueAddress: null });
  const candidate = { ...ticketmasterCandidate({ venueAddress: null, providerEventId: null }), _venueRecoveryOnly: true };
  const latest = { ...original, venueAddress: 'Newer unrelated address note' };

  const merged = research.mergeTicketmasterConcertUpgrades([latest], [{ id: original.id, candidate }]);
  assert.equal(merged[0].venue, 'Royal Arena');
  assert.equal(merged[0].venueAddress, 'Newer unrelated address note');
  assert.equal(merged[0].ticketUrl, original.ticketUrl);
});

test('multiple equally strong unknown-venue records stay ambiguous instead of choosing one', () => {
  const first = existingConcert({ id: 'concert-a' });
  const second = existingConcert({ id: 'concert-b' });
  const candidate = ticketmasterCandidate({ providerEventId: null });

  const match = research.findTicketmasterConcertMatch([first, second], candidate);
  assert.equal(match.kind, 'ambiguous');
});
