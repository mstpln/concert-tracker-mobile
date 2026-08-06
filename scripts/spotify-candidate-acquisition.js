'use strict';

const crypto = require('node:crypto');
const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const spotifyCandidateSearch = require('./lib/spotifyCandidateSearch');
const identities = require('../providerIdentityState');

const DEFAULT_BAND_CAP = 25;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function metadataForBand(band) {
  const stored = band.musicbrainz?.metadata || {};
  return {
    artistName: stored.artistName || band.musicbrainz?.artistName || band.name,
    aliases: Array.isArray(stored.aliases) ? stored.aliases : [],
    spotify: stored.spotify || null,
  };
}

function candidateAcquisitionEligible(band) {
  if (!identities.trustedMusicbrainzBand(band)) return false;
  const record = band.musicbrainz?.spotify;
  if (identities.isConfirmed(record, 'spotify')) return false;
  if (record?.status === 'manual_rejected') return false;
  return !Array.isArray(record?.reviewCandidates) || record.reviewCandidates.length === 0;
}

function normalizeCandidate(candidate) {
  if (!candidate?.id) return null;
  return {
    id: String(candidate.id),
    artistName: candidate.artistName || candidate.name || null,
    url: candidate.url || candidate.external_urls?.spotify || `https://open.spotify.com/artist/${candidate.id}`,
    genres: Array.isArray(candidate.genres) ? [...candidate.genres] : undefined,
    images: Array.isArray(candidate.images) ? clone(candidate.images) : undefined,
    followers: Number.isFinite(candidate.followers?.total) ? candidate.followers.total : Number.isFinite(candidate.followers) ? candidate.followers : undefined,
    popularity: Number.isFinite(candidate.popularity) ? candidate.popularity : undefined,
  };
}

function candidatesFromResolution(result) {
  const direct = Array.isArray(result?.candidates) ? result.candidates : null;
  const identity = result?.identity;
  const raw = direct || (Array.isArray(identity?.reviewCandidates) && identity.reviewCandidates.length
    ? identity.reviewCandidates
    : identity?.id ? [identity] : []);
  const byId = new Map();
  for (const item of raw) {
    const candidate = normalizeCandidate(item);
    if (!candidate || byId.has(candidate.id)) continue;
    byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function mergeCandidateLists(existing, incoming) {
  const byId = new Map();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const candidate = normalizeCandidate(item);
    if (!candidate) continue;
    byId.set(candidate.id, { ...(byId.get(candidate.id) || {}), ...candidate });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function buildCandidateRecord(prior, candidates, now) {
  const reviewCandidates = mergeCandidateLists(prior?.reviewCandidates, candidates);
  return {
    ...(prior || {}),
    id: null,
    url: null,
    artistName: null,
    status: 'needs_review',
    matchMethod: null,
    confidence: null,
    matchedAt: null,
    lastAttemptedAt: now,
    lastCheckedAt: now,
    nextEligibleCheckAt: null,
    errorCategory: null,
    reviewCandidates,
    candidateAcquisition: {
      ...(prior?.candidateAcquisition || {}),
      source: 'spotify_artist_search',
      method: 'review_only',
      acquiredAt: now,
      candidateSetFingerprint: fingerprint(reviewCandidates),
    },
  };
}

function mergeCandidateUpdates(latestBands, updates) {
  const byId = new Map((updates || []).map((update) => [update.bandId, update]));
  let applied = 0;
  let stale = 0;
  const bands = (latestBands || []).map((band) => {
    const update = byId.get(band.id);
    if (!update || !identities.trustedMusicbrainzBand(band)) return band;
    const current = band.musicbrainz?.spotify;
    if (identities.isConfirmed(current, 'spotify') || current?.status === 'manual_rejected') return band;
    if (fingerprint(current || null) !== update.priorFingerprint) {
      stale += 1;
      return band;
    }
    applied += 1;
    return {
      ...band,
      musicbrainz: {
        ...(band.musicbrainz || {}),
        spotify: buildCandidateRecord(current, update.candidates, update.acquiredAt),
      },
    };
  });
  return { bands, applied, stale };
}

async function runSpotifyCandidateAcquisition({
  readBands = worker.readJson,
  writeBands = worker.writeJson,
  loadUsage = UsageTracker.load,
  searchCandidates = spotifyCandidateSearch.searchArtistCandidates,
  resolveArtistIdentity = null,
  bandCap = DEFAULT_BAND_CAP,
  now = new Date().toISOString(),
  log = console.log,
} = {}) {
  const numericBandCap = Number(bandCap);
  const effectiveBandCap = Math.max(0, Math.min(DEFAULT_BAND_CAP, Number.isFinite(numericBandCap) ? Math.floor(numericBandCap) : DEFAULT_BAND_CAP));
  const usage = await loadUsage();
  const summary = {
    mode: 'spotify-candidate-acquisition',
    bandCap: effectiveBandCap,
    eligible: 0,
    considered: 0,
    candidatesAcquired: 0,
    bandsUpdated: 0,
    staleSkipped: 0,
    noCandidate: 0,
    errors: 0,
  };
  let usageSaved = false;

  async function saveUsage(status, error = null) {
    usageSaved = true;
    usage.finishProviderIdentityRun({ status, error, ...summary });
    await usage.save();
  }

  try {
    const snapshot = await readBands('bands.json', []);
    const eligible = snapshot.filter(candidateAcquisitionEligible);
    summary.eligible = eligible.length;
    const updates = [];

    for (const band of eligible.slice(0, effectiveBandCap)) {
      if (!usage.canCallSpotify()) break;
      summary.considered += 1;
      const prior = clone(band.musicbrainz?.spotify || null);
      const metadata = metadataForBand(band);
      const result = resolveArtistIdentity
        ? await resolveArtistIdentity({ band, metadata, usage, now })
        : await searchCandidates({ band, metadata, usage, now });
      if (result?.kind === 'error' || result?.kind === 'unavailable') summary.errors += 1;
      const candidates = candidatesFromResolution(result);
      if (!candidates.length) {
        summary.noCandidate += 1;
        continue;
      }
      summary.candidatesAcquired += candidates.length;
      updates.push({ bandId: band.id, priorFingerprint: fingerprint(prior), candidates, acquiredAt: now });
    }

    if (updates.length) {
      const latest = await readBands('bands.json', []);
      const merged = mergeCandidateUpdates(latest, updates);
      summary.bandsUpdated = merged.applied;
      summary.staleSkipped = merged.stale;
      if (merged.applied > 0) await writeBands('bands.json', merged.bands);
    }

    await saveUsage('ok');
    log(`Spotify candidate acquisition: ${summary.considered}/${summary.eligible} eligible bands considered; ${summary.candidatesAcquired} candidates acquired; ${summary.bandsUpdated} bands updated; ${summary.staleSkipped} stale rows skipped.`);
    return summary;
  } catch (error) {
    if (!usageSaved) {
      try { await saveUsage('error', error.message); } catch (saveError) { log(`Additionally failed to save Spotify candidate usage: ${saveError.message}`); }
    }
    throw error;
  }
}

if (require.main === module) {
  runSpotifyCandidateAcquisition({ bandCap: process.env.SPOTIFY_CANDIDATE_BAND_CAP }).catch((error) => {
    console.error('Spotify candidate acquisition failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BAND_CAP,
  fingerprint,
  metadataForBand,
  candidateAcquisitionEligible,
  normalizeCandidate,
  candidatesFromResolution,
  mergeCandidateLists,
  buildCandidateRecord,
  mergeCandidateUpdates,
  runSpotifyCandidateAcquisition,
};
