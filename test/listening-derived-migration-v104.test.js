'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../listeningDerivedMigration.js');
const contracts = require('../listeningIdentityContracts.js');
const storage = require('../listeningDerivedStorage.js');

const REC = '11111111-2222-4333-8444-555555555555';
const REL = '12345678-1234-4234-8234-123456789abc';

test('baseline preparation omits absent provider identity fields instead of clearing enrichment', () => {
  const event = {
    stableListenId: 'synthetic:baseline',
    source: 'spotify_import',
    listenedAt: '2026-08-01T10:00:00.000Z',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Track',
    releaseTitle: 'Synthetic Album',
  };
  const result = migration.deriveRecords([event], [{ id: 'band-synthetic', name: 'Synthetic Artist' }], contracts);
  const identity = result.identities[0];
  assert.equal(identity.bandId, 'band-synthetic');
  assert.equal(Object.hasOwn(identity, 'recordingMbid'), false);
  assert.equal(Object.hasOwn(identity, 'releaseMbid'), false);
  assert.equal(Object.hasOwn(identity, 'releaseGroupMbid'), false);
  assert.equal(Object.hasOwn(identity, 'spotifyTrackId'), false);
});

test('later baseline merge preserves previously enriched provider identity', () => {
  const enriched = {
    sourceEventId: 'synthetic:baseline',
    identityVersion: 1,
    status: 'resolved',
    bandId: 'band-synthetic',
    recordingMbid: REC,
    releaseMbid: REL,
  };
  const baseline = migration.compactIdentityEnvelope({
    sourceEventId: 'synthetic:baseline',
    identityVersion: 1,
    status: 'resolved',
    bandId: 'band-synthetic',
    recordingMbid: null,
    releaseMbid: null,
    artistMbids: [],
  });
  const merged = storage.mergeDerivedRecord(enriched, baseline);
  assert.equal(merged.recordingMbid, REC);
  assert.equal(merged.releaseMbid, REL);
});
