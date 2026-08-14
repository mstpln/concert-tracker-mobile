'use strict';

// Shared, dependency-free provider identity helpers. The browser uses the
// global and Node tests/backfill scripts use module.exports, so coverage and
// conflict rules cannot drift apart.
(function (root) {
  const TRUSTED_MUSICBRAINZ_STATUSES = new Set(['confirmed', 'manual_confirmed', 'auto_confirmed']);
  const TRUSTED_PROVIDER_STATUSES = new Set(['confirmed', 'manual_confirmed']);
  const PROVIDERS = ['musicbrainz', 'ticketmaster', 'spotify'];
  const ARTIST_ENRICHMENT_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
  const ARTIST_ENRICHMENT_DECORATED = Symbol('gau3-artist-enrichment-decorated');
  const OFFICIAL_ARTWORK_SOURCE = 'official_site_og_image';

  function providerRecord(band, provider) {
    return provider === 'musicbrainz' ? band?.musicbrainz : band?.musicbrainz?.[provider];
  }

  function isConfirmed(record, provider = 'ticketmaster') {
    if (!record?.id && !(provider === 'musicbrainz' && record?.mbid)) return false;
    const id = provider === 'musicbrainz' ? record.mbid : record.id;
    const allowed = provider === 'musicbrainz' ? TRUSTED_MUSICBRAINZ_STATUSES : TRUSTED_PROVIDER_STATUSES;
    return Boolean(id && allowed.has(record.status));
  }

  function providerId(record, provider) {
    return provider === 'musicbrainz' ? record?.mbid || null : record?.id || null;
  }

  function duplicateAssignments(bands, provider) {
    const byId = new Map();
    for (const band of bands || []) {
      const record = providerRecord(band, provider);
      if (!isConfirmed(record, provider)) continue;
      const id = providerId(record, provider);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(band.id);
    }
    return [...byId.entries()].filter(([, bandIds]) => bandIds.length > 1)
      .map(([id, bandIds]) => ({ provider, id, bandIds: [...bandIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function duplicateBandIds(bands, provider) {
    return new Set(duplicateAssignments(bands, provider).flatMap((conflict) => conflict.bandIds));
  }

  function retryInfo(record, now = new Date()) {
    const value = record?.nextEligibleCheckAt || null;
    const timestamp = value ? Date.parse(value) : NaN;
    return {
      nextEligibleCheckAt: Number.isFinite(timestamp) ? value : null,
      retryScheduled: Number.isFinite(timestamp) && timestamp > now.getTime(),
      retryEligibleNow: !Number.isFinite(timestamp) || timestamp <= now.getTime(),
    };
  }

  function providerRetrySummary(records, now = new Date()) {
    const futureRetries = [];
    let eligibleNow = false;
    for (const { provider, record } of records || []) {
      if (!record || isConfirmed(record, provider) || ['confirmed', 'manual_confirmed', 'manual_rejected'].includes(record.status)) continue;
      const retry = retryInfo(record, now);
      if (retry.retryScheduled) futureRetries.push(retry.nextEligibleCheckAt);
      else if (retry.nextEligibleCheckAt && ['unresolved', 'needs_review', 'no_match', 'error', 'unavailable'].includes(record.status)) eligibleNow = true;
    }
    futureRetries.sort();
    return { nextRetryAt: futureRetries[0] || null, eligibleNow };
  }

  function statusForRecord(record, provider, isDuplicate, now = new Date()) {
    if (isDuplicate) return 'duplicate_conflict';
    if (isConfirmed(record, provider)) return 'confirmed';
    if (!record?.status) return 'unchecked';
    if (record.status === 'unresolved') return 'needs_review';
    return record.status;
  }

  function providerCoverage(bands, provider, now = new Date()) {
    const rows = bands || [];
    const duplicateIds = duplicateBandIds(rows, provider);
    const counts = { confirmed: 0, needs_review: 0, no_match: 0, error: 0, unavailable: 0, manual_rejected: 0, unchecked: 0, duplicate_conflict: 0 };
    const issues = [];
    let retryScheduledCount = 0;
    for (const band of rows) {
      const record = providerRecord(band, provider);
      const status = statusForRecord(record, provider, duplicateIds.has(band.id), now);
      const retry = retryInfo(record, now);
      if (!(status in counts)) counts[status] = 0;
      counts[status] += 1;
      if (retry.retryScheduled) retryScheduledCount += 1;
      if (status !== 'confirmed') issues.push({
        bandId: band.id,
        bandName: band.name || band.id,
        provider,
        status,
        candidateName: record?.artistName || record?.attractionName || null,
        errorCategory: record?.errorCategory || null,
        nextEligibleCheckAt: retry.nextEligibleCheckAt,
        retryScheduled: retry.retryScheduled,
        retryEligibleNow: retry.retryEligibleNow,
        reviewCandidates: Array.isArray(record?.reviewCandidates) ? record.reviewCandidates.slice(0, 5) : [],
      });
    }
    return {
      provider,
      total: rows.length,
      confirmed: counts.confirmed,
      healthyConfirmed: counts.confirmed,
      coveragePercent: rows.length ? Math.round((counts.confirmed / rows.length) * 100) : 0,
      issueCount: rows.length - counts.confirmed,
      counts,
      retryScheduledCount,
      duplicateConflicts: duplicateAssignments(rows, provider),
      issues,
    };
  }

  function identityCoverage(bands, now = new Date()) {
    const musicbrainz = providerCoverage(bands, 'musicbrainz', now);
    const ticketmaster = providerCoverage(bands, 'ticketmaster', now);
    const spotify = providerCoverage(bands, 'spotify', now);
    return { total: (bands || []).length, musicbrainz, setlistfm: { ...musicbrainz, provider: 'setlistfm', linkedThroughMusicbrainz: true }, ticketmaster, spotify };
  }

  function trustedMusicbrainzBand(band) { return isConfirmed(providerRecord(band, 'musicbrainz'), 'musicbrainz'); }
  function providerBackfillEligible(band, provider, now = new Date()) {
    if (!trustedMusicbrainzBand(band)) return false;
    const record = providerRecord(band, provider);
    if (isConfirmed(record, provider) || record?.status === 'manual_rejected') return false;
    return retryInfo(record, now).retryEligibleNow;
  }

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

  function safeHttpsImageUrl(value) {
    return safeHttpsUrl(value);
  }

  function trustedSpotifyIdentity(band) {
    const record = providerRecord(band, 'spotify');
    return isConfirmed(record, 'spotify') ? record : null;
  }

  function selectSpotifyArtistImage(record) {
    if (!record || !Array.isArray(record.images) || record.images.length === 0) return null;
    const normalized = [];
    for (const image of record.images) {
      if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
      const url = safeHttpsImageUrl(image.url);
      if (!url) return null;
      const width = image.width == null ? null : Number(image.width);
      const height = image.height == null ? null : Number(image.height);
      if ((width != null && (!Number.isFinite(width) || width <= 0)) || (height != null && (!Number.isFinite(height) || height <= 0))) return null;
      normalized.push({ url, width, height });
    }
    normalized.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) || a.url.localeCompare(b.url));
    return normalized[0]?.url || null;
  }

  function rawOwnedField(band, field, shadowField) {
    if (!band || typeof band !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(band, field);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) return nonEmptyString(descriptor.value);
    return nonEmptyString(band[shadowField]);
  }

  function rawPhotoUrl(band) { return rawOwnedField(band, 'photoUrl', '__gau3RawPhotoUrl'); }
  function rawBio(band) { return rawOwnedField(band, 'bio', '__gau3RawBio'); }

  function officialArtworkUrl(band) {
    const artwork = band?.artistArtwork?.officialSite;
    const url = safeHttpsImageUrl(artwork?.url);
    const sourceUrl = safeHttpsUrl(artwork?.sourceUrl);
    const officialUrl = safeHttpsUrl(band?.officialUrl);
    if (!url || artwork?.source !== OFFICIAL_ARTWORK_SOURCE || !sourceUrl || !officialUrl || sourceUrl !== officialUrl) return null;
    return url;
  }

  function officialArtworkNeedsRefresh(band) {
    const artwork = band?.artistArtwork?.officialSite;
    const rawUrl = nonEmptyString(artwork?.url);
    const officialUrl = safeHttpsUrl(band?.officialUrl);
    if (!rawUrl || !officialUrl) return false;
    const sourceUrl = safeHttpsUrl(artwork?.sourceUrl);
    const url = safeHttpsImageUrl(rawUrl);
    return !url || artwork?.source !== OFFICIAL_ARTWORK_SOURCE || !sourceUrl || sourceUrl !== officialUrl;
  }

  function trustedSpotifyArtworkUrl(band) {
    const identity = trustedSpotifyIdentity(band);
    return identity ? selectSpotifyArtistImage(identity) : null;
  }

  function visibleArtistImageUrl(band) {
    return rawPhotoUrl(band) || trustedSpotifyArtworkUrl(band) || officialArtworkUrl(band) || null;
  }

  function visibleBio(band) {
    return rawBio(band) || nonEmptyString(band?.generatedBio) || null;
  }

  function replaceWithOwnedField(band, field, value) {
    Object.defineProperty(band, field, {
      value: nonEmptyString(value),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  function persistentBandSnapshot(band) {
    const output = {};
    for (const key of Object.keys(band || {})) {
      if (key === '_enriching') continue;
      output[key] = band[key];
    }
    const photoDescriptor = Object.getOwnPropertyDescriptor(band || {}, 'photoUrl');
    const bioDescriptor = Object.getOwnPropertyDescriptor(band || {}, 'bio');
    if (photoDescriptor?.get) {
      if (band.__gau3RawPhotoPresent) output.photoUrl = band.__gau3RawPhotoValue;
      else delete output.photoUrl;
    }
    if (bioDescriptor?.get) {
      if (band.__gau3RawBioPresent) output.bio = band.__gau3RawBioValue;
      else delete output.bio;
    }
    return output;
  }

  function persistentBandsSnapshot(rows) {
    return (rows || []).map(persistentBandSnapshot);
  }

  function decorateBandForArtistEnrichment(band) {
    if (!band || typeof band !== 'object' || band[ARTIST_ENRICHMENT_DECORATED]) return band;
    const photoPresent = Object.prototype.hasOwnProperty.call(band, 'photoUrl');
    const bioPresent = Object.prototype.hasOwnProperty.call(band, 'bio');
    const rawPhotoValue = photoPresent ? band.photoUrl : undefined;
    const rawBioValue = bioPresent ? band.bio : undefined;
    const startingPhoto = nonEmptyString(rawPhotoValue);
    const startingBio = nonEmptyString(rawBioValue);
    Object.defineProperty(band, '__gau3RawPhotoUrl', { value: startingPhoto, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(band, '__gau3RawBio', { value: startingBio, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(band, '__gau3RawPhotoPresent', { value: photoPresent, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(band, '__gau3RawBioPresent', { value: bioPresent, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(band, '__gau3RawPhotoValue', { value: rawPhotoValue, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(band, '__gau3RawBioValue', { value: rawBioValue, writable: true, configurable: true, enumerable: false });
    if (!startingPhoto) {
      try { delete band.photoUrl; } catch (_) {}
      Object.defineProperty(band, 'photoUrl', {
        configurable: true,
        enumerable: false,
        get() { return visibleArtistImageUrl(band); },
        set(value) {
          band.__gau3RawPhotoPresent = true;
          band.__gau3RawPhotoValue = value;
          band.__gau3RawPhotoUrl = nonEmptyString(value);
          replaceWithOwnedField(band, 'photoUrl', value);
        },
      });
    }
    if (!startingBio) {
      try { delete band.bio; } catch (_) {}
      Object.defineProperty(band, 'bio', {
        configurable: true,
        enumerable: false,
        get() { return visibleBio(band); },
        set(value) {
          band.__gau3RawBioPresent = true;
          band.__gau3RawBioValue = value;
          band.__gau3RawBio = nonEmptyString(value);
          replaceWithOwnedField(band, 'bio', value);
        },
      });
    }
    Object.defineProperty(band, 'toJSON', { value() { return persistentBandSnapshot(band); }, configurable: true, enumerable: false });
    Object.defineProperty(band, ARTIST_ENRICHMENT_DECORATED, { value: true, enumerable: false });
    return band;
  }

  function decorateBandsForArtistEnrichment(rows) {
    for (const band of rows || []) decorateBandForArtistEnrichment(band);
    return rows;
  }

  function mergeOfficialArtwork(band, imageUrl, sourceUrl, now) {
    const url = safeHttpsImageUrl(imageUrl);
    const nextSource = safeHttpsUrl(sourceUrl);
    if (!url || !nextSource) return false;
    const current = band.artistArtwork && typeof band.artistArtwork === 'object' ? band.artistArtwork : {};
    const currentUrl = safeHttpsImageUrl(current.officialSite?.url);
    const currentSource = safeHttpsUrl(current.officialSite?.sourceUrl);
    const currentTrusted = currentUrl && current.officialSite?.source === OFFICIAL_ARTWORK_SOURCE && currentSource === nextSource;
    if (currentTrusted) return false;
    band.artistArtwork = {
      ...current,
      officialSite: {
        ...(current.officialSite || {}),
        url,
        sourceUrl: nextSource,
        source: OFFICIAL_ARTWORK_SOURCE,
        updatedAt: now,
      },
    };
    return true;
  }

  function applyGeneratedEnrichment(band, ai, now) {
    if (!band || !ai || typeof ai !== 'object') return false;
    let changed = false;
    for (const [field, value] of [['genre', nonEmptyString(ai.genre)], ['origin', nonEmptyString(ai.origin)], ['formedYear', nonEmptyString(ai.formedYear)]]) {
      if ((band[field] == null || band[field] === '') && value != null) {
        band[field] = value;
        changed = true;
      }
    }
    const generated = nonEmptyString(ai.bio);
    if (generated && !rawBio(band) && !nonEmptyString(band.generatedBio)) {
      band.generatedBio = generated;
      band.generatedBioProvenance = {
        ...(band.generatedBioProvenance || {}),
        owner: 'generated',
        source: 'artist_enrichment',
        updatedAt: now,
      };
      changed = true;
    }
    return changed;
  }

  function applyHomepageEnrichment(band, homepage, now) {
    if (!band || !homepage || typeof homepage !== 'object') return false;
    let changed = mergeOfficialArtwork(band, homepage.image, band.officialUrl, now);
    const current = band.socials && typeof band.socials === 'object' ? band.socials : {};
    const next = { ...current };
    for (const [key, value] of [['instagram', homepage.instagram], ['spotify', homepage.spotify]]) {
      if (!next[key] && nonEmptyString(value)) {
        next[key] = value;
        changed = true;
      }
    }
    if (changed || band.socials) band.socials = next;
    return changed;
  }

  function enrichmentSourceHasUsableResult(source, value) {
    if (source === 'wikipedia') return Boolean(nonEmptyString(value));
    if (source === 'official_site') {
      return Boolean(value && typeof value === 'object' && !Array.isArray(value) && [value.image, value.instagram, value.spotify].some(nonEmptyString));
    }
    return value != null;
  }

  function noteEnrichmentSourceResult(failures, source, value) {
    if (!Array.isArray(failures) || enrichmentSourceHasUsableResult(source, value)) return false;
    if (!failures.includes(source)) failures.push(source);
    return true;
  }

  function nextArtistEnrichmentState(prior, { failures = [], now = new Date().toISOString() } = {}) {
    const failureList = [...new Set((failures || []).map(nonEmptyString).filter(Boolean))];
    if (failureList.length) {
      const parsed = Date.parse(now);
      return {
        ...(prior || {}),
        status: 'retryable',
        lastAttemptedAt: now,
        nextEligibleCheckAt: new Date((Number.isFinite(parsed) ? parsed : Date.now()) + ARTIST_ENRICHMENT_RETRY_DELAY_MS).toISOString(),
        errorCategory: failureList.join(','),
      };
    }
    return {
      ...(prior || {}),
      status: 'complete',
      lastAttemptedAt: now,
      lastSuccessfulAt: now,
      nextEligibleCheckAt: null,
      errorCategory: null,
    };
  }

  function artistEnrichmentRetryDue(band, now = new Date()) {
    const state = band?.artistEnrichment;
    const eligible = Date.parse(state?.nextEligibleCheckAt || '');
    if (officialArtworkNeedsRefresh(band)) {
      if (state?.status !== 'retryable') return true;
      return !Number.isFinite(eligible) || eligible <= now.getTime();
    }
    if (state?.status !== 'retryable') return false;
    return !Number.isFinite(eligible) || eligible <= now.getTime();
  }

  function artistEnrichmentDueSortKey(band) {
    const state = band?.artistEnrichment;
    const eligible = Date.parse(state?.nextEligibleCheckAt || '');
    if (Number.isFinite(eligible)) return eligible;
    const attempted = Date.parse(state?.lastAttemptedAt || '');
    return Number.isFinite(attempted) ? attempted : 0;
  }

  function nextArtistEnrichmentRetryBand(rows, now = new Date()) {
    return (rows || [])
      .filter((band) => !band?._enriching && artistEnrichmentRetryDue(band, now))
      .sort((a, b) => artistEnrichmentDueSortKey(a) - artistEnrichmentDueSortKey(b) || String(a?.id || '').localeCompare(String(b?.id || '')))[0] || null;
  }

  function installArtistEnrichmentBrowserIntegration() {
    if (!root?.document || root.__gau3ArtistEnrichmentInstalled) return;
    root.__gau3ArtistEnrichmentInstalled = true;
    const session = { retryStarted: false, retryTimer: null };
    const originalRenderProfile = typeof renderProfileScreen === 'function' ? renderProfileScreen : null;
    const originalRenderBands = typeof renderMyBandsScreen === 'function' ? renderMyBandsScreen : null;
    const originalRenderConcerts = typeof renderMyConcertsScreen === 'function' ? renderMyConcertsScreen : null;

    function currentBands() {
      try { return Array.isArray(bands) ? bands : []; } catch (_) { return []; }
    }

    function scheduleRetry() {
      if (session.retryStarted || session.retryTimer) return;
      session.retryTimer = root.setTimeout(() => {
        session.retryTimer = null;
        const due = nextArtistEnrichmentRetryBand(currentBands());
        if (!due) return;
        session.retryStarted = true;
        Promise.resolve(enrichBand(due.id)).catch(() => {});
      }, 750);
    }

    if (originalRenderProfile) {
      renderProfileScreen = function gau3RenderProfile(...args) {
        decorateBandsForArtistEnrichment(currentBands());
        const result = originalRenderProfile.apply(this, args);
        scheduleRetry();
        return result;
      };
    }
    if (originalRenderBands) {
      renderMyBandsScreen = function gau3RenderBands(...args) {
        decorateBandsForArtistEnrichment(currentBands());
        const result = originalRenderBands.apply(this, args);
        scheduleRetry();
        return result;
      };
    }
    if (originalRenderConcerts) {
      renderMyConcertsScreen = function gau3RenderConcerts(...args) {
        decorateBandsForArtistEnrichment(currentBands());
        const result = originalRenderConcerts.apply(this, args);
        scheduleRetry();
        return result;
      };
    }

    enrichBand = async function gau3EnrichBand(bandId) {
      const rows = currentBands();
      const band = rows.find((item) => item?.id === bandId);
      if (!band) return;
      decorateBandForArtistEnrichment(band);
      const attemptedAt = new Date().toISOString();
      const failures = [];
      band._enriching = true;
      band.artistEnrichment = {
        ...(band.artistEnrichment || {}),
        status: 'running',
        lastAttemptedAt: attemptedAt,
        nextEligibleCheckAt: null,
        errorCategory: null,
      };

      let homepage = null;
      if (nonEmptyString(band.officialUrl)) {
        try {
          homepage = await fetchHomepageInfo(band.officialUrl);
          noteEnrichmentSourceResult(failures, 'official_site', homepage);
        } catch (_) { failures.push('official_site'); }
      }

      let wikiText = null;
      try {
        wikiText = await fetchWikipediaText(band.name);
        noteEnrichmentSourceResult(failures, 'wikipedia', wikiText);
      } catch (_) { failures.push('wikipedia'); }

      let groqApiKey = '';
      try {
        const stored = await chrome.storage.local.get('groqApiKey');
        groqApiKey = stored?.groqApiKey || '';
      } catch (_) {}

      let ai = null;
      try {
        const prompt = buildEnrichPrompt(band.name, homepage, wikiText);
        ai = groqApiKey ? await callGroq(prompt, groqApiKey) : await callPollinations(prompt);
      } catch (_) {
        failures.push(groqApiKey ? 'groq' : 'pollinations');
      }

      applyGeneratedEnrichment(band, ai, attemptedAt);
      applyHomepageEnrichment(band, homepage, attemptedAt);
      band.artistEnrichment = nextArtistEnrichmentState(band.artistEnrichment, { failures, now: attemptedAt });
      if (band.artistEnrichment.status === 'complete') band.enrichedAt = attemptedAt;
      band._enriching = false;

      try {
        await dlWriteJsonFile(remote, 'bands.json', persistentBandsSnapshot(rows));
      } catch (error) {
        band.artistEnrichment = nextArtistEnrichmentState(band.artistEnrichment, { failures: ['storage_write'], now: new Date().toISOString() });
        throw error;
      } finally {
        if (currentScreen === 'profile' && activeProfileBandId === bandId && originalRenderProfile) originalRenderProfile(bandId);
        if (currentScreen === 'main' && currentTab === 'mybands' && originalRenderBands) originalRenderBands();
      }
    };

    decorateBandsForArtistEnrichment(currentBands());
    scheduleRetry();
  }

  const artistEnrichment = {
    RETRY_DELAY_MS: ARTIST_ENRICHMENT_RETRY_DELAY_MS,
    nonEmptyString,
    safeHttpsImageUrl,
    trustedSpotifyIdentity,
    selectSpotifyArtistImage,
    trustedSpotifyArtworkUrl,
    officialArtworkUrl,
    officialArtworkNeedsRefresh,
    visibleArtistImageUrl,
    visibleBio,
    rawPhotoUrl,
    rawBio,
    persistentBandSnapshot,
    persistentBandsSnapshot,
    decorateBand: decorateBandForArtistEnrichment,
    decorateBands: decorateBandsForArtistEnrichment,
    mergeOfficialArtwork,
    applyGeneratedEnrichment,
    applyHomepageEnrichment,
    enrichmentSourceHasUsableResult,
    noteEnrichmentSourceResult,
    nextEnrichmentState: nextArtistEnrichmentState,
    enrichmentRetryDue: artistEnrichmentRetryDue,
    nextRetryBand: nextArtistEnrichmentRetryBand,
    installBrowserIntegration: installArtistEnrichmentBrowserIntegration,
  };

  const api = { PROVIDERS, TRUSTED_MUSICBRAINZ_STATUSES, TRUSTED_PROVIDER_STATUSES, providerRecord, providerId, isConfirmed, trustedMusicbrainzBand, providerBackfillEligible, duplicateAssignments, duplicateBandIds, retryInfo, providerRetrySummary, statusForRecord, providerCoverage, identityCoverage, artistEnrichment };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProviderIdentityState = api;
  if (root?.document) root.document.addEventListener('DOMContentLoaded', installArtistEnrichmentBrowserIntegration, { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
