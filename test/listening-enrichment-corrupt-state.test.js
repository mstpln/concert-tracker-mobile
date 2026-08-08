'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function fixture() {
  const bands = [{
    id: 'band-1',
    name: 'Example Band',
    musicbrainz: {
      mbid: MB_ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
    },
  }];
  const events = [{
    bandId: 'band-1',
    artistCreditName: 'Example Band',
    recordingTitle: 'Exact Song',
    spotifyTrackId: 'SpotifyTrack123',
  }];
  return { bands, events };
}

test('exact malformed identity record values block instead of becoming fresh work', () => {
  const { bands, events } = fixture();
  const base = inventoryLib.buildListeningInventory({ bands, events });
  const item = base.items[0];

  for (const malformed of [null, false, 0, 'bad-record', []]) {
    const plan = engine.planEnrichment({
      inventory: base,
      trackIdentities: { records: { [item.trackKey]: malformed } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.blocked, 1);

    const rebuilt = inventoryLib.buildListeningInventory({
      bands,
      events,
      trackIdentities: { records: { [item.trackKey]: malformed } },
    });
    assert.equal(rebuilt.items[0].status, 'blocked');
    assert.equal(rebuilt.items[0].reason, 'stored_track_identity_conflict');
  }
});

test('missing required stored work key blocks identity reuse', () => {
  const { bands, events } = fixture();
  const base = inventoryLib.buildListeningInventory({ bands, events });
  const item = base.items[0];
  const record = { spotifyTrackId: item.spotifyTrackId };

  const plan = engine.planEnrichment({ inventory: base, trackIdentities: { records: { [item.trackKey]: record } } });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.blocked, 1);

  const rebuilt = inventoryLib.buildListeningInventory({ bands, events, trackIdentities: { records: { [item.trackKey]: record } } });
  assert.equal(rebuilt.items[0].status, 'blocked');
  assert.equal(rebuilt.items[0].reason, 'stored_track_identity_conflict');
});

test('explicit wrong reusable document kind or version stops before planning', () => {
  const { bands, events } = fixture();
  const base = inventoryLib.buildListeningInventory({ bands, events });
  const item = base.items[0];
  const record = { workKey: item.trackKey, spotifyTrackId: item.spotifyTrackId };

  for (const document of [
    { kind: 'wrong-kind', schemaVersion: 1, records: { [item.trackKey]: record } },
    { kind: 'livevault-track-identities', schemaVersion: 2, records: { [item.trackKey]: record } },
  ]) {
    assert.throws(() => engine.planEnrichment({ inventory: base, trackIdentities: document }), /Invalid track identity document/);
    assert.throws(() => inventoryLib.buildListeningInventory({ bands, events, trackIdentities: document }), /Invalid track identity document/);
  }

  assert.throws(() => inventoryLib.buildListeningInventory({
    bands,
    events,
    spotifyMetadata: { kind: 'wrong-kind', schemaVersion: 1, records: {} },
  }), /Invalid Spotify metadata document/);
});

test('malformed stored dates and known provider observation fields block reuse', () => {
  const { bands, events } = fixture();
  const base = inventoryLib.buildListeningInventory({ bands, events });
  const item = base.items[0];
  const required = { workKey: item.trackKey, spotifyTrackId: item.spotifyTrackId };
  const records = [
    { ...required, updatedAt: 'not-a-date' },
    { ...required, nextEligibleCheckAt: 'not-a-date' },
    { ...required, providers: { spotify: { status: 17 } } },
    { ...required, providers: { spotify: { reason: 17 } } },
    { ...required, providers: { spotify: { checkedAt: 'not-a-date' } } },
  ];

  for (const record of records) {
    const plan = engine.planEnrichment({
      inventory: base,
      trackIdentities: { records: { [item.trackKey]: record } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.blocked, 1);

    const rebuilt = inventoryLib.buildListeningInventory({
      bands,
      events,
      trackIdentities: { records: { [item.trackKey]: record } },
    });
    assert.equal(rebuilt.items[0].status, 'blocked');
    assert.equal(rebuilt.items[0].reason, 'stored_track_identity_conflict');
  }
});

test('persistence helpers reject malformed existing values and invalid timestamps', () => {
  const { bands, events } = fixture();
  const item = inventoryLib.buildListeningInventory({ bands, events }).items[0];

  assert.throws(() => engine.mergeIdentityRecord('bad-existing', item, 'spotify', {
    status: 'no_match',
    reason: 'not_found',
  }), /conflicts with the planned work item/);

  assert.throws(() => engine.mergeIdentityRecord(null, item, 'spotify', {
    status: 'no_match',
    reason: 'not_found',
  }, 'not-a-date'), /Invalid enrichment observation time/);

  assert.equal(engine.spotifyMetadataRecord('bad-existing', item, {
    status: 'metadata',
    requestedTrackId: item.spotifyTrackId,
    resolvedTrackId: item.spotifyTrackId,
    relinked: false,
    spotifyArtistIds: ['SpotifyArtist123'],
  }), null);
});
