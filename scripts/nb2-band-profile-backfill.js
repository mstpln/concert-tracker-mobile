'use strict';

const fs = require('node:fs');

const ALLOWED_PATCH_FIELDS = new Set(['officialUrl', 'genre', 'origin', 'formedYear', 'officialArtwork']);
const TRUSTED_SPOTIFY_STATUSES = new Set(['confirmed', 'manual_confirmed']);
const OFFICIAL_ARTWORK_SOURCE = 'official_site_og_image';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeHttpsUrl(value) {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch (_) {
    return null;
  }
}

function selectTrustedSpotifyImage(band) {
  const spotify = band?.musicbrainz?.spotify;
  if (!spotify?.id || !TRUSTED_SPOTIFY_STATUSES.has(spotify.status) || !Array.isArray(spotify.images) || spotify.images.length === 0) return null;
  const images = [];
  for (const image of spotify.images) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
    const url = safeHttpsUrl(image.url);
    if (!url) return null;
    const width = image.width == null ? null : Number(image.width);
    const height = image.height == null ? null : Number(image.height);
    if ((width != null && (!Number.isFinite(width) || width <= 0)) || (height != null && (!Number.isFinite(height) || height <= 0))) return null;
    images.push({ url, width, height });
  }
  images.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) || a.url.localeCompare(b.url));
  return images[0]?.url || null;
}

function officialArtworkUrl(band) {
  const artwork = band?.artistArtwork?.officialSite;
  const url = safeHttpsUrl(artwork?.url);
  const sourceUrl = safeHttpsUrl(artwork?.sourceUrl);
  const officialUrl = safeHttpsUrl(band?.officialUrl);
  if (!url || !sourceUrl || !officialUrl || artwork?.source !== OFFICIAL_ARTWORK_SOURCE || sourceUrl !== officialUrl) return null;
  return url;
}

function visibleArtistImageUrl(band) {
  return nonEmptyString(band?.photoUrl) || selectTrustedSpotifyImage(band) || officialArtworkUrl(band) || null;
}

function isBlank(value) {
  return value == null || (typeof value === 'string' && !value.trim());
}

function validateBandRows(rows) {
  if (!Array.isArray(rows)) throw new Error('bands input must be a JSON array');
  const ids = new Set();
  for (const band of rows) {
    if (!band || typeof band !== 'object' || Array.isArray(band)) throw new Error('every band must be an object');
    const id = nonEmptyString(band.id);
    if (!id) throw new Error('every band must have a stable id');
    if (ids.has(id)) throw new Error(`duplicate stable band id: ${id}`);
    ids.add(id);
  }
  return ids;
}

function validatePatchEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('every patch entry must be an object');
  const bandId = nonEmptyString(entry.bandId);
  if (!bandId) throw new Error('every patch entry must have bandId');
  for (const key of Object.keys(entry)) {
    if (key === 'bandId') continue;
    if (!ALLOWED_PATCH_FIELDS.has(key)) throw new Error(`unsupported NB2 patch field: ${key}`);
  }
  return bandId;
}

function mergeOfficialArtwork(band, value) {
  if (visibleArtistImageUrl(band)) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`officialArtwork for ${band.id} must be an object`);
  const imageUrl = safeHttpsUrl(value.url);
  if (!imageUrl) throw new Error(`officialArtwork for ${band.id} must use a valid HTTPS image URL`);
  const officialUrl = safeHttpsUrl(band.officialUrl);
  if (!officialUrl) throw new Error(`officialArtwork for ${band.id} requires a valid officialUrl`);
  const sourceUrl = safeHttpsUrl(value.sourceUrl || officialUrl);
  if (sourceUrl !== officialUrl) throw new Error(`officialArtwork sourceUrl for ${band.id} must exactly match officialUrl`);
  band.artistArtwork = {
    ...(band.artistArtwork && typeof band.artistArtwork === 'object' && !Array.isArray(band.artistArtwork) ? band.artistArtwork : {}),
    officialSite: {
      ...(band.artistArtwork?.officialSite && typeof band.artistArtwork.officialSite === 'object' && !Array.isArray(band.artistArtwork.officialSite) ? band.artistArtwork.officialSite : {}),
      url: imageUrl,
      sourceUrl: officialUrl,
      source: OFFICIAL_ARTWORK_SOURCE,
    },
  };
  return true;
}

function applyBackfill(rows, patchEntries) {
  validateBandRows(rows);
  if (!Array.isArray(patchEntries)) throw new Error('patch input must be a JSON array');
  const output = structuredClone(rows);
  const byId = new Map(output.map((band) => [band.id, band]));
  const seenPatchIds = new Set();
  const changes = [];

  for (const entry of patchEntries) {
    const bandId = validatePatchEntry(entry);
    if (seenPatchIds.has(bandId)) throw new Error(`duplicate patch entry for band: ${bandId}`);
    seenPatchIds.add(bandId);
    const band = byId.get(bandId);
    if (!band) throw new Error(`patch references unknown stable band id: ${bandId}`);
    const changedFields = [];

    for (const field of ['officialUrl', 'genre', 'origin', 'formedYear']) {
      if (!(field in entry) || !isBlank(band[field])) continue;
      const value = nonEmptyString(entry[field]);
      if (!value) throw new Error(`${field} for ${bandId} must be a non-empty string`);
      if (field === 'officialUrl' && !safeHttpsUrl(value)) throw new Error(`officialUrl for ${bandId} must be HTTPS`);
      band[field] = field === 'officialUrl' ? safeHttpsUrl(value) : value;
      changedFields.push(field);
    }

    if ('officialArtwork' in entry && mergeOfficialArtwork(band, entry.officialArtwork)) changedFields.push('artistArtwork.officialSite');
    if (changedFields.length) changes.push({ bandId, fields: changedFields });
  }

  validateBandRows(output);
  return { bands: output, changes };
}

function audit(rows) {
  validateBandRows(rows);
  const missing = { visibleImage: 0, officialUrl: 0, formedYear: 0, genre: 0, origin: 0 };
  for (const band of rows) {
    if (!visibleArtistImageUrl(band)) missing.visibleImage += 1;
    if (isBlank(band.officialUrl)) missing.officialUrl += 1;
    if (isBlank(band.formedYear)) missing.formedYear += 1;
    if (isBlank(band.genre)) missing.genre += 1;
    if (isBlank(band.origin)) missing.origin += 1;
  }
  return { totalBands: rows.length, missing };
}

function main(argv = process.argv.slice(2)) {
  const [inputPath, patchPath, outputPath] = argv;
  if (!inputPath || !patchPath || !outputPath) throw new Error('Usage: node scripts/nb2-band-profile-backfill.js <bands.json> <patch.json> <output.json>');
  const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
  const before = audit(rows);
  const result = applyBackfill(rows, patch);
  const after = audit(result.bands);
  fs.writeFileSync(outputPath, `${JSON.stringify(result.bands, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ before, after, changedBands: result.changes.length, changes: result.changes }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { audit, applyBackfill, visibleArtistImageUrl, selectTrustedSpotifyImage, officialArtworkUrl };
