'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../scripts/research');
const ticketmaster = require('../scripts/lib/ticketmaster');

process.env.TICKETMASTER_API_KEY = 'test-ticketmaster-key';

function storedConcert(overrides = {}) {
  return {
    id: 'le-sserafim-2026-10-23-kobenhavn-s',
    bandId: 'le-sserafim',
    bandName: 'LE SSERAFIM',
    date: '2026-10-23',
    time: '19:30:00',
    venue: 'Royal Arena',
    city: 'København S',
    country: 'Denmark',
    venueAddress: 'Hannemanns Allé 18-20, København S, Denmark',
    attending: true,
    ticketUrl: 'https://www.ticketmaster.dk/event/synthetic-le-sserafim',
    ticketPrice: 950,
    ticketQuantity: 4,
    ownedTickets: [{ id: 'ticket-1', type: 'url', url: 'https://tickets.example/user-owned' }],
    notes: 'User note must survive.',
    playlistUrl: 'https://open.spotify.com/playlist/user-owned',
    photos: ['https://photos.example/user-owned'],
    futureField: { preserve: true },
    sourceProvider: 'ticketmaster',
    providerEventId: 'tm-synthetic-le-sserafim',
    providerAttractionId: 'tm-le-sserafim',
    artistMatchMethod: 'confirmed_attraction_id',
    ...overrides,
  };
}

function providerCandidate(overrides = {}) {
  return {
    id: 'le-sserafim-2026-10-23-kobenhavn-s',
    bandId: 'le-sserafim',
    bandName: 'LE SSERAFIM',
    date: '2026-10-23',
    time: '20:15:00',
    venue: 'Royal Arena',
    city: 'København S',
    country: 'Denmark',
    venueAddress: 'Provider Canonical Address',
    ticketUrl: 'https://www.ticketmaster.dk/event/provider-canonical-link',
    ticketRetailerVerified: true,
    sourceProvider: 'ticketmaster',
    providerEventId: 'tm-synthetic-le-sserafim',
    providerAttractionId: 'tm-le-sserafim',
    artistMatchMethod: 'confirmed_attraction_id',
    distanceKm: 41,
    ...overrides,
  };
}

const PLACEHOLDER_VENUES = [
  'Unknown venue',
  'unknown',
  'Venue unknown',
  'TBA',
  'TBD',
  'Venue TBA',
  'Venue TBD',
  'To be announced',
  'To be determined',
];

test('v142 recognizes all provider venue placeholders consistently', () => {
  for (const venue of PLACEHOLDER_VENUES) assert.equal(research.isUnknownVenueName(venue), true, venue);
  assert.equal(research.isUnknownVenueName('Royal Arena'), false);
});

test('v142 exact provider refresh never downgrades a real venue to a placeholder', () => {
  const existing = storedConcert();
  for (const venue of PLACEHOLDER_VENUES) {
    const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, providerCandidate({ venue }));
    assert.equal(upgraded.venue, 'Royal Arena', venue);
    // Reject only the bad venue value; the rest of the exact-provider refresh remains useful.
    assert.equal(upgraded.time, '20:15:00');
    assert.equal(upgraded.venueAddress, 'Provider Canonical Address');
    assert.equal(upgraded.ticketUrl, 'https://www.ticketmaster.dk/event/provider-canonical-link');
    assert.equal(upgraded.distanceKm, 41);
  }
});

test('v142 blank provider venue also preserves an existing real venue', () => {
  const existing = storedConcert();
  for (const venue of ['', '   ', null, undefined]) {
    const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, providerCandidate({ venue }));
    assert.equal(upgraded.venue, 'Royal Arena');
  }
});

test('v142 still allows an exact provider event to move from one real venue to another real venue', () => {
  const existing = storedConcert();
  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, providerCandidate({ venue: 'Bella Arena' }));
  assert.equal(upgraded.venue, 'Bella Arena');
});

test('v142 preserves stable IDs, user-owned fields, ticket ownership and unknown future fields while blocking downgrade', () => {
  const existing = storedConcert();
  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, providerCandidate({ venue: 'Unknown venue' }));

  assert.equal(upgraded.id, existing.id);
  assert.equal(upgraded.attending, true);
  assert.equal(upgraded.ticketPrice, 950);
  assert.equal(upgraded.ticketQuantity, 4);
  assert.deepEqual(upgraded.ownedTickets, existing.ownedTickets);
  assert.equal(upgraded.notes, existing.notes);
  assert.equal(upgraded.playlistUrl, existing.playlistUrl);
  assert.deepEqual(upgraded.photos, existing.photos);
  assert.deepEqual(upgraded.futureField, existing.futureField);
});

test('v142 reapplies venue downgrade protection against the latest record before persistence', () => {
  const original = storedConcert({ venue: 'Unknown venue' });
  const candidate = providerCandidate({ venue: 'Unknown venue' });
  const latest = storedConcert({ venue: 'User corrected venue', notes: 'Latest user note' });

  const merged = research.mergeTicketmasterConcertUpgrades([latest], [{ id: original.id, candidate }]);
  assert.equal(merged[0].venue, 'User corrected venue');
  assert.equal(merged[0].notes, 'Latest user note');
  assert.equal(merged[0].time, '20:15:00');
});

test('v142 keeps GAU4 unknown-to-known trusted recovery intact', () => {
  const existing = storedConcert({
    venue: 'Unknown venue',
    sourceProvider: 'tavily_groq',
    providerEventId: null,
    venueAddress: 'Hannemanns Allé 18-20, København S, Denmark',
    ticketUrl: 'https://tickets.example/original',
  });
  const candidate = providerCandidate({
    providerEventId: null,
    venue: 'Royal Arena',
    venueAddress: 'Hannemanns Allé 18-20, København S, Denmark',
    ticketUrl: 'https://tickets.example/different',
  });

  assert.equal(research.trustedVenueRecoveryMatch(existing, candidate), true);
  const upgraded = research.upgradeExistingConcertWithTicketmaster(existing, { ...candidate, _venueRecoveryOnly: true });
  assert.equal(upgraded.venue, 'Royal Arena');
  assert.equal(upgraded.ticketUrl, existing.ticketUrl);
  assert.equal(upgraded.ticketQuantity, existing.ticketQuantity);
});

test('v163 Ticketmaster missing venue.name and providerVenueId is held instead of creating Unknown venue', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          events: [{
            id: 'tm-synthetic-le-sserafim',
            name: 'LE SSERAFIM live',
            url: 'https://www.ticketmaster.dk/event/provider-canonical-link',
            dates: { start: { localDate: '2026-10-23', localTime: '19:30:00' } },
            _embedded: {
              attractions: [{ id: 'tm-le-sserafim', name: 'LE SSERAFIM' }],
              venues: [{
                city: { name: 'København S' },
                country: { name: 'Denmark' },
                address: { line1: 'Hannemanns Allé 18-20' },
                location: { latitude: '55.6306', longitude: '12.5775' },
              }],
            },
          }],
        },
      }),
    });
    const usage = { canCallTicketmaster: () => true, recordTicketmasterCall: async () => {}, note: () => {} };
    const band = {
      id: 'le-sserafim',
      name: 'LE SSERAFIM',
      musicbrainz: { ticketmaster: { id: 'tm-le-sserafim', status: 'confirmed' } },
    };

    const candidates = await ticketmaster.fetchUpcomingEvents(band, usage);
    assert.deepEqual(candidates, []);
  } finally {
    global.fetch = originalFetch;
  }
});
