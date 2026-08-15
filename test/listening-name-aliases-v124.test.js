'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../spotifyHistoryImport');
const migration = require('../listeningDerivedMigration');
const inventory = require('../scripts/listening-inventory');
const albumArtwork = require('../scripts/spotify-album-artwork-core');

const bands = [
  { id: 'bea', name: 'Bea', listeningAliases: ['Bea and her Business', '  '] },
  { id: 'other', name: 'Other Artist' },
];

test('canonical names and listeningAliases resolve to the same unique band', () => {
  const historyIndex = history.bandNameLookup(bands);
  const migrationIndex = migration.bandLookup(bands);
  const inventoryIndex = inventory.bandIndex(bands);
  const artworkIndex = albumArtwork.bandOwnershipIndex(bands);

  for (const name of ['bea', 'bea and her business']) {
    assert.equal(historyIndex.get(name), 'bea');
    assert.equal(migrationIndex.get(name), 'bea');
    assert.equal(inventoryIndex.byName.get(name), 'bea');
    assert.equal(artworkIndex.byUniqueName.get(name), 'bea');
  }
});

test('old records and malformed alias fields remain backward compatible', () => {
  const rows = [
    { id: 'legacy', name: 'Legacy Artist' },
    { id: 'malformed', name: 'Malformed Artist', listeningAliases: 'not-an-array' },
  ];
  assert.equal(history.bandNameLookup(rows).get('legacy artist'), 'legacy');
  assert.equal(migration.bandLookup(rows).get('malformed artist'), 'malformed');
  assert.equal(inventory.bandIndex(rows).byName.has('not-an-array'), false);
  assert.equal(albumArtwork.bandOwnershipIndex(rows).byUniqueName.has('not-an-array'), false);
});

test('same-band duplicate aliases do not create false ambiguity', () => {
  const rows = [{ id: 'bea', name: 'Bea', listeningAliases: ['BEA', 'Bea'] }];
  assert.equal(history.bandNameLookup(rows).get('bea'), 'bea');
  assert.equal(migration.bandLookup(rows).get('bea'), 'bea');
  assert.equal(inventory.bandIndex(rows).byName.get('bea'), 'bea');
  assert.equal(albumArtwork.bandOwnershipIndex(rows).byUniqueName.get('bea'), 'bea');
});

test('alias collisions across bands fail closed', () => {
  const rows = [
    { id: 'one', name: 'One', listeningAliases: ['Shared Name'] },
    { id: 'two', name: 'Two', listeningAliases: ['Shared Name'] },
  ];
  assert.equal(history.bandNameLookup(rows).has('shared name'), false);
  assert.equal(migration.bandLookup(rows).has('shared name'), false);
  const inventoryIndex = inventory.bandIndex(rows);
  assert.equal(inventoryIndex.byName.has('shared name'), false);
  assert.equal(inventoryIndex.ambiguousNames.has('shared name'), true);
  assert.equal(albumArtwork.bandOwnershipIndex(rows).byUniqueName.has('shared name'), false);
});

test('canonical-versus-alias collisions also fail closed', () => {
  const rows = [
    { id: 'canonical', name: 'Shared Name' },
    { id: 'alias-owner', name: 'Different Name', listeningAliases: ['Shared Name'] },
  ];
  assert.equal(history.bandNameLookup(rows).has('shared name'), false);
  assert.equal(migration.bandLookup(rows).has('shared name'), false);
  assert.equal(inventory.bandIndex(rows).byName.has('shared name'), false);
  assert.equal(albumArtwork.bandOwnershipIndex(rows).byUniqueName.has('shared name'), false);
});

test('explicit stable band IDs remain authoritative over ambiguous text', () => {
  const rows = [
    { id: 'one', name: 'One', listeningAliases: ['Shared Name'] },
    { id: 'two', name: 'Two', listeningAliases: ['Shared Name'] },
  ];
  const inventoryIndex = inventory.bandIndex(rows);
  const artworkIndex = albumArtwork.bandOwnershipIndex(rows);
  assert.equal(inventory.mappedBandId({ localBandId: 'one', artistCreditName: 'Shared Name' }, inventoryIndex), 'one');
  assert.equal(albumArtwork.mappedBandId({ bandId: 'two', artistCreditName: 'Shared Name' }, artworkIndex), 'two');
  assert.equal(inventory.mappedBandId({ localBandId: 'missing', artistCreditName: 'One' }, inventoryIndex), null);
});

test('derived migration maps historical alias text without rewriting the source event', () => {
  const contracts = {
    identityEnvelope(event) { return { sourceEventId: event.sourceEventId, localBandId: event.localBandId || null }; },
    canonicalEnvelope(event) { return { sourceEventId: event.sourceEventId, canonicalListenId: event.canonicalListenId }; },
  };
  const event = { stableListenId: 'listen-1', artistCreditName: 'Bea and her Business' };
  const result = migration.deriveRecords([event], bands, contracts);
  assert.equal(result.identities[0].localBandId, 'bea');
  assert.equal(result.identities[0].status, 'resolved');
  assert.deepEqual(event, { stableListenId: 'listen-1', artistCreditName: 'Bea and her Business' });
});
