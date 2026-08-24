'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ticketmaster = require('../scripts/lib/ticketmaster');

process.env.TICKETMASTER_API_KEY = 'test-ticketmaster-key';

function eventWithVenueName(name) {
  return {
    id: 'tm-synthetic-le-sserafim',
    name: 'LE SSERAFIM live',
    url: 'https://www.ticketmaster.dk/event/provider-canonical-link',
    dates: { start: { localDate: '2026-10-23', localTime: '19:30:00' } },
    _embedded: {
      attractions: [{ id: 'tm-le-sserafim', name: 'LE SSERAFIM' }],
      venues: [{
        ...(name === undefined ? {} : { name }),
        city: { name: 'København S' },
        country: { name: 'Denmark' },
        address: { line1: 'Hannemanns Allé 18-20' },
        location: { latitude: '55.6306', longitude: '12.5775' },
      }],
    },
  };
}

async function fetchCandidate(venueName) {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ _embedded: { events: [eventWithVenueName(venueName)] } }),
    });
    const usage = { canCallTicketmaster: () => true, recordTicketmasterCall: async () => {}, note: () => {} };
    const band = {
      id: 'le-sserafim',
      name: 'LE SSERAFIM',
      musicbrainz: { ticketmaster: { id: 'tm-le-sserafim', status: 'confirmed' } },
    };
    const [candidate] = await ticketmaster.fetchUpcomingEvents(band, usage);
    return candidate;
  } finally {
    global.fetch = originalFetch;
  }
}

test('v163 Ticketmaster admission holds malformed venue names without a recoverable provider venue ID', async () => {
  for (const venueName of [{}, [], true, false, 42]) {
    const candidate = await fetchCandidate(venueName);
    assert.equal(candidate, undefined, `venue.name=${JSON.stringify(venueName)}`);
  }
});

test('v163 Ticketmaster admission holds missing and blank venue names without a recoverable provider venue ID', async () => {
  for (const venueName of [undefined, null, '', '   ']) {
    const candidate = await fetchCandidate(venueName);
    assert.equal(candidate, undefined, `venue.name=${String(venueName)}`);
  }
});

test('v142 Ticketmaster adapter trims and preserves a real venue name', async () => {
  const candidate = await fetchCandidate('  Royal Arena  ');
  assert.equal(candidate.venue, 'Royal Arena');
});
