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

test('GAU4 recovers an unknown venue from a unique Ticketmaster candidate with exact address evidence', () => {
  const existing = existingConcert();
  const candidate = ticketmasterCandidate({ ticketUrl: 'https://different.example/provider-ticket' });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), true);
  const match = research.findTicketmasterConcertMatch([existing], candidate);
  assert.equal(match.kind, 'match');
  assert.equal(match.reason, 'trusted_venue_evidence');
  assert.equal(match.concert.id, existing.id);
});

test('GAU4 accepts an exact Ticketmaster ticket URL as strong recovery evidence when address evidence is absent', () => {
  const existing = existingConcert({ venueAddress: null });
  const candidate = ticketmasterCandidate({ venueAddress: null });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), true);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).reason, 'trusted_venue_evidence');
});

test('GAU4 does not guess a venue from city/date alone', () => {
  const existing = existingConcert({ venueAddress: null, ticketUrl: 'https://tickets.example/user-link' });
  const candidate = ticketmasterCandidate({ venueAddress: null, ticketUrl: 'https://www.ticketmaster.dk/event/other' });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).kind, 'none');
});

test('GAU4 fails closed when provider event IDs conflict', () => {
  const existing = existingConcert({ providerEventId: 'tm-other-event' });
  const candidate = ticketmasterCandidate({ providerEventId: 'tm-synthetic-le-sserafim' });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
  assert.equal(research.findTicketmasterConcertMatch([existing], candidate).kind, 'none');
});

test('GAU4 leaves Unknown venue when the trusted candidate also lacks a real venue name', () => {
  const existing = existingConcert();
  const candidate = ticketmasterCandidate({ venue: 'Unknown venue' });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), false);
});

test('venue-only recovery preserves stable ID and every unrelated/user-owned field', () => {
  const existing = existingConcert();
  const candidate = { ...ticketmasterCandidate(), _venueRecoveryOnly: true };
  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, candidate);

  assert.equal(upgraded.venue, 'Royal Arena');
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
});

test('latest user correction wins over an in-flight venue-only provider recovery', () => {
  const original = existingConcert();
  const candidate = { ...ticketmasterCandidate(), _venueRecoveryOnly: true };
  const latest = { ...original, venue: 'User corrected venue', notes: 'Newer user note' };

  const merged = research.mergeTicketmasterConcertUpgrades(latest ? [latest] : [], [{ id: original.id, candidate }]);
  assert.equal(merged[0].venue, 'User corrected venue');
  assert.equal(merged[0].notes, 'Newer user note');
  assert.equal(merged[0].ticketUrl, original.ticketUrl);
});

test('multiple equally strong unknown-venue records stay ambiguous instead of choosing one', () => {
  const first = existingConcert({ id: 'concert-a' });
  const second = existingConcert({ id: 'concert-b' });
  const candidate = ticketmasterCandidate();

  const match = research.findTicketmasterConcertMatch([first, second], candidate);
  assert.equal(match.kind, 'ambiguous');
});
