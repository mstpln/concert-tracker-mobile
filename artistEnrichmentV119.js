'use strict';
(function attachArtistEnrichmentV119(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrArtistEnrichmentV119 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const TRUSTED_SPOTIFY_STATUSES = new Set(['confirmed', 'manual_confirmed']);
  const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
  const DECORATED = Symbol('gau3-decorated');

  function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function safeHttpsImageUrl(value) {
    const raw = nonEmptyString(value);
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function trustedSpotifyIdentity(band) {
    const record = band?.musicbrainz?.spotify;
    const id = nonEmptyString(record?.id);
    if (!id || !TRUSTED_SPOTIFY_STATUSES.has(record?.status)) return null;
    return record;
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

  function rawPhotoUrl(band) {
    if (!band || typeof band !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(band, 'photoUrl');
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) return nonEmptyString(descriptor.value);
    return nonEmptyString(band.__gau3RawPhotoUrl);
  }

  function rawBio(band) {
    if (!band || typeof band !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(band, 'bio');
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) return nonEmptyString(descriptor.value);
    return nonEmptyString(band.__gau3RawBio);
  }

  function officialArtworkUrl(band) {
    const artwork = band?.artistArtwork?.officialSite;
    const url = safeHttpsImageUrl(artwork?.url);
    if (!url) return null;
    const sourceUrl = nonEmptyString(artwork?.sourceUrl);
    const currentOfficialUrl = nonEmptyString(band?.officialUrl);
    if (sourceUrl && currentOfficialUrl && sourceUrl !== currentOfficialUrl) return null;
    return url;
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

  function setUserPhoto(band, value) {
    if (!band || typeof band !== 'object') return;
    const normalized = nonEmptyString(value);
    Object.defineProperty(band, 'photoUrl', { value: normalized, writable: true, configurable: true, enumerable: true });
  }

  function setUserBio(band, value) {
    if (!band || typeof band !== 'object') return;
    const normalized = nonEmptyString(value);
    Object.defineProperty(band, 'bio', { value: normalized, writable: true, configurable: true, enumerable: true });
  }

  function decorateBand(band) {
    if (!band || typeof band !== 'object' || band[DECORATED]) return band;
    const startingPhoto = nonEmptyString(band.photoUrl);
    const startingBio = nonEmptyString(band.bio);
    Object.defineProperty(band, '__gau3RawPhotoUrl', { value: startingPhoto, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(band, '__gau3RawBio', { value: startingBio, writable: true, configurable: true, enumerable: false });
    if (!startingPhoto) {
      try { delete band.photoUrl; } catch (_) {}
      Object.defineProperty(band, 'photoUrl', {
        configurable: true,
        enumerable: false,
        get() { return visibleArtistImageUrl(band); },
        set(value) { setUserPhoto(band, value); },
      });
    }
    if (!startingBio) {
      try { delete band.bio; } catch (_) {}
      Object.defineProperty(band, 'bio', {
        configurable: true,
        enumerable: false,
        get() { return visibleBio(band); },
        set(value) { setUserBio(band, value); },
      });
    }
    Object.defineProperty(band, DECORATED, { value: true, configurable: false, enumerable: false });
    return band;
  }

  function decorateBands(rows) {
    for (const band of rows || []) decorateBand(band);
    return rows;
  }

  function mergeOfficialArtwork(band, imageUrl, sourceUrl, now) {
    const url = safeHttpsImageUrl(imageUrl);
    if (!url) return false;
    const current = band.artistArtwork && typeof band.artistArtwork === 'object' ? band.artistArtwork : {};
    if (safeHttpsImageUrl(current.officialSite?.url)) return false;
    band.artistArtwork = {
      ...current,
      officialSite: {
        ...(current.officialSite || {}),
        url,
        sourceUrl: nonEmptyString(sourceUrl),
        source: 'official_site_og_image',
        updatedAt: now,
      },
    };
    return true;
  }

  function nextEnrichmentState(prior, { failures = [], now = new Date().toISOString() } = {}) {
    const failureList = [...new Set((failures || []).map((value) => nonEmptyString(value)).filter(Boolean))];
    const parsed = Date.parse(now);
    if (failureList.length) {
      return {
        ...(prior || {}),
        status: 'retryable',
        lastAttemptedAt: now,
        nextEligibleCheckAt: new Date((Number.isFinite(parsed) ? parsed : Date.now()) + RETRY_DELAY_MS).toISOString(),
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

  function enrichmentRetryDue(band, now = new Date()) {
    const state = band?.artistEnrichment;
    if (state?.status !== 'retryable') return false;
    const eligible = Date.parse(state.nextEligibleCheckAt || '');
    return !Number.isFinite(eligible) || eligible <= now.getTime();
  }

  function applyGeneratedEnrichment(band, ai, now) {
    if (!band || !ai || typeof ai !== 'object') return false;
    let changed = false;
    const assignments = [
      ['genre', nonEmptyString(ai.genre)],
      ['origin', nonEmptyString(ai.origin)],
      ['formedYear', ai.formedYear == null ? null : ai.formedYear],
    ];
    for (const [field, value] of assignments) {
      if ((band[field] == null || band[field] === '') && value != null && value !== '') {
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
    if (homepage.socials && typeof homepage.socials === 'object') {
      const current = band.socials && typeof band.socials === 'object' ? band.socials : {};
      const next = { ...current };
      for (const [key, value] of Object.entries(homepage.socials)) {
        if (!next[key] && nonEmptyString(value)) {
          next[key] = value;
          changed = true;
        }
      }
      band.socials = next;
    }
    return changed;
  }

  function installBrowserIntegration() {
    if (!root?.document || root.__gau3ArtistEnrichmentInstalled) return;
    root.__gau3ArtistEnrichmentInstalled = true;
    const originalRenderers = {};
    const session = { retryStarted: false, retryTimer: null };

    function currentBands() {
      try { return Array.isArray(bands) ? bands : []; } catch (_) { return []; }
    }

    function scheduleRetry() {
      if (session.retryStarted || session.retryTimer) return;
      session.retryTimer = root.setTimeout(() => {
        session.retryTimer = null;
        const due = currentBands().find((band) => !band?._enriching && enrichmentRetryDue(band));
        if (!due) return;
        session.retryStarted = true;
        try { enrichBand(due.id); } catch (_) {}
      }, 750);
    }

    for (const name of ['renderMyBandsScreen', 'renderProfileScreen', 'renderMyConcertsScreen']) {
      try {
        const original = eval(name);
        if (typeof original !== 'function') continue;
        originalRenderers[name] = original;
        const wrapped = function (...args) {
          decorateBands(currentBands());
          const result = original.apply(this, args);
          scheduleRetry();
          return result;
        };
        eval(`${name} = wrapped`);
      } catch (_) {}
    }

    async function gau3EnrichBand(bandId) {
      const rows = currentBands();
      const band = rows.find((item) => item?.id === bandId);
      if (!band) return;
      decorateBand(band);
      const now = new Date().toISOString();
      const failures = [];
      band._enriching = true;
      band.artistEnrichment = {
        ...(band.artistEnrichment || {}),
        status: 'running',
        lastAttemptedAt: now,
        nextEligibleCheckAt: null,
        errorCategory: null,
      };
      try { originalRenderers.renderProfileScreen?.(); } catch (_) {}

      let homepage = null;
      let wiki = null;
      if (nonEmptyString(band.officialUrl)) {
        try { homepage = await fetchHomepageInfo(band.officialUrl); }
        catch (_) { failures.push('official_site'); }
      }
      try { wiki = await fetchWikipediaText(band.name); }
      catch (_) { failures.push('wikipedia'); }

      let groqKey = '';
      try {
        groqKey = await new Promise((resolve) => {
          if (!root.chrome?.storage?.local?.get) return resolve('');
          root.chrome.storage.local.get(['personalGroqKey'], (result) => resolve(result?.personalGroqKey || ''));
        });
      } catch (_) {}

      let ai = null;
      try {
        const prompt = buildEnrichPrompt(band, homepage, wiki);
        ai = groqKey ? await callGroq(prompt, groqKey) : await callPollinations(prompt);
      } catch (_) {
        failures.push(groqKey ? 'groq' : 'pollinations');
      }

      applyGeneratedEnrichment(band, ai, now);
      applyHomepageEnrichment(band, homepage, now);
      const state = nextEnrichmentState(band.artistEnrichment, { failures, now });
      band.artistEnrichment = state;
      if (state.status === 'complete') band.enrichedAt = now;
      band._enriching = false;

      try {
        await dlWriteJsonFile(remote, 'bands.json', stripTransient(rows));
      } catch (error) {
        band.artistEnrichment = nextEnrichmentState(band.artistEnrichment, { failures: ['storage_write'], now: new Date().toISOString() });
        throw error;
      } finally {
        try { originalRenderers.renderProfileScreen?.(); } catch (_) {}
        try { originalRenderers.renderMyBandsScreen?.(); } catch (_) {}
        try { originalRenderers.renderMyConcertsScreen?.(); } catch (_) {}
      }
    }

    try { enrichBand = gau3EnrichBand; } catch (_) {}
    decorateBands(currentBands());
    scheduleRetry();
  }

  const api = {
    TRUSTED_SPOTIFY_STATUSES,
    RETRY_DELAY_MS,
    safeHttpsImageUrl,
    trustedSpotifyIdentity,
    selectSpotifyArtistImage,
    trustedSpotifyArtworkUrl,
    officialArtworkUrl,
    visibleArtistImageUrl,
    visibleBio,
    rawPhotoUrl,
    rawBio,
    decorateBand,
    decorateBands,
    mergeOfficialArtwork,
    nextEnrichmentState,
    enrichmentRetryDue,
    applyGeneratedEnrichment,
    applyHomepageEnrichment,
    installBrowserIntegration,
  };

  if (root?.document) installBrowserIntegration();
  return api;
});
