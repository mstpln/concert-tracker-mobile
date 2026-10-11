'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { dlMyConcerts, dlConcertStats, dlIsCancelled, dlIsUpcoming } = require('../dataLib');

const date = (offset) => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  today.setDate(today.getDate() + offset);
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
};
const record = (id, offset, extras = {}) => ({
  id, bandId: id, bandName: id, venue: 'Synthetic Arena', city: 'Sample City',
  country: 'Exampleland', date: date(offset), attending: true,
  ticketPrice: 500, ticketQuantity: 1, distanceKm: 50,
  ownedTickets: [{ id: 'ticket-'+id, type: 'url', url: 'https://example.invalid/ticket' }],
  notes: 'Private test notes', futureField: { keep: true }, ...extras
});

test('upcoming cancellation preserves data and never becomes attended by date', () => {
  const old = record('cancelled-past', -3, { personalLifecycleStatus: 'cancelled' });
  const next = record('cancelled-future', 5, { personalLifecycleStatus: 'cancelled' });
  const attended = record('attended', -7);
  const going = record('going', 9);
  const collection = [old, next, attended, going];
  const view = dlMyConcerts(collection);
  assert.deepEqual(view.past.map((c) => c.id), ['attended']);
  assert.deepEqual(view.upcoming.map((c) => c.id), ['going']);
  assert.deepEqual(new Set(view.cancelled.map((c) => c.id)), new Set(['cancelled-past', 'cancelled-future']));
  assert.equal(dlIsUpcoming(next), false);
  assert.equal(dlIsCancelled(next), true);
  assert.deepEqual(next.ownedTickets, collection[1].ownedTickets);
  assert.deepEqual(next.futureField, { keep: true });
});

test('manual active restoration overrides provider presentation without modifying evidence', () => {
  const original = record('provider-cancelled', 10, {
    lifecycleStatus: 'cancelled', providerObservations: [{ source: 'test', status: 'cancelled' }]
  });
  assert.equal(dlIsCancelled(original), true);
  const restored = { ...original, personalLifecycleStatus: 'active' };
  assert.equal(dlIsCancelled(restored), false);
  assert.equal(dlIsUpcoming(restored), true);
  assert.equal(restored.lifecycleStatus, 'cancelled');
  assert.deepEqual(restored.providerObservations, original.providerObservations);
});

test('cancelled performances and ticket prices contribute zero to statistics', () => {
  const past = record('past', -8, { ticketPrice: 120, distanceKm: 35 });
  const cancelledPast = record('cancelled-past', -7, { lifecycleStatus: 'cancelled', ticketPrice: 10000, distanceKm: 999 });
  const cancelledUpcoming = record('cancelled-next', 8, { personalLifecycleStatus: 'cancelled', ticketPrice: 10000 });
  const stats = dlConcertStats([past, cancelledPast], [], [cancelledUpcoming]);
  assert.equal(stats.totalShows, 1);
  assert.equal(stats.totalSpend, 120);
  assert.equal(stats.performanceCount, 1);
  assert.equal(stats.kmTraveled, 70);
  assert.equal(stats.totalUniqueArtists, 1);
});

test('approved UI has dual tab, version-eight uppercase statuses, safeguards and retained provider ownership', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  const css = fs.readFileSync('app.css', 'utf8');
  assert.match(app, /data-my-history-tab="past"/);
  assert.match(app, /data-my-history-tab="cancelled"/);
  assert.match(app, /ATTENDED<\/span>/);
  assert.match(app, /CANCELLED<\/span>/);
  assert.match(app, /my-lifecycle-action/);
  assert.match(app, /if \(!confirm\('Remove this concert from My Music/);
  assert.match(app, /if \(!confirm\(action === 'cancel'/);
  assert.match(app, /dlWriteJsonFileIfCurrent\(remote, 'concerts.json', next\)/);
  assert.match(css, /gap:20px/);
  assert.match(css, /height:28px/);
  assert.doesNotMatch(app, /updated\.lifecycleStatus = 'active'/);
});


test('canonical duplicate read view preserves the user cancellation even on a less-rich row', () => {
  const Canonical = require('../canonicalIdentityV174');
  const index = Canonical.buildVenueIndex([{
    venueId: 'venue-aaaabbbb', name: 'QA Example Hall',
    city: 'Sample City', country: 'Sweden', address: '1 Fictional Avenue',
    researchStatus: 'partial', schemaVersion: 1,
  }]);
  const identity = {
    bandId: 'qa-artist', bandName: 'QA Artist', venue: 'QA Example Hall',
    city: 'Sample City', country: 'Sweden', venueAddress: '1 Fictional Avenue',
    date: '2027-11-20', attending: true,
  };
  const richProvider = { ...identity, id: 'provider-rich', notes: 'Preserve rich user data',
    rating: 5, ticketPrice: 800, ownedTickets: [{ id: 'qa-ticket', type: 'url' }] };
  const personal = { ...identity, id: 'user-status', personalLifecycleStatus: 'cancelled' };
  const view = Canonical.canonicalConcertReadView([richProvider, personal], index);
  assert.equal(view.records.length, 1);
  assert.equal(view.records[0].id, 'provider-rich');
  assert.equal(view.records[0].personalLifecycleStatus, 'cancelled');
  assert.equal(view.records[0].notes, 'Preserve rich user data');
  assert.equal(view.records[0].ownedTickets[0].id, 'qa-ticket');

  const conflict = Canonical.canonicalConcertReadView([
    { ...identity, id: 'cancelled', personalLifecycleStatus: 'cancelled' },
    { ...identity, id: 'restored', personalLifecycleStatus: 'active' },
  ], index);
  assert.equal(conflict.records.length, 2);
  assert.ok(conflict.conflicts[0].fields.includes('personalLifecycleStatus'));
});
