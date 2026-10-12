'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../scripts/lib/newArtistProfile');
const mb = require('../scripts/lib/musicbrainz');
const { planMusicbrainzResearch } = require('../scripts/lib/musicbrainzResearchSchedule');
const ticketmaster = require('../scripts/lib/ticketmaster');

const artist = (overrides = {}) => ({
  id: 'new-artist', name: 'Example Act', notes: 'user-owned',
  artistProfileResearch: { status: 'pending' },
  musicbrainz: {
    status: 'auto_confirmed', mbid: 'mbid-1',
    metadata: { mbid: 'mbid-1', artistName: 'Example Act', artistType: 'Group',
      country: 'SE', beginYear: '2002', genre: 'indie rock',
      officialUrl: 'https://exampleartist.com', instagram: 'https://www.instagram.com/exampleact/',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Example_Act' },
    spotify: { status: 'confirmed', id: 'spotify-1' },
  }, ...overrides,
});

test('new profile only runs after trusted exact MusicBrainz metadata', () => {
  assert.equal(profile.profileDue(artist()), true);
  assert.equal(profile.profileDue(artist({ musicbrainz: { status: 'needs_review', mbid: null } })), false);
  assert.equal(profile.profileDue(artist({ artistProfileResearch: undefined })), false);
  assert.equal(profile.profileDue(artist({ artistProfileResearch: { status: 'complete' } })), false);
});

test('profile merging preserves user and unknown fields and only fills blank values', () => {
  const base = artist({ futureField: { nested: 2 }, photoUrl: 'https://user.example/image.jpg' });
  const patch = {
    bandId: base.id, expectedMbid: 'mbid-1', officialUrl: 'https://exampleartist.com',
    instagram: 'https://www.instagram.com/exampleact/', country: 'Sweden', formedYear: '2002', genre: 'indie rock',
    bio: 'An artist biography recorded by a trustworthy source.',
    provenance: { source: 'musicbrainz_linked_wikipedia', sourceUrl: 'https://en.wikipedia.org/wiki/Example_Act' },
    state: { status: 'complete', lastAttemptedAt: '2026-10-12' },
  };
  const [out] = profile.mergeProfilePatches([base], [patch]);
  assert.equal(out.notes, 'user-owned');
  assert.deepEqual(out.futureField, { nested: 2 });
  assert.equal(out.photoUrl, base.photoUrl);
  assert.equal(out.formedYear, '2002');
  assert.equal(out.genre, 'indie rock');
  assert.equal(out.origin, 'Sweden');
  assert.equal(out.generatedBio, patch.bio);
  assert.equal(out.generatedBioProvenance.source, 'musicbrainz_linked_wikipedia');
  assert.equal(out.socials.spotify, 'https://open.spotify.com/artist/spotify-1');
  const rerun = profile.mergeProfilePatches([out], [patch])[0];
  assert.deepEqual(rerun, out);
  assert.equal(profile.mergeProfilePatches([], [patch]).length, 0);
});

test('solo performers never gain a group formation year', async () => {
  const a = artist();
  a.musicbrainz.metadata.artistType = 'Person';
  const result = await profile.researchOne(a, {}, '2026-10-12T12:00:00Z', {
    wikipedia: async () => 'A documented singer and musician from a reliable source.'
  });
  assert.equal(result.formedYear, null);
  assert.equal(result.bio.startsWith('A documented'), true);
});

test('Wikipedia lookup is exact-link-only, disambiguation-safe and no guesses', async () => {
  assert.equal(profile.wikipediaSummaryUrl('http://en.wikipedia.org/wiki/Example'), null);
  assert.equal(profile.wikipediaSummaryUrl('https://en.wikipedia.org/wiki/Example'), 'https://en.wikipedia.org/api/rest_v1/page/summary/Example');
  assert.equal(await profile.fetchVerifiedWikipediaBio('https://en.wikipedia.org/wiki/Example', {
    sleep: async () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ type: 'disambiguation', extract: 'An untrusted paragraph about a different performer.' }) })
  }), null);
  assert.equal(profile.safeOfficialHost('https://en.wikipedia.org/wiki/Example'), null);
  assert.equal(profile.safeOfficialHost('https://exampleartist.com/about'), 'exampleartist.com');
});

