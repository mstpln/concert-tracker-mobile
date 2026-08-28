'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
global.LiveVaultDiscoverModelV170 = require('../discoverModelV170');
const V171 = require('../discoverCorrectionsV171');

const CANDIDATE = {
  artistMbid: '11111111-1111-4111-8111-111111111111',
  name: 'Klaxons',
};

test('v171 exact-name matching is normalized but remains exact', () => {
  const rows = [
    { id: 'a', name: 'Klaxons' },
    { id: 'b', name: 'Klaxons UK' },
    { id: 'c', name: 'KLAXONS' },
  ];
  assert.deepEqual(V171.exactNameBands(rows, '  Klaxons  ').map((band) => band.id), ['a', 'c']);
  assert.deepEqual(V171.exactNameBands(rows, 'Klaxon').map((band) => band.id), []);
});

test('v171 treats any stored MusicBrainz ID evidence as review-required', () => {
  assert.equal(V171.hasStoredMbid({ musicbrainz: {} }), false);
  assert.equal(V171.hasStoredMbid({ musicbrainz: { mbid: '   ' } }), false);
  assert.equal(V171.hasStoredMbid({ musicbrainz: { mbid: 'not-a-valid-mbid-yet' } }), true);
  assert.equal(V171.hasStoredMbid({ musicbrainz: { mbid: '11111111-1111-4111-8111-111111111111' } }), true);
});

test('v171 same-name collision classification fails closed unless linking is safe', () => {
  assert.equal(V171.classifyExistingNameMatch([], CANDIDATE).kind, 'none');

  const linkable = V171.classifyExistingNameMatch([{ id: 'a', name: 'Klaxons', musicbrainz: {} }], CANDIDATE);
  assert.equal(linkable.kind, 'linkable');
  assert.equal(linkable.band.id, 'a');

  const sameTrusted = V171.classifyExistingNameMatch([{
    id: 'a',
    name: 'Klaxons',
    musicbrainz: { mbid: CANDIDATE.artistMbid, status: 'manual_confirmed' },
  }], CANDIDATE);
  assert.equal(sameTrusted.kind, 'same-trusted');

  const differentTrusted = V171.classifyExistingNameMatch([{
    id: 'a',
    name: 'Klaxons',
    musicbrainz: { mbid: '22222222-2222-4222-8222-222222222222', status: 'manual_confirmed' },
  }], CANDIDATE);
  assert.equal(differentTrusted.kind, 'blocked');
  assert.match(differentTrusted.message, /different confirmed MusicBrainz identity/);

  const storedUntrusted = V171.classifyExistingNameMatch([{
    id: 'a',
    name: 'Klaxons',
    musicbrainz: { mbid: 'not-yet-reviewed', status: 'review' },
  }], CANDIDATE);
  assert.equal(storedUntrusted.kind, 'blocked');
  assert.match(storedUntrusted.message, /Review the existing MusicBrainz identity/);

  const ambiguous = V171.classifyExistingNameMatch([
    { id: 'a', name: 'Klaxons', musicbrainz: {} },
    { id: 'b', name: 'KLAXONS', musicbrainz: {} },
  ], CANDIDATE);
  assert.equal(ambiguous.kind, 'blocked');
  assert.match(ambiguous.message, /More than one existing band/);
});

test('v171 linking an existing band preserves stable/user/provider fields and adds the confirmed MBID', () => {
  const existing = {
    id: 'band-klaxons',
    name: 'Klaxons',
    favorite: true,
    notes: 'keep me',
    futureField: { untouched: true },
    musicbrainz: {
      ticketmaster: {
        id: 'K8vZ917GZ57',
        status: 'manual_confirmed',
        confidence: 'user_confirmed',
        futureProviderField: 'preserve',
      },
    },
  };
  const candidate = {
    artistMbid: '11111111-1111-4111-8111-111111111111',
    name: 'Klaxons',
    area: 'United Kingdom',
    discoveredAt: '2026-08-28T10:00:00.000Z',
  };
  const linked = V171.buildLinkedBand(existing, candidate, '2026-08-28T12:00:00.000Z');
  assert.equal(linked.id, existing.id);
  assert.equal(linked.favorite, true);
  assert.equal(linked.notes, 'keep me');
  assert.deepEqual(linked.futureField, { untouched: true });
  assert.deepEqual(linked.musicbrainz.ticketmaster, existing.musicbrainz.ticketmaster);
  assert.equal(linked.musicbrainz.mbid, candidate.artistMbid);
  assert.equal(linked.musicbrainz.status, 'manual_confirmed');
  assert.equal(linked.musicbrainz.confidence, 'user_confirmed');
  assert.equal(linked.musicbrainz.matchMethod, 'discover_user_add_existing_band');
  assert.equal(linked.discoverRecommendation.artistMbid, candidate.artistMbid);
});

test('v171 visual contract keeps filter pills at the actual primary Discover tab height and corrects header emphasis', () => {
  const js = fs.readFileSync(path.join(root, 'discoverCorrectionsV171.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'discoverCorrectionsV171.css'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(js, /TAB_BRAND_HTML\.myconcerts = 'MY<span class="brand-blue">MUSIC<\/span>'/);
  assert.match(js, /TAB_BRAND_HTML\.news = 'CONCERT<span class="brand-blue">ALERTS<\/span>'/);
  assert.match(js, /if \(expected && title\.innerHTML !== expected\) title\.innerHTML = expected/);
  assert.match(css, /height:\s*32px/);
  assert.match(index, /discoverCorrectionsV171\.css/);
  assert.match(index, /discoverCorrectionsV171\.js/);
});

test('v171 Setlist.fm copy is conditional on missing trusted MusicBrainz identity', () => {
  const js = fs.readFileSync(path.join(root, 'discoverCorrectionsV171.js'), 'utf8');
  assert.match(js, /if \(!band \|\| trustedMbid\(band\)\) return/);
  assert.match(js, /Waiting for MusicBrainz identity/);
});
