'use strict';

(function installVenueMetadataV158(root) {
  const model = root.VenueMetadataModelV158;
  if (!model) return;

  let venueRecords = [];

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

  function normalizedAddress(value) {
    return model.normalizeIdentityText(model.addressLines(value).join(' '));
  }

  function addressHead(value) {
    const raw = typeof value === 'string' ? value : model.addressLines(value).join(', ');
    return model.normalizeIdentityText(String(raw || '').split(',')[0]);
  }

  function locationsCompatible(value, variant) {
    const leftCity = model.canonicalCityKey(value?.city);
    const rightCity = model.canonicalCityKey(variant?.city);
    if (leftCity && rightCity && leftCity !== rightCity) return false;
    const leftCountry = model.canonicalCountryKey(value?.country);
    const rightCountry = model.canonicalCountryKey(variant?.country);
    if (leftCountry && rightCountry && leftCountry !== rightCountry) return false;
    return true;
  }

  function uniqueBestRecord(scored) {
    const usable = scored.filter((entry) => entry.score > 0 && entry.record?.venueId);
    if (!usable.length) return null;
    const maxScore = Math.max(...usable.map((entry) => entry.score));
    const best = usable.filter((entry) => entry.score === maxScore);
    const ids = [...new Set(best.map((entry) => entry.record.venueId))];
    return ids.length === 1 ? best.find((entry) => entry.record.venueId === ids[0]).record : null;
  }

  function namedVenueEvidenceScore(value, record) {
    const targetName = model.normalizeIdentityText(value?.venue ?? value?.name);
    if (!targetName) return 0;
    let best = 0;
    for (const variant of recordVariants(record)) {
      if (!locationsCompatible(value, variant)) continue;
      if (model.normalizeIdentityText(variant?.name) !== targetName) continue;
      const sourceAddress = String(value?.venueAddress ?? value?.address ?? '').trim();
      const variantAddress = model.addressLines(variant?.address).join(' ');
      if (!sourceAddress || !variantAddress) {
        best = Math.max(best, 1);
        continue;
      }
      const sourceFull = normalizedAddress(sourceAddress);
      const variantFull = normalizedAddress(variantAddress);
      if (sourceFull && variantFull && sourceFull === variantFull) best = Math.max(best, 4);
      else if (addressHead(sourceAddress) && addressHead(sourceAddress) === addressHead(variantAddress)) best = Math.max(best, 3);
    }
    return best;
  }

  function placeholderVenueEvidenceScore(value, record) {
    const sourceAddress = String(value?.venueAddress ?? value?.address ?? '').trim();
    if (!sourceAddress) return 0;
    const sourceFull = normalizedAddress(sourceAddress);
    const sourceHead = addressHead(sourceAddress);
    let best = 0;
    for (const variant of recordVariants(record)) {
      if (!locationsCompatible(value, variant)) continue;
      const targetAddress = model.addressLines(variant?.address).join(' ');
      const targetFull = normalizedAddress(targetAddress);
      const targetHead = addressHead(targetAddress);
      if (sourceFull && targetFull && sourceFull === targetFull) best = Math.max(best, 5);
      else if (sourceHead && targetHead && sourceHead === targetHead) best = Math.max(best, 4);

      const venueName = model.normalizeIdentityText(variant?.name || record?.name);
      if (venueName && sourceFull && (sourceFull === venueName || sourceFull.startsWith(`${venueName} `))) {
        best = Math.max(best, 3);
      }
    }
    return best;
  }

  function metadataFor(value) {
    const direct = model.findVenueRecord(value, venueRecords);
    if (direct) return direct;

    const rawVenue = String(value?.venue ?? value?.name ?? '').trim();
    if (!rawVenue) return null;
    if (model.isPlaceholderVenueName(rawVenue)) {
      return uniqueBestRecord(venueRecords.map((record) => ({ record, score: placeholderVenueEvidenceScore(value, record) })));
    }
    return uniqueBestRecord(venueRecords.map((record) => ({ record, score: namedVenueEvidenceScore(value, record) })));
  }

  function capacityHtml(value, className = '') {
    const label = model.capacityLabel(value);
    return label ? `<p class="venue-max-capacity ${className}">${escapeHtml(label)}</p>` : '';
  }

  function setRecords(records) {
    venueRecords = model.normalizeDocument(records);
    return venueRecords;
  }

  function getRecords() {
    return venueRecords.map((record) => ({ ...record }));
  }

  function bestConcertAddress(group) {
    const values = (group?.concerts || [])
      .map((concert) => String(concert?.venueAddress || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return values[0] || '';
  }

  function fallbackVenueKey(value) {
    const base = [
      model.normalizeIdentityText(value?.venue),
      model.canonicalCityKey(value?.city),
      model.canonicalCountryKey(value?.country),
    ].join('|');
    const street = addressHead(value?.venueAddress);
    return `fallback:${base}${street ? `|${street}` : ''}`;
  }

  function canonicalVenueIdentity(value) {
    const rawVenue = String(value?.venue ?? value?.name ?? '').trim();
    if (!rawVenue) return null;

    const record = metadataFor(value);
    if (model.isPlaceholderVenueName(rawVenue) && !record) return null;

    const venue = String(record?.name || rawVenue).trim();
    const city = String(record?.city || value?.city || '').trim();
    const country = String(record?.country || value?.country || '').trim();
    if (!venue || !city || model.isPlaceholderVenueName(venue)) return null;

    return {
      key: record?.venueId ? `venue:${record.venueId}` : fallbackVenueKey({ ...value, venue, city, country }),
      venue,
      city,
      country,
      record: record || null,
    };
  }

  function canonicalizeConcertVenue(concert) {
    const identity = canonicalVenueIdentity(concert);
    if (!identity) return { ...concert };
    return { ...concert, venue: identity.venue, city: identity.city, country: identity.country };
  }

  function canonicalVenueGroups(concertList) {
    const byKey = new Map();
    for (const concert of concertList || []) {
      const identity = canonicalVenueIdentity(concert);
      if (!identity) continue;

      let group = byKey.get(identity.key);
      if (!group) {
        group = {
          key: identity.key,
          venue: identity.venue,
          city: identity.city,
          country: identity.country,
          concerts: [],
          record: identity.record,
        };
        byKey.set(identity.key, group);
      } else if (!group.record && identity.record) {
        group.record = identity.record;
        group.venue = identity.venue;
        group.city = identity.city;
        group.country = identity.country;
      }

      group.concerts.push(concert);
      if (!group.country && concert?.country) group.country = String(concert.country).trim();
    }
    return [...byKey.values()].sort((a, b) => a.venue.localeCompare(b.venue));
  }

  function detailAddressLines(record, group) {
    let lines = model.addressLines(record?.address);
    if (!lines.length) lines = model.addressLines(bestConcertAddress(group));
    const joined = lines.join(' ').toLocaleLowerCase();
    const sample = group?.concerts?.find((concert) => concert) || {};
    const city = String(record?.city || group?.city || sample.city || '').trim();
    const country = String(record?.country || group?.country || sample.country || '').trim();
    const postal = String(sample.postalCode || sample.postal || sample.zip || '').trim();
    const locality = [postal, city].filter(Boolean).join(' ').trim();
    if (locality && (!city || !joined.includes(city.toLocaleLowerCase()))) lines.push(locality);
    const joinedWithLocality = lines.join(' ').toLocaleLowerCase();
    if (country && !joinedWithLocality.includes(country.toLocaleLowerCase())) lines.push(country);
    return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
  }

  function venueMetadataPanelHtml(group, record) {
    const address = detailAddressLines(record, group);
    const capacity = model.capacityLabel(record?.maxCapacity);
    const officialUrl = model.safeOfficialUrl(record?.officialUrl);
    const description = String(record?.description || '').trim();
    if (!address.length && !capacity && !officialUrl && !description) return '';

    return `<div class="venue-detail-metadata">
      ${address.length ? `<div class="venue-detail-block"><p class="venue-detail-label">Address</p><p class="venue-detail-value">${address.map((line) => escapeHtml(line)).join('<br>')}</p></div>` : ''}
      ${capacity ? `<div class="venue-detail-block"><p class="venue-detail-label">Venue information</p><p class="venue-detail-value venue-detail-capacity">${escapeHtml(capacity)}</p></div>` : ''}
      ${officialUrl ? `<div class="venue-detail-block"><p class="venue-detail-label">Official website</p><a class="venue-detail-official-link" href="${escapeAttr(officialUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(officialUrl).hostname.replace(/^www\./, ''))} ↗</a></div>` : ''}
      ${description ? `<div class="venue-detail-block"><p class="venue-detail-label">About</p><p class="venue-detail-description">${escapeHtml(description)}</p></div>` : ''}
    </div>`;
  }

  function renderVenueRows() {
    const liveConcerts = currentConcerts().filter((concert) => currentBands().some((band) => band.id === concert.bandId));
    const allGroups = canonicalVenueGroups(liveConcerts);
    const totalVenueCount = allGroups.length;
    let groups = allGroups;

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

    if (!groups.length) return totalHeader + filterRow + '<p class="screen-empty">No venues match these filters yet.</p>';

    const rows = groups.map((group) => {
      const record = group.record || metadataFor({ venue: group.venue, city: group.city, country: group.country, venueAddress: bestConcertAddress(group) });
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
    return totalHeader + filterRow + rows;
  }

  function renderVenueDetail(key) {
    const container = document.getElementById('screen-venue-detail');
    const liveConcerts = currentConcerts().filter((concert) => currentBands().some((band) => band.id === concert.bandId));
    const group = canonicalVenueGroups(liveConcerts).find((candidate) => candidate.key === key);
    if (!group) {
      container.innerHTML = '<p class="screen-empty">Venue not found.</p>';
      return;
    }
    const record = group.record || metadataFor({ venue: group.venue, city: group.city, country: group.country, venueAddress: bestConcertAddress(group) });
    const sorted = [...group.concerts].sort((a, b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = `
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
    container.querySelectorAll('.row-card[data-band-id]').forEach((row) => row.addEventListener('click', () => openProfile(row.dataset.bandId)));
  }

  function insertCapacityIntoConcertCard(html, concert) {
    const record = metadataFor(concert);
    const capacity = capacityHtml(record?.maxCapacity, 'venue-max-capacity-concert');
    if (!capacity) return html;
    if (html.includes('venue-max-capacity-concert')) return html;
    if (/<p class="row-km">/.test(html)) return html.replace(/<p class="row-km">/, `${capacity}<p class="row-km">`);
    return html.replace(/<div class="concert-prep-group/, `${capacity}<div class="concert-prep-group`);
  }

  function decorateNextConcert() {
    const card = document.getElementById('countdown-card');
    if (!card || card.querySelector('.venue-max-capacity-next')) return;
    const liveConcerts = currentConcerts().filter((concert) => currentBands().some((band) => band.id === concert.bandId));
    const upcoming = dlMyConcerts(liveConcerts).upcoming;
    const next = EventModelV156.nextEventPresentation(upcoming);
    if (!next) return;
    const record = metadataFor(next);
    const label = model.capacityLabel(record?.maxCapacity);
    if (!label) return;
    const anchor = [...card.querySelectorAll('.countdown-v139-address')].pop()
      || card.querySelector('.countdown-v139-show-venue')
      || card.querySelector('.countdown-v139-venue');
    if (!anchor) return;
    const node = document.createElement('p');
    node.className = 'venue-max-capacity venue-max-capacity-next';
    node.textContent = label;
    anchor.insertAdjacentElement('afterend', node);
  }

  if (typeof root.loadDataAndShowApp === 'function') {
    const priorLoad = root.loadDataAndShowApp;
    root.loadDataAndShowApp = async function loadDataAndShowAppV158(...args) {
      try {
        const loaded = await dlReadJsonFile(remote, 'venues.json', []);
        setRecords(loaded);
      } catch (error) {
        console.warn('Venue metadata unavailable; continuing without it.', error);
        setRecords([]);
      }
      return priorLoad.apply(this, args);
    };
  }

  if (typeof root.myConcertRowHtml === 'function') {
    const priorRow = root.myConcertRowHtml;
    root.myConcertRowHtml = function myConcertRowHtmlV158(concert, ...args) {
      return insertCapacityIntoConcertCard(priorRow.call(this, concert, ...args), concert);
    };
  }

  if (typeof root.dlConcertStats === 'function') {
    const priorConcertStats = root.dlConcertStats;
    root.dlConcertStats = function dlConcertStatsCanonicalVenues(attendedPast, bandsArg = [], upcomingGoing = [], ...args) {
      const canonicalPast = (attendedPast || []).map(canonicalizeConcertVenue);
      const canonicalUpcoming = (upcomingGoing || []).map(canonicalizeConcertVenue);
      const result = priorConcertStats.call(this, canonicalPast, bandsArg, canonicalUpcoming, ...args);
      if (!result || typeof result !== 'object') return result;
      const visibleKeys = new Set(canonicalPast
        .map(canonicalVenueIdentity)
        .filter(Boolean)
        .map((identity) => identity.key));
      return {
        ...result,
        uniqueVenues: visibleKeys.size,
        topVenues: Array.isArray(result.topVenues)
          ? result.topVenues.filter((entry) => !model.isPlaceholderVenueName(entry?.venue))
          : result.topVenues,
      };
    };
  }

  if (typeof root.venuesSubTabHtml === 'function') root.venuesSubTabHtml = renderVenueRows;
  if (typeof root.renderVenueDetailScreen === 'function') root.renderVenueDetailScreen = renderVenueDetail;

  if (typeof root.renderMyConcertsScreen === 'function') {
    const priorRenderMyConcerts = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV158(...args) {
      const result = priorRenderMyConcerts.apply(this, args);
      decorateNextConcert();
      return result;
    };
  }

  root.VenueMetadataV158 = Object.freeze({
    getRecords,
    setRecords,
    metadataFor,
    canonicalizeConcertVenue,
    canonicalVenueIdentity,
    canonicalVenueGroups,
    detailAddressLines,
    venueMetadataPanelHtml,
    insertCapacityIntoConcertCard,
    decorateNextConcert,
  });

  decorateNextConcert();
})(typeof globalThis !== 'undefined' ? globalThis : this);