test('Tavily extra profile budget uses same application cap and monthly reserve', () => {
  const usage = { state: { artistProfileResearch: { month: '2026-10', tavilyCalls: 30 } }, canCallTavily: () => true };
  assert.equal(profile.monthlyProfileTavilyAllowance(usage, '2026-10-12'), false);
  assert.equal(profile.monthlyProfileTavilyAllowance(usage, '2026-11-01'), true);
  usage.canCallTavily = () => false;
  assert.equal(profile.monthlyProfileTavilyAllowance(usage, '2026-11-01'), false);
});

test('new bands take priority in scheduled MusicBrainz metadata refresh', () => {
  const regular = artist({ id: 'a', artistProfileResearch: undefined });
  const recent = artist({ id: 'b' });
  const plan = planMusicbrainzResearch([regular, recent], { perRunCap: 1, now: '2026-10-12T12:00:00Z', releaseMonitoringEnabled: false });
  assert.equal(plan.selected[0].bandId, 'b');
});

test('solo artists can pass strict exact match; suspicious namesake still review', async () => {
  const candidate = { id: 'mb-person', name: 'Example Act', type: 'Person', score: 100, country: 'SE' };
  const input = { id:'b', name:'Example Act' };
  const fake = async () => ({ ok:true, json:async () => ({ artists: [candidate] }) });
  const usage = { canCallMusicbrainz: () => true, recordMusicbrainzAttempt: async () => {} };
  const result = await mb.searchArtist(input, usage, fake);
  assert.equal(result.automatic.mbid, 'mb-person');
  const conflict = await mb.searchArtist(input, usage, async () => ({ ok:true, json:async () => ({ artists:[candidate, { ...candidate, id:'other' }] }) }));
  assert.equal(conflict.automatic, null);
});

test('source-backed profile run never processes more than two artists', async () => {
  const bands = Array.from({ length: 4 }, (_, i) => artist({ id: 'new-' + i }));
  let saved;
  const result = await profile.runNewArtistProfiles({
    bands, usage: {}, helpers: { wikipedia: async () => 'The artist is an independently documented musical group.' },
    writeReconciled: async (_name, reconcile) => { saved = reconcile(bands); },
  });
  assert.equal(result.considered, 2);
  assert.equal(saved.filter(b => b.artistProfileResearch.status === 'complete').length, 2);
});

test('exact genuine band names can contain Revival', () => {
  const record = mb.candidateFrom({ id:'ccr', name:'Creedence Clearwater Revival', score:100, type:'Group' },
    { name:'Creedence Clearwater Revival' });
  assert.equal(record._bad, false);
});

test('MusicBrainz profile metadata exposes only voted unambiguous genres and official URLs', async () => {
  const sample = { id: 'm', name: 'Example Act', type: 'Group', country: 'SE',
    'life-span': { begin: '2002-01-01' },
    genres: [{ name: 'indie rock', count: 5 }, { name: 'rock', count: 2 }],
    relations: [
      { type: 'official homepage', url: { resource: 'https://exampleartist.com/' } },
      { type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Example_Act' } },
      { type: 'social network', url: { resource: 'https://www.instagram.com/exampleact/' } },
    ] };
  let requested = '';
  const usage = { canCallMusicbrainz: () => true, recordMusicbrainzAttempt: async () => {} };
  const read = await mb.fetchArtistMetadata('m', usage, async (url) => {
    requested = url.searchParams.get('inc');
    return { ok:true, json:async () => sample };
  });
  assert.equal(requested, 'aliases+url-rels+genres');
  assert.equal(read.metadata.genre, 'indie rock');
  assert.equal(read.metadata.beginYear, '2002');
  assert.equal(read.metadata.officialUrl, 'https://exampleartist.com/');
  assert.equal(read.metadata.wikipediaUrl, 'https://en.wikipedia.org/wiki/Example_Act');
  assert.equal(read.metadata.instagram, 'https://www.instagram.com/exampleact/');
  sample.type = 'Person';
  sample.genres = [{ name:'rock', count:1 }];
  const solo = await mb.fetchArtistMetadata('m', usage, async () => ({ ok:true, json:async () => sample }));
  assert.equal(solo.metadata.beginYear, null);
  assert.equal(solo.metadata.genre, null);
});

test('new artists get image priority without increasing the existing maintenance cap', () => {
  const { planArtistImageMaintenance } = require('../scripts/lib/artistImageMaintenance');
  const old = artist({ id: 'a-old', artistProfileResearch: undefined });
  const added = artist({ id: 'z-new' });
  const planned = planArtistImageMaintenance([old, added], null, { cap: 1 });
  assert.equal(planned.items.length, 1);
  assert.equal(planned.items[0].bandId, 'z-new');
});
