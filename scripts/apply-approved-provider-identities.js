'use strict';

const worker = require('./lib/workerClient');
const identities = require('../providerIdentityState');

const APPROVED_IDENTITIES = Object.freeze([
  Object.freeze({ name: 'The Technicolors', musicbrainzId: 'dbd44897-b9e6-445d-8aca-25e1c2405f51', spotifyId: '6hQS54VPpxunuwR0W7usuo' }),
  Object.freeze({ name: 'Maudlin Strangers', musicbrainzId: '441652b6-1271-468f-aecc-c2fd0adb6312', spotifyId: '4KNxadN8IN1sYO7CWAOjoH' }),
  Object.freeze({ name: 'James and the Cold Gun', musicbrainzId: 'e32f7fd4-9b61-4058-acb9-569e1eb38419', spotifyId: '5YFIVhzlaYH9Yadjw9gSUx' }),
  Object.freeze({ name: 'The Plan', musicbrainzId: '525669cc-1604-41af-b8e5-502e18734071', spotifyId: '1xp8n7sGGGHKO6pwxH8RCI' }),
  Object.freeze({ name: 'LE SSERAFIM', musicbrainzId: '1ee37742-1e3d-4e61-84d2-bc85f4c1459a', spotifyId: '4SpbR6yFEvexJuaBpgAU5p' }),
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function assertUniqueTargets(bands, mappings = APPROVED_IDENTITIES) {
  const byName = new Map();
  for (const band of bands || []) {
    const key = normalizeName(band?.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(band);
  }
  const targets = [];
  for (const mapping of mappings) {
    const matches = byName.get(normalizeName(mapping.name)) || [];
    if (matches.length !== 1) {
      throw new Error(`Approved identity target must resolve to exactly one band: ${mapping.name}`);
    }
    targets.push({ band: matches[0], mapping });
  }
  return targets;
}

function assertNoProviderConflicts(bands, targets) {
  const targetIds = new Set(targets.map(({ band }) => band.id));
  for (const { band, mapping } of targets) {
    const currentMusicbrainz = band.musicbrainz || {};
    const currentSpotify = currentMusicbrainz.spotify || {};
    if (identities.isConfirmed(currentMusicbrainz, 'musicbrainz') && currentMusicbrainz.mbid !== mapping.musicbrainzId) {
      throw new Error(`Approved MusicBrainz identity conflicts with an existing confirmed identity for ${mapping.name}`);
    }
    if (identities.isConfirmed(currentSpotify, 'spotify') && currentSpotify.id !== mapping.spotifyId) {
      throw new Error(`Approved Spotify identity conflicts with an existing confirmed identity for ${mapping.name}`);
    }
    for (const other of bands || []) {
      if (targetIds.has(other.id)) continue;
      if (identities.isConfirmed(other.musicbrainz, 'musicbrainz') && other.musicbrainz.mbid === mapping.musicbrainzId) {
        throw new Error(`Approved MusicBrainz identity is already confirmed on another band: ${mapping.name}`);
      }
      if (identities.isConfirmed(other.musicbrainz?.spotify, 'spotify') && other.musicbrainz.spotify.id === mapping.spotifyId) {
        throw new Error(`Approved Spotify identity is already confirmed on another band: ${mapping.name}`);
      }
    }
  }
}

function applyApprovedIdentities(bands, mappings = APPROVED_IDENTITIES, options = {}) {
  const rows = Array.isArray(bands) ? bands : [];
  const reviewedAt = options.reviewedAt || new Date().toISOString();
  const targets = assertUniqueTargets(rows, mappings);
  assertNoProviderConflicts(rows, targets);
  const byBandId = new Map(targets.map(({ band, mapping }) => [band.id, mapping]));
  let changed = 0;
  const next = rows.map((band) => {
    const mapping = byBandId.get(band.id);
    if (!mapping) return band;
    const currentMusicbrainz = clone(band.musicbrainz || {});
    const currentSpotify = clone(currentMusicbrainz.spotify || {});
    const musicbrainzAlreadyApproved = currentMusicbrainz.mbid === mapping.musicbrainzId
      && identities.isConfirmed(currentMusicbrainz, 'musicbrainz');
    const spotifyAlreadyApproved = currentSpotify.id === mapping.spotifyId
      && identities.isConfirmed(currentSpotify, 'spotify');
    if (musicbrainzAlreadyApproved && spotifyAlreadyApproved) return band;
    changed += 1;
    return {
      ...band,
      musicbrainz: {
        ...currentMusicbrainz,
        mbid: mapping.musicbrainzId,
        artistName: currentMusicbrainz.artistName || band.name,
        status: 'manual_confirmed',
        matchMethod: 'user_approved_exact_id',
        confidence: 'user_confirmed',
        matchedAt: currentMusicbrainz.matchedAt || reviewedAt,
        reviewedAt,
        reviewedBy: 'user',
        spotify: {
          ...currentSpotify,
          id: mapping.spotifyId,
          url: `https://open.spotify.com/artist/${mapping.spotifyId}`,
          artistName: currentSpotify.artistName || band.name,
          status: 'manual_confirmed',
          matchMethod: 'user_approved_exact_id',
          confidence: 'user_confirmed',
          matchedAt: currentSpotify.matchedAt || reviewedAt,
          reviewedAt,
          reviewedBy: 'user',
        },
      },
    };
  });
  return { bands: next, matched: targets.length, changed };
}

async function runApprovedProviderIdentityUpdate({
  readBands = worker.readJson,
  writeBandsStrict = worker.writeJsonStrict,
  reviewedAt = new Date().toISOString(),
  log = console.log,
} = {}) {
  const current = await readBands('bands.json', []);
  const result = applyApprovedIdentities(current, APPROVED_IDENTITIES, { reviewedAt });
  if (result.changed > 0) await writeBandsStrict('bands.json', result.bands);
  log(`Approved provider identity update: ${result.matched} targets validated; ${result.changed} bands updated.`);
  return { matched: result.matched, changed: result.changed };
}

if (require.main === module) {
  runApprovedProviderIdentityUpdate().catch((error) => {
    console.error('Approved provider identity update failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  APPROVED_IDENTITIES,
  normalizeName,
  assertUniqueTargets,
  assertNoProviderConflicts,
  applyApprovedIdentities,
  runApprovedProviderIdentityUpdate,
};
