'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../spotifyHistoryImport');
const migration = require('../listeningDerivedMigration');
const inventory = require('../scripts/listening-inventory');
const albumArtwork = require('../scripts/spotify-album-artwork-core');
const browserAlbumArtwork = require('../spotifyListeningAlbumArtworkV113');

const bands = [
  { id: 'bea', name: 'Bea', listeningAliases: ['Bea and her Business', '  '] },
  { id: 'other', name: 'Other Artist' },
];

test('canonical names and listeningAliases resolve to the same unique band', () => {
  const historyIndex = history.bandNameLookup(bands);
  const migrationIndex = migration.bandLookup(bands);
  const inventoryIndex = inventory.bandIndex(bands);
  const artworkIndex = albumArtwork.bandOwnershipIndex(bands);
  const browserArtworkIndex = browserAlbumArtwork.uniqueBandNameMap(bands);

  for (const name of ['bea', 'bea and her business']) {
    assert.equal(historyIndex.get(name), 'bea');
    assert.equal(migrationIndex.get(name), 'bea');
    assert.equal(inventoryIndex.byName.get(name), 'bea');
    assert.equal(artworkIndex.byUniqueName.get(name), 'bea');
    assert.equal(browserArtworkIndex.get(name), 'bea');
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
  assert.equal(browserAlbumArtwork.uniqueBandNameMap(rows).has('not-an-array'), false);
});

test('malformed elements inside listeningAliases are ignored instead of string-coerced', () => {
  const rows = [{
    id: 'safe',
    name: 'Safe Artist',
    listeningAliases: ['Historical Artist', 123, { bad: true }, false, null],
  }];
  const historyIndex = history.bandNameLookup(rows);
  const migrationIndex = migration.bandLookup(rows);
  const inventoryIndex = inventory.bandIndex(rows);
  const artworkIndex = albumArtwork.bandOwnershipIndex(rows);
  const browserArtworkIndex = browserAlbumArtwork.uniqueBandNameMap(rows);

  assert.equal(historyIndex.get('historical artist'), 'safe');
  assert.equal(migrationIndex.get('historical artist'), 'safe');
  assert.equal(inventoryIndex.byName.get('historical artist'), 'safe');
  assert.equal(artworkIndex.byUniqueName.get('historical artist'), 'safe');
  assert.equal(browserArtworkIndex.get('historical artist'), 'safe');

  for (const malformedName of ['123', '[object object]', 'false']) {
    assert.equal(historyIndex.has(malformedName), false);
    assert.equal(migrationIndex.has(malformedName), false);
    assert.equal(inventoryIndex.byName.has(malformedName), false);
    assert.equal(artworkIndex.byUniqueName.has(malformedName), false);
    assert.equal(browserArtworkIndex.has(malformedName), false);
  }
});

test('same-band duplicate aliases do not create false ambiguity', () => {
  const rows = [{ id: 'bea', name: 'Bea', listeningAliases: ['BEA', 'Bea'] }];
  assert.equal(history.bandNameLookup(rows).get('bea'), 'bea');
  assert.equal(migration.bandLookup(rows).get('bea'), 'bea');
  assert.equal(inventory.bandIndex(rows).byName.get('bea'), 'bea');
  assert.equal(albumArtwork.bandOwnershipIndex(rows).byUniqueName.get('bea'), 'bea');
  assert.equal(browserAlbumArtwork.uniqueBandNameMap(rows).get('bea'), 'bea');
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
  assert.equal(browserAlbumArtwork.uniqueBandNameMap(rows).has('shared name'), false);
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
  assert.equal(browserAlbumArtwork.uniqueBandNameMap(rows).has('shared name'), false);
});

test('explicit stable band IDs remain authoritative over ambiguous text', () => {
  const rows = [
    { id: 'one', name: 'One', listeningAliases: ['Shared Name'] },
    { id: 'two', name: 'Two', listeningAliases: ['Shared Name'] },
  ];
  const inventoryIndex = inventory.bandIndex(rows);
  const artworkIndex = albumArtwork.bandOwnershipIndex(rows);
  const browserIndex = browserAlbumArtwork.uniqueBandNameMap(rows);
  const browserIds = browserAlbumArtwork.knownBandIds(rows);
  assert.equal(inventory.mappedBandId({ localBandId: 'one', artistCreditName: 'Shared Name' }, inventoryIndex), 'one');
  assert.equal(albumArtwork.mappedBandId({ bandId: 'two', artistCreditName: 'Shared Name' }, artworkIndex), 'two');
  assert.equal(browserAlbumArtwork.localBandId({ localBandId: 'one', artistCreditName: 'Shared Name' }, browserIndex, browserIds), 'one');
  assert.equal(inventory.mappedBandId({ localBandId: 'missing', artistCreditName: 'One' }, inventoryIndex), null);
  assert.equal(browserAlbumArtwork.localBandId({ localBandId: 'missing', artistCreditName: 'One' }, browserIndex, browserIds), null);
});

test('browser album artwork groups an alias-matched event under the stable band', () => {
  const bandMap = browserAlbumArtwork.uniqueBandNameMap(bands);
  const bandIds = browserAlbumArtwork.knownBandIds(bands);
  const event = {
    artistCreditName: 'Bea and her Business',
    releaseTitle: 'Example Album',
    spotifyTrackId: 'track123',
  };
  assert.equal(browserAlbumArtwork.localBandId(event, bandMap, bandIds), 'bea');
  assert.equal(browserAlbumArtwork.groupKey(event, bandMap, bandIds), 'bea\nexample album');
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
