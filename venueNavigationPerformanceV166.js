'use strict';

// v166 Dates > Venues responsiveness correction.
//
// v164 intentionally made venue identity stricter, but its canonical fallback
// rescanned every venue record (and every alias/address) for every concert on
// each render. With the real collection that turned simple navigation into
// minutes of synchronous work. This layer preserves the v164 matching rules
// while indexing the same evidence once, caching the canonical directory for
// the current in-memory data, and reusing that result for venue detail.
// Nothing here persists data or changes provider/venue ownership semantics.
(function installVenueNavigationPerformanceV166(root) {
  if (root.__LIVEVAULT_VENUE_NAVIGATION_PERFORMANCE_V166__) return;
  root.__LIVEVAULT_VENUE_NAVIGATION_PERFORMANCE_V166__ = true;

  const model = root.VenueMetadataModelV158;
  const venueApi = root.VenueMetadataV158;
  if (!model || !venueApi) return;

  const baseMetadataFor = venueApi.metadataFor;
  const baseCanonicalVenueIdentity = venueApi.canonicalVenueIdentity;
  if (typeof baseMetadataFor !== 'function' || typeof baseCanonicalVenueIdentity !== 'function') return;

  const metrics = {
    indexBuilds: 0,
    groupBuilds: 0,
    groupCacheHits: 0,
    detailCacheHits: 0,
  };

  let recordIndexCache = null;
  let groupCache = null;
  let detailHtmlCache = new Map();
  let directoryHtmlCache = new Map();
  let lastRenderedConcertsKey = null;

  function currentConcerts() {
    try { return Array.isArray(concerts) ? concerts : []; } catch (_) { return []; }
  }

  function currentBands() {
    try { return Array.isArray(bands) ? bands : []; } catch (_) { return []; }
  }

  function recordVariants(record) {
    return [record, ...(Array.isArray(record?.identityAliases) ? record.identityAliases : [])]
      .filter((variant) => variant && typeof variant === 'object' && !Array.isArray(variant));
  }

  function addressText(value) {
    const venueAddress = model.addressLines(value?.venueAddress).join(' ');
    if (venueAddress) return venueAddress;
    return model.addressLines(value?.address).join(' ');
  }

  function normalizedAddress(value) {
    return model.normalizeIdentityText(model.addressLines(value).join(' '));
  }

  function addressHead(value) {
    const raw = typeof value === 'string' ? value : model.addressLines(value).join(', ');
    return model.normalizeIdentityText(String(raw || '').split(',')[0]);
  }

  function canonicalCountry(value) {
    const key = model.canonicalCountryKey(value);
    if (['usa', 'us', 'u s', 'united states of america'].includes(key)) return 'united states';
    return key;
  }

  function countriesCompatible(left, right) {
    const a = canonicalCountry(left);
    const b = canonicalCountry(right);
    return !a || !b || a === b;
  }

  function recordPreferenceScore(record) {
    if (!record) return 0;
    const status = { complete: 50, partial: 40, review_needed: 30, unresolved: 20, temporary_error: 10 }[record.researchStatus] || 0;
    return status
      + (Array.isArray(record.identityAliases) ? Math.min(record.identityAliases.length, 8) : 0)
      + (Array.isArray(record.legacyVenueIds) ? Math.min(record.legacyVenueIds.length, 8) : 0)
      + (model.validCapacity(record.maxCapacity) ? 4 : 0)
      + (model.addressLines(record.address).length ? 3 : 0)
      + (model.safeOfficialUrl(record.officialUrl) ? 2 : 0);
  }

  function recordSignature(records) {
    return JSON.stringify((records || []).map((record) => [
      record?.venueId || '',
      record?.name || '',
      record?.city || '',
      record?.country || '',
      model.addressLines(record?.address).join('|'),
      record?.researchStatus || '',
      record?.maxCapacity || 0,
      record?.officialUrl || '',
      record?.description || '',
      (record?.identityAliases || []).map((alias) => [
        alias?.name || '', alias?.city || '', alias?.country || '', model.addressLines(alias?.address).join('|'),
      ]),
      recordPreferenceScore(record),
    ]));
  }

  function buildRecordIndex(records) {
    const signature = recordSignature(records);
    if (recordIndexCache?.signature === signature) return recordIndexCache;

    const byName = new Map();
    const byFullAddress = new Map();
    const byAddressHead = new Map();
    const prepared = [];

    for (const record of records || []) {
      const variants = recordVariants(record).map((variant) => {
        const nameKey = model.normalizeIdentityText(variant?.name);
        const cityKey = model.canonicalCityKey(variant?.city);
        const countryKey = canonicalCountry(variant?.country);
        const address = model.addressLines(variant?.address).join(' ');
        const fullAddress = normalizedAddress(address);
        const head = addressHead(address);
        return { source: variant, nameKey, cityKey, countryKey, address, fullAddress, head };
      });
      const entry = {
        record,
        variants,
        primaryFullAddress: normalizedAddress(model.addressLines(record?.address).join(' ')),
      };
      prepared.push(entry);

      const nameKeys = new Set(variants.map((variant) => variant.nameKey).filter(Boolean));
      for (const key of nameKeys) {
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(entry);
      }
      const fullAddresses = new Set(variants.map((variant) => variant.fullAddress).filter(Boolean));
      for (const key of fullAddresses) {
        if (!byFullAddress.has(key)) byFullAddress.set(key, []);
        byFullAddress.get(key).push(entry);
      }
      const heads = new Set(variants.map((variant) => variant.head).filter(Boolean));
      for (const key of heads) {
        if (!byAddressHead.has(key)) byAddressHead.set(key, []);
        byAddressHead.get(key).push(entry);
      }
    }

    metrics.indexBuilds += 1;
    recordIndexCache = { signature, byName, byFullAddress, byAddressHead, prepared };
    groupCache = null;
    detailHtmlCache = new Map();
    directoryHtmlCache = new Map();
    lastRenderedConcertsKey = null;
    return recordIndexCache;
  }

  function namedVenueEvidenceScore(value, entry) {
    const targetName = model.normalizeIdentityText(value?.venue ?? value?.name);
    if (!targetName) return 0;
    const sourceAddress = addressText(value);
    const sourceFull = normalizedAddress(sourceAddress);
    const sourceHead = addressHead(sourceAddress);
    const sourceCity = model.canonicalCityKey(value?.city);
    const sourceCountry = value?.country;
    let best = 0;

    for (const variant of entry.variants) {
      if (!countriesCompatible(sourceCountry, variant.source?.country)) continue;
      if (variant.nameKey !== targetName) continue;
      const sameCity = !!sourceCity && sourceCity === variant.cityKey;

      if (sourceFull && variant.fullAddress && sourceFull === variant.fullAddress) best = Math.max(best, 5);
      else if (sourceHead && variant.head && sourceHead === variant.head) best = Math.max(best, 4);
      else if (sameCity && (!sourceAddress || !variant.address)) {
        // Preserve v164's address-less alias safeguard exactly.
        if (sourceFull && entry.primaryFullAddress && sourceFull !== entry.primaryFullAddress && !variant.fullAddress) continue;
        best = Math.max(best, 2);
      }
    }
    return best;
  }

  function placeholderVenueEvidenceScore(value, entry) {
    const sourceAddress = addressText(value);
    if (!sourceAddress) return 0;
    const sourceFull = normalizedAddress(sourceAddress);
    const sourceHead = addressHead(sourceAddress);
    let best = 0;
    for (const variant of entry.variants) {
      if (!countriesCompatible(value?.country, variant.source?.country)) continue;
      const sameCity = !value?.city || !variant.source?.city || model.canonicalCityKey(value.city) === variant.cityKey;
      if (sameCity && sourceFull && variant.fullAddress && sourceFull === variant.fullAddress) best = Math.max(best, 6);
      else if (sameCity && sourceHead && variant.head && sourceHead === variant.head) best = Math.max(best, 5);

      const venueName = variant.nameKey || model.normalizeIdentityText(entry.record?.name);
      if (sameCity && venueName && sourceFull && (sourceFull === venueName || sourceFull.startsWith(`${venueName} `))) {
        best = Math.max(best, 4);
      }
    }
    return best;
  }

  function uniqueBestRecord(value, entries, scorer) {
    let maxScore = 0;
    let bestRecord = null;
    let bestVenueId = null;
    let ambiguous = false;
    for (const entry of entries || []) {
      const score = scorer(value, entry);
      if (!(score > 0) || !entry.record?.venueId) continue;
      if (score > maxScore) {
        maxScore = score;
        bestRecord = entry.record;
        bestVenueId = entry.record.venueId;
        ambiguous = false;
      } else if (score === maxScore && entry.record.venueId !== bestVenueId) {
        ambiguous = true;
      }
    }
    return maxScore > 0 && !ambiguous ? bestRecord : null;
  }

  function candidateEntriesForPlaceholder(value, index) {
    const full = normalizedAddress(addressText(value));
    const head = addressHead(addressText(value));
    const candidates = new Set();
    for (const entry of index.byFullAddress.get(full) || []) candidates.add(entry);
    for (const entry of index.byAddressHead.get(head) || []) candidates.add(entry);

    // v164 also accepts a placeholder address whose normalized value begins
    // with a canonical/reviewed-alias venue name (for example
    // "Nordichallen, Sundsvall..."). Include every name-prefix candidate even
    // when some unrelated address candidate already exists, otherwise that
    // unrelated candidate can hide the real v164 score-4 match.
    if (full) {
      const tokens = full.split(' ').filter(Boolean);
      let prefix = '';
      for (const token of tokens) {
        prefix = prefix ? `${prefix} ${token}` : token;
        for (const entry of index.byName.get(prefix) || []) candidates.add(entry);
      }
    }
    return [...candidates];
  }

  function canonicalMetadataForFast(value, index) {
    const direct = baseMetadataFor(value);
    if (direct) return direct;

    const rawVenue = String(value?.venue ?? value?.name ?? '').trim();
    if (!rawVenue) return null;
    if (model.isPlaceholderVenueName(rawVenue)) {
      return uniqueBestRecord(value, candidateEntriesForPlaceholder(value, index), placeholderVenueEvidenceScore);
    }
    const targetName = model.normalizeIdentityText(rawVenue);
    return uniqueBestRecord(value, index.byName.get(targetName) || [], namedVenueEvidenceScore);
  }

  function canonicalVenueIdentityFast(value, index) {
    const rawVenue = String(value?.venue ?? value?.name ?? '').trim();
    if (!rawVenue) return null;

    const record = canonicalMetadataForFast(value, index);
    if (model.isPlaceholderVenueName(rawVenue) && !record) return null;

    const venue = String(record?.name || rawVenue).trim();
    const city = String(record?.city || value?.city || '').trim();
    const country = String(record?.country || value?.country || '').trim();
    if (!venue || !city || model.isPlaceholderVenueName(venue)) return null;

    const nameKey = model.normalizeIdentityText(venue);
    const cityKey = model.canonicalCityKey(city);
    const countryKey = canonicalCountry(country);
    const sourceAddressHead = addressHead(value?.venueAddress) || addressHead(value?.address);
    const recordAddressHead = addressHead(record?.address);
    return {
      key: `physical:${nameKey}|${cityKey}`,
      venue,
      city,
      country,
      nameKey,
      cityKey,
      countryKey,
      addressHead: sourceAddressHead || recordAddressHead,
      record: record || null,
    };
  }

  function identitiesMatch(left, right) {
    if (!left || !right) return false;
    if (left.record?.venueId && right.record?.venueId && left.record.venueId === right.record.venueId) return true;
    if (!left.nameKey || left.nameKey !== right.nameKey) return false;
    if (left.countryKey && right.countryKey && left.countryKey !== right.countryKey) return false;
    if (left.cityKey && right.cityKey && left.cityKey === right.cityKey) {
      if (left.addressHead && right.addressHead && left.addressHead !== right.addressHead) return false;
      return true;
    }
    return !!(left.addressHead && right.addressHead && left.addressHead === right.addressHead);
  }

  function liveConcertState() {
    const bandIds = new Set(currentBands().map((band) => band?.id).filter((id) => id != null));
    const liveConcerts = currentConcerts().filter((concert) => bandIds.has(concert?.bandId));
    const key = JSON.stringify([
      [...bandIds].sort(),
      liveConcerts.map((concert) => [
        concert?.id || '', concert?.bandId || '', concert?.bandName || '', concert?.venue || '', concert?.city || '', concert?.country || '',
        concert?.venueAddress || '', model.addressLines(concert?.address).join('|'), concert?.date || '', concert?.time || '', concert?.attending === true ? 1 : 0,
        Number.isFinite(concert?.distanceKm) ? concert.distanceKm : null,
      ]),
    ]);
    return { liveConcerts, key };
  }

  function canonicalVenueGroupsFast() {
    const records = venueApi.getRecords();
    const index = buildRecordIndex(records);
    const state = liveConcertState();
    const key = `${index.signature}|${state.key}`;
    if (groupCache?.key === key) {
      metrics.groupCacheHits += 1;
      return groupCache;
    }

    const groups = [];
    const byName = new Map();
    for (const concert of state.liveConcerts) {
      const identity = canonicalVenueIdentityFast(concert, index);
      if (!identity) continue;

      const candidates = byName.get(identity.nameKey) || [];
      let group = candidates.find((candidate) => identitiesMatch(candidate.identity, identity));
      if (!group) {
        group = {
          key: `${identity.key}:${groups.length}`,
          venue: identity.venue,
          city: identity.city,
          country: identity.country,
          concerts: [],
          record: identity.record,
          identity,
        };
        groups.push(group);
        candidates.push(group);
        byName.set(identity.nameKey, candidates);
      } else if (recordPreferenceScore(identity.record) > recordPreferenceScore(group.record)) {
        group.record = identity.record;
        group.venue = identity.venue;
        group.city = identity.city;
        group.country = identity.country;
        group.identity = { ...identity, addressHead: group.identity.addressHead || identity.addressHead };
      } else if (!group.identity.addressHead && identity.addressHead) {
        group.identity.addressHead = identity.addressHead;
      }

      group.concerts.push(concert);
      if (!group.country && concert?.country) group.country = String(concert.country).trim();
    }
    groups.sort((a, b) => a.venue.localeCompare(b.venue));

    const byKey = new Map(groups.map((group) => [group.key, group]));
    metrics.groupBuilds += 1;
    groupCache = { key, stateKey: state.key, groups, byKey };
    detailHtmlCache = new Map();
    directoryHtmlCache = new Map();
    return groupCache;
  }

  function bestConcertAddress(group) {
    let best = '';
    for (const concert of group?.concerts || []) {
      const value = String(concert?.venueAddress || '').trim();
      if (value.length > best.length) best = value;
    }
    return best;
  }

  function venueMetadataPanelHtml(group, record) {
    if (typeof venueApi.venueMetadataPanelHtml === 'function') return venueApi.venueMetadataPanelHtml(group, record);
    return '';
  }

  function directoryHtml() {
    const cache = canonicalVenueGroupsFast();
    const filterKey = `${cache.key}|${venuesNearbyOnly ? 1 : 0}|${venuesEuropeOnly ? 1 : 0}|${venuesPastOnly ? 1 : 0}|${dlCurrentDate().toDateString()}`;
    const existing = directoryHtmlCache.get(filterKey);
    if (existing != null) return existing;

    const totalVenueCount = cache.groups.length;
    let groups = cache.groups;
    if (venuesEuropeOnly) groups = groups.filter((group) => group.concerts.some((concert) => dlIsEuropeCountry(concert.country)));
    else if (venuesNearbyOnly) groups = groups.filter((group) => group.concerts.some(dlIsNearby));
    if (venuesPastOnly) groups = groups.filter((group) => group.concerts.some((concert) => concert.attending && !dlIsUpcoming(concert)));

    const totalHeader = `<p class="bands-total-header"><span class="bands-total-value">${totalVenueCount.toLocaleString()}</span> venues in your collection</p>`;
    const filterRow = `
      <div class="section-label-filters" style="margin-bottom:14px">
        <button id="venues-nearby-toggle-btn" class="icon-btn${venuesNearbyOnly ? ' active' : ''}" aria-label="Show nearby only" title="Show nearby only">${icon('nearbyPin')}</button>
        <button id="venues-europe-toggle-btn" class="icon-btn${venuesEuropeOnly ? ' active' : ''}" aria-label="Show Europe only" title="Show Europe only">EU</button>
        <button id="venues-past-toggle-btn" class="icon-btn${venuesPastOnly ? ' active' : ''}" aria-label="Show only venues I've been to" title="Show only venues I've been to">Past Concerts</button>
      </div>`;

    if (!groups.length) {
      const html = totalHeader + filterRow + '<p class="screen-empty">No venues match these filters yet.</p>';
      directoryHtmlCache.set(filterKey, html);
      return html;
    }

    const rows = groups.map((group) => {
      const record = group.record || baseMetadataFor({ venue: group.venue, city: group.city, country: group.country, venueAddress: bestConcertAddress(group) });
      const capacity = model.capacityLabel(record?.maxCapacity);
      return `
        <div class="row-card clickable venue-metadata-list-card${capacity ? ' has-venue-capacity' : ''}" data-venue-key="${escapeAttr(group.key)}">
          <div class="row-top">
            <div class="row-title-group"><span class="row-name">${escapeHtml(group.venue)}</span></div>
            <span class="row-chevron">${icon('chevronRight')}</span>
          </div>
          <p class="row-sub">${escapeHtml(group.city)}${group.country ? ', ' + escapeHtml(group.country) : ''}</p>
          <p class="row-km">${group.concerts.length} ${group.concerts.length === 1 ? 'show' : 'shows'} on record</p>
          ${capacity ? `<p class="venue-card-max-capacity">${escapeHtml(capacity)}</p>` : ''}
        </div>`;
    }).join('');
    const html = totalHeader + filterRow + rows;
    directoryHtmlCache.set(filterKey, html);
    return html;
  }

  function detailHtml(key) {
    const cache = canonicalVenueGroupsFast();
    const cacheKey = `${cache.key}|${key}|${dlCurrentDate().toDateString()}`;
    if (detailHtmlCache.has(cacheKey)) {
      metrics.detailCacheHits += 1;
      return detailHtmlCache.get(cacheKey);
    }
    const group = cache.byKey.get(key);
    if (!group) return null;
    const record = group.record || baseMetadataFor({ venue: group.venue, city: group.city, country: group.country, venueAddress: bestConcertAddress(group) });
    const sorted = [...group.concerts].sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')));
    const html = `
      <p class="venue-detail-location">${escapeHtml(group.city)}${group.country ? ', ' + escapeHtml(group.country) : ''}</p>
      ${venueMetadataPanelHtml(group, record)}
      ${renderWithYearDividers(sorted, (concert) => {
        const dateStr = formatDate(concert.date, concert.time);
        const isPast = !dlIsUpcoming(concert);
        return `
          <div class="row-card clickable${isPast ? ' is-past' : ''}" data-band-id="${escapeAttr(concert.bandId)}">
            <div class="row-top">
              <div class="row-title-group">
                <span class="row-name">${escapeHtml(concert.bandName)}</span>
                ${concert.attending ? `<span class="pill ${isPast ? 'pill-attended' : 'pill-going'}">${icon('check')} ${isPast ? 'Attended' : 'Going'}</span>` : ''}
              </div>
              <span class="row-chevron">${icon('chevronRight')}</span>
            </div>
            <p class="row-sub">${dateStr}</p>
          </div>`;
      }, { showCount: true })}`;
    detailHtmlCache.set(cacheKey, html);
    return html;
  }

  root.venuesSubTabHtml = directoryHtml;

  root.renderVenueDetailScreen = function renderVenueDetailScreenV166(key) {
    const container = document.getElementById('screen-venue-detail');
    const html = detailHtml(key);
    if (!html) {
      container.innerHTML = '<p class="screen-empty">Venue not found.</p>';
      return;
    }
    container.innerHTML = html;
    // One delegated handler replaces one listener per row and survives detail
    // HTML cache reuse. The marker prevents listener accumulation.
    if (!container.dataset.v166VenueDetailDelegated) {
      container.dataset.v166VenueDetailDelegated = 'true';
      container.addEventListener('click', (event) => {
        const row = event.target.closest('.row-card[data-band-id]');
        if (row && container.contains(row)) openProfile(row.dataset.bandId);
      });
    }
  };

  root.openVenueDetail = function openVenueDetailV166(key, { fromHistory = false } = {}) {
    activeVenueKey = key;
    currentScreen = 'venue-detail';
    const group = canonicalVenueGroupsFast().byKey.get(key);
    setHeaderChrome({ showBack: true, title: group ? group.venue : 'Venue' });
    el('europe-toggle-btn').classList.add('hidden');
    el('nearby-toggle-btn').classList.add('hidden');
    showScreen('screen-venue-detail');
    root.renderVenueDetailScreen(key);
    if (!fromHistory) history.pushState({ tab: currentTab, screen: 'venue-detail', venueKey: key }, '');
  };

  root.wireVenuesSubTab = function wireVenuesSubTabV166(container) {
    container.querySelector('#venues-nearby-toggle-btn')?.addEventListener('click', async () => {
      venuesNearbyOnly = !venuesNearbyOnly;
      if (venuesNearbyOnly) venuesEuropeOnly = false;
      await chrome.storage.local.set({ venuesNearbyOnly, venuesEuropeOnly });
      renderConcertsScreen();
    });
    container.querySelector('#venues-europe-toggle-btn')?.addEventListener('click', async () => {
      venuesEuropeOnly = !venuesEuropeOnly;
      if (venuesEuropeOnly) venuesNearbyOnly = false;
      await chrome.storage.local.set({ venuesNearbyOnly, venuesEuropeOnly });
      renderConcertsScreen();
    });
    container.querySelector('#venues-past-toggle-btn')?.addEventListener('click', async () => {
      venuesPastOnly = !venuesPastOnly;
      await chrome.storage.local.set({ venuesPastOnly });
      renderConcertsScreen();
    });
    if (!container.dataset.v166VenueDirectoryDelegated) {
      container.dataset.v166VenueDirectoryDelegated = 'true';
      container.addEventListener('click', (event) => {
        const row = event.target.closest('.row-card[data-venue-key]');
        if (row && container.contains(row)) root.openVenueDetail(row.dataset.venueKey);
      });
    }
  };

  // Re-entering Dates should not rebuild identical directory DOM. The active
  // subtab still renders when filters/data changed; otherwise the existing DOM
  // and delegated listeners are reused. This wrapper is installed after v143,
  // so Sweden/EU/Nearby behavior remains owned by the existing render chain.
  const previousRenderConcertsScreen = root.renderConcertsScreen;
  if (typeof previousRenderConcertsScreen === 'function') {
    root.renderConcertsScreen = function renderConcertsScreenV166(...args) {
      const state = canonicalVenueGroupsFast();
      const renderKey = `${concertsSubTab}|${state.key}|${nearbyOnly ? 1 : 0}|${europeOnly ? 1 : 0}|${typeof swedenOnly !== 'undefined' && swedenOnly ? 1 : 0}|${venuesNearbyOnly ? 1 : 0}|${venuesEuropeOnly ? 1 : 0}|${venuesPastOnly ? 1 : 0}`;
      const container = el('screen-concerts');
      if (renderKey === lastRenderedConcertsKey && container?.childElementCount > 0) {
        el('nearby-toggle-btn').classList.toggle('hidden', concertsSubTab !== 'concerts');
        el('europe-toggle-btn').classList.toggle('hidden', concertsSubTab !== 'concerts');
        if (typeof root.v143SyncMainGeoFilterState === 'function') root.v143SyncMainGeoFilterState();
        return;
      }
      const result = previousRenderConcertsScreen.apply(this, args);
      lastRenderedConcertsKey = renderKey;
      return result;
    };
  }

  root.LiveVaultVenueNavigationPerformanceV166 = Object.freeze({
    buildRecordIndex,
    canonicalVenueIdentityFast,
    canonicalVenueGroupsFast,
    getMetrics: () => ({ ...metrics }),
    invalidate() {
      recordIndexCache = null;
      groupCache = null;
      detailHtmlCache = new Map();
      directoryHtmlCache = new Map();
      lastRenderedConcertsKey = null;
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
