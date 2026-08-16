'use strict';

const providerState = require('../../providerIdentityState');
const activity = require('../../listeningBandActivity');

const PER_RUN_CAP = 10;
const MAX_AGGREGATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_ORDER = Object.freeze(['fourteenDays', 'threeMonths', 'oneYear', 'allTime', 'noHistory']);

function trustedSpotifyId(band) {
  return providerState.artistEnrichment.trustedSpotifyIdentity(band)?.id || null;
}

function hasUsableArtistImage(band) {
  return Boolean(providerState.artistEnrichment.visibleArtistImageUrl(band));
}

function maintenanceDue(record, identityId, now) {
  if (!record || record.identityId !== identityId) return true;
  if (record.status === 'no_image') return false;
  const next = Date.parse(record.nextEligibleCheckAt);
  return !Number.isFinite(next) || next <= now.getTime();
}

function bandActivity(record) {
  for (const bucket of BUCKET_ORDER.slice(0, -1)) {
    const row = record?.buckets?.[bucket];
    if (row?.listenCount > 0) return { bucket, listenCount: row.listenCount, lastListenedAt: row.lastListenedAt };
  }
  return { bucket: 'noHistory', listenCount: 0, lastListenedAt: null };
}

function validatePlanningAggregate(aggregate, bands, now) {
  if (!activity.validateAggregate(aggregate, { bands })) return { valid: false, reason: 'invalid_or_catalogue_mismatch' };
  const generated = Date.parse(aggregate.generatedAt);
  if (!Number.isFinite(generated) || generated > now.getTime() + 5 * 60 * 1000 || now.getTime() - generated > MAX_AGGREGATE_AGE_MS) return { valid: false, reason: 'stale_or_future' };
  return { valid: true };
}

function planArtistImageMaintenance(bands, aggregate, { now = new Date(), cap = PER_RUN_CAP } = {}) {
  const aggregateState = validatePlanningAggregate(aggregate, bands, now);
  if (!aggregateState.valid) return { enabled: false, reason: aggregateState.reason, items: [], eligible: 0 };
  const duplicates = providerState.duplicateBandIds(bands, 'spotify');
  const items = [];
  for (const band of bands || []) {
    if (!band?.id || hasUsableArtistImage(band) || duplicates.has(band.id)) continue;
    const spotifyId = trustedSpotifyId(band);
    if (!spotifyId && !providerState.providerBackfillEligible(band, 'spotify', now)) continue;
    const maintenance = band.musicbrainz?.spotify?.artistImageMaintenance;
    if (spotifyId && !maintenanceDue(maintenance, spotifyId, now)) continue;
    const priority = bandActivity(aggregate.records[band.id]);
    items.push({ bandId: band.id, spotifyId, identityFirst: !spotifyId, ...priority });
  }
  items.sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)
    || Number(a.identityFirst) - Number(b.identityFirst)
    || b.listenCount - a.listenCount
    || String(b.lastListenedAt || '').localeCompare(String(a.lastListenedAt || ''))
    || String(a.bandId).localeCompare(String(b.bandId)));
  return { enabled: true, items: items.slice(0, Math.max(0, Math.min(PER_RUN_CAP, cap))), eligible: items.length };
}

function validatedImages(images) {
  if (!Array.isArray(images)) return null;
  const normalized = [];
  for (const image of images) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
    let url;
    try { url = new URL(String(image.url || '')); } catch { return null; }
    const width = image.width == null ? null : Number(image.width);
    const height = image.height == null ? null : Number(image.height);
    if (url.protocol !== 'https:' || (width != null && (!Number.isFinite(width) || width <= 0)) || (height != null && (!Number.isFinite(height) || height <= 0))) return null;
    normalized.push({ url: url.href, width, height });
  }
  return normalized;
}

function attemptState(identityId, result, now) {
  const common = { identityId, checkedAt: now.toISOString() };
  if (result.kind === 'ok') {
    const images = validatedImages(result.artist?.images);
    if (images === null) return { ...common, status: 'error', reason: 'invalid_images', nextEligibleCheckAt: new Date(now.getTime() + RETRY_DELAY_MS).toISOString() };
    if (images.length === 0) return { ...common, status: 'no_image', reason: 'spotify_returned_no_images', nextEligibleCheckAt: null };
    return { ...common, status: 'complete', reason: null, nextEligibleCheckAt: null };
  }
  const reason = result.error || (result.status ? `http_${result.status}` : result.kind || 'request_failed');
  return { ...common, status: result.kind === 'skipped' ? 'deferred' : 'error', reason, nextEligibleCheckAt: new Date(now.getTime() + RETRY_DELAY_MS).toISOString() };
}

