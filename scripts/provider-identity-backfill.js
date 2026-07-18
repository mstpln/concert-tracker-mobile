'use strict';

// Manually dispatched, provider-only identity backfill. It deliberately
// avoids concert/news/setlist work and does not need extra MusicBrainz
// metadata requests: the confirmed identity already stored on the band is
// enough for the existing conservative provider resolvers.
const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const ticketmaster = require('./lib/ticketmaster');
const spotify = require('./lib/spotify');
const identities = require('../providerIdentityState');

function metadataForBand(band) {
  const stored = band.musicbrainz?.metadata || {};
  return {
    artistName: stored.artistName || band.musicbrainz?.artistName || band.name,
    aliases: Array.isArray(stored.aliases) ? stored.aliases : [],
    spotify: stored.spotify || null,
  };
}

function mergeProviderIdentityUpdates(latestBands, updates) {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return (latestBands || []).map((band) => {
    const update = byId.get(band.id);
    if (!update || !identities.trustedMusicbrainzBand(band)) return band;
    const current = band.musicbrainz || {};
    const next = { ...current };
    for (const provider of ['ticketmaster', 'spotify']) {
      const incoming = update[provider];
      const existing = current[provider];
      // A newer human choice or an existing confirmed value is authoritative.
      if (!incoming || ['confirmed', 'manual_confirmed', 'manual_rejected'].includes(existing?.status)) continue;
      next[provider] = incoming;
    }
    return { ...band, musicbrainz: next };
  });
}

function blankSummary() {
  return {
    bandsConsidered: 0,
    ticketmaster: { confirmed: 0, noMatch: 0, needsReview: 0, errors: 0, unavailable: 0, alreadyConfirmed: 0, manuallyProtected: 0, skippedRetryWindow: 0, retryDatesAssigned: 0 },
    spotify: { confirmed: 0, noMatch: 0, needsReview: 0, errors: 0, unavailable: 0, alreadyConfirmed: 0, manuallyProtected: 0, skippedRetryWindow: 0, retryDatesAssigned: 0 },
    duplicateConflicts: 0,
    updates: 0,
  };
}

function recordResult(summary, provider, result) {
  const bucket = summary[provider];
  const status = result?.identity?.status;
  if (result?.kind === 'reused') { bucket.alreadyConfirmed += 1; return; }
  if (result?.kind === 'skipped') return;
  if (status === 'confirmed') bucket.confirmed += 1;
  else if (status === 'no_match') bucket.noMatch += 1;
  else if (status === 'needs_review') bucket.needsReview += 1;
  else if (status === 'error') bucket.errors += 1;
  else if (status === 'unavailable') bucket.unavailable += 1;
  if (result?.identity?.nextEligibleCheckAt && Date.parse(result.identity.nextEligibleCheckAt) > Date.parse(result.identity.lastAttemptedAt || 0)) bucket.retryDatesAssigned += 1;
}

async function runProviderIdentityBackfill({
  readBands = worker.readJson,
  writeBands = worker.writeJson,
  loadUsage = UsageTracker.load,
  resolveTicketmaster = ticketmaster.resolveAttractionIdentity,
  resolveSpotify = spotify.resolveArtistIdentity,
  now = new Date().toISOString(),
  log = console.log,
} = {}) {
  let usage;
  let usageSaveAttempted = false;
  const summary = blankSummary();
  const saveUsage = async (status, error = null) => {
    usageSaveAttempted = true;
    usage.finishProviderIdentityRun({ status, error, ...summary });
    await usage.save();
  };
  try {
    usage = await loadUsage();
    const bands = await readBands('bands.json', []);
    const updates = [];
    for (const band of bands) {
      if (!identities.trustedMusicbrainzBand(band)) continue;
      for (const provider of ['ticketmaster', 'spotify']) {
        const record = band.musicbrainz?.[provider];
        const bucket = summary[provider];
        if (identities.isConfirmed(record, provider)) bucket.alreadyConfirmed += 1;
        else if (record?.status === 'manual_rejected') bucket.manuallyProtected += 1;
        else if (identities.retryInfo(record, new Date(now)).retryScheduled) bucket.skippedRetryWindow += 1;
      }
      const ticketmasterEligible = identities.providerBackfillEligible(band, 'ticketmaster', new Date(now));
      const spotifyEligible = identities.providerBackfillEligible(band, 'spotify', new Date(now));
      if (!ticketmasterEligible && !spotifyEligible) continue;
      summary.bandsConsidered += 1;
      const metadata = metadataForBand(band);
      const update = { id: band.id };
      if (ticketmasterEligible) {
        const result = await resolveTicketmaster({ band, metadata, usage, now });
        recordResult(summary, 'ticketmaster', result);
        if (result.identity) update.ticketmaster = result.identity;
      }
      if (spotifyEligible) {
        const result = await resolveSpotify({ band, metadata, usage, now });
        recordResult(summary, 'spotify', result);
        if (result.identity) update.spotify = result.identity;
      }
      if (update.ticketmaster || update.spotify) updates.push(update);
    }
    if (updates.length) {
      const latest = await readBands('bands.json', []);
      const merged = mergeProviderIdentityUpdates(latest, updates);
      if (JSON.stringify(latest) !== JSON.stringify(merged)) await writeBands('bands.json', merged);
      summary.updates = updates.length;
      const coverage = identities.identityCoverage(merged, new Date(now));
      summary.duplicateConflicts = coverage.musicbrainz.duplicateConflicts.length + coverage.ticketmaster.duplicateConflicts.length + coverage.spotify.duplicateConflicts.length;
    } else {
      const coverage = identities.identityCoverage(bands, new Date(now));
      summary.duplicateConflicts = coverage.musicbrainz.duplicateConflicts.length + coverage.ticketmaster.duplicateConflicts.length + coverage.spotify.duplicateConflicts.length;
    }
    await saveUsage('ok');
    log(`Provider identity backfill: ${summary.bandsConsidered} bands considered; Ticketmaster ${summary.ticketmaster.confirmed} confirmed, ${summary.ticketmaster.noMatch} no match, ${summary.ticketmaster.needsReview} need review; Spotify ${summary.spotify.confirmed} confirmed, ${summary.spotify.noMatch} no match, ${summary.spotify.needsReview} need review, ${summary.spotify.unavailable} unavailable; ${summary.ticketmaster.skippedRetryWindow + summary.spotify.skippedRetryWindow} records have future retry dates; ${summary.duplicateConflicts} duplicate conflict(s).`);
    return summary;
  } catch (error) {
    if (usage && !usageSaveAttempted) {
      try { await saveUsage('error', error.message); }
      catch (saveError) { log(`Additionally failed to save provider identity usage: ${saveError.message}`); }
    }
    throw error;
  }
}

if (require.main === module) {
  runProviderIdentityBackfill().catch((error) => {
    console.error('Provider identity backfill failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { metadataForBand, mergeProviderIdentityUpdates, runProviderIdentityBackfill };