function sameUntrustedIdentity(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function mergeMaintenanceUpdates(latestBands, plannedBands, updates) {
  const plannedById = new Map((plannedBands || []).map((band) => [band.id, band]));
  const updateById = new Map((updates || []).map((update) => [update.bandId, update]));
  return (latestBands || []).map((band) => {
    const update = updateById.get(band.id);
    const planned = plannedById.get(band.id);
    if (!update || !planned || hasUsableArtistImage(band)) return band;
    const latestIdentity = band.musicbrainz?.spotify;
    const latestTrustedId = trustedSpotifyId(band);
    if (update.expectedSpotifyId) {
      if (latestTrustedId !== update.expectedSpotifyId) return band;
    } else if (latestTrustedId) {
      if (latestTrustedId !== update.identity?.id) return band;
    } else if (!sameUntrustedIdentity(planned.musicbrainz?.spotify, latestIdentity)) return band;
    if (latestIdentity?.status === 'manual_rejected') return band;
    const identity = update.identity && latestIdentity?.status !== 'manual_confirmed'
      ? { ...latestIdentity, ...update.identity }
      : { ...latestIdentity };
    if (update.images) identity.images = update.images;
    if (update.maintenance) identity.artistImageMaintenance = update.maintenance;
    return { ...band, musicbrainz: { ...band.musicbrainz, spotify: identity } };
  });
}

async function runArtistImageMaintenance({
  plan, plannedBands, bands = plannedBands, usage, now = new Date(), spotify, worker,
  resolveIdentity = spotify.resolveArtistIdentity, getArtist = spotify.getArtistExact, log = console.log,
} = {}) {
  if (!plan?.enabled || !plan.items?.length) return { enabled: Boolean(plan?.enabled), planned: plan?.items?.length || 0, updated: 0, calls: 0, reason: plan?.reason || null };
  const bandById = new Map((bands || []).map((band) => [band.id, band]));
  const updates = [];
  let calls = 0;
  for (const item of plan.items) {
    const band = bandById.get(item.bandId);
    if (!band || hasUsableArtistImage(band)) continue;
    let identity = providerState.artistEnrichment.trustedSpotifyIdentity(band);
    if (!identity) {
      const resolved = await resolveIdentity({ band, metadata: band.musicbrainz?.metadata || null, usage, now: now.toISOString() });
      identity = ['confirmed', 'manual_confirmed'].includes(resolved?.identity?.status) && resolved.identity.id ? { ...resolved.identity, images: [] } : null;
      if (resolved?.identity) updates.push({ bandId: band.id, expectedSpotifyId: null, identity: identity || resolved.identity });
      if (!identity) continue;
    }
    const callsBefore = Number(usage?.state?.spotify?.callsThisRun || 0);
    const providerResult = await getArtist(identity.id, usage);
    const result = providerResult?.kind === 'ok' && providerResult.artist?.id !== identity.id
      ? { kind: 'error', error: 'artist_id_mismatch' }
      : (providerResult || { kind: 'error', error: 'invalid_provider_outcome' });
    calls += Math.max(0, Number(usage?.state?.spotify?.callsThisRun || 0) - callsBefore);
    const maintenance = attemptState(identity.id, result, now);
    const images = result.kind === 'ok' ? validatedImages(result.artist?.images) : null;
    const current = updates.find((update) => update.bandId === band.id);
    const patch = { bandId: band.id, expectedSpotifyId: item.spotifyId || null, identity: current?.identity || null, maintenance };
    if (images !== null) patch.images = images;
    if (current) Object.assign(current, patch); else updates.push(patch);
    if (['quota_exceeded'].includes(result.kind) || result.status === 429 || result.kind === 'skipped') break;
  }
  if (!updates.length) return { enabled: true, planned: plan.items.length, updated: 0, calls };
  const latest = await worker.readJson('bands.json', []);
  const merged = mergeMaintenanceUpdates(latest, plannedBands, updates);
  const updated = merged.reduce((count, band, index) => count + Number(JSON.stringify(band) !== JSON.stringify(latest[index])), 0);
  if (updated) await worker.writeJsonStrict('bands.json', merged);
  log(`Artist image maintenance: ${plan.items.length}/${plan.eligible} planned, ${updated} band record(s) updated, ${calls} Spotify call(s).`);
  return { enabled: true, planned: plan.items.length, updated, calls };
}

module.exports = {
  PATH: activity.PATH, PER_RUN_CAP, MAX_AGGREGATE_AGE_MS, RETRY_DELAY_MS, BUCKET_ORDER,
  trustedSpotifyId, hasUsableArtistImage, maintenanceDue, bandActivity, validatePlanningAggregate,
  planArtistImageMaintenance, validatedImages, attemptState, mergeMaintenanceUpdates, runArtistImageMaintenance,
};
