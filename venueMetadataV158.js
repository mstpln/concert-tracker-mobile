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

  function metadataFor(value) {
    return model.findVenueRecord(value, venueRecords);
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

  function canonicalVenueGroups(concertList) {
    const byKey = new Map();
    for (const concert of concertList || []) {
      const rawVenue = String(concert?.venue || '').trim();
      if (!rawVenue || model.isPlaceholderVenueName(rawVenue)) continue;

      const record = metadataFor(concert);
      const canonicalName = String(record?.name || rawVenue).trim();
      const canonicalCity = String(record?.city || concert?.city || '').trim();
      const canonicalCountry = String(record?.country || concert?.country || '').trim();
      if (!canonicalName || !canonicalCity) continue;

      const fallbackIdentity = [
        model.normalizeIdentityText(canonicalName),
        model.canonicalCityKey(canonicalCity),
        model.canonicalCountryKey(canonicalCountry),
      ].join('|');
      const key = record?.venueId ? `venue:${record.venueId}` : `fallback:${fallbackIdentity}`;

      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          venue: canonicalName,
          city: canonicalCity,
          country: canonicalCountry,
          concerts: [],
          record: record || null,
        };
        byKey.set(key, group);
      } else if (!group.record && record) {
        group.record = record;
        group.venue = String(record.name || group.venue).trim();
        group.city = String(record.city || group.city).trim();
        group.country = String(record.country || group.country).trim();
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
    canonicalVenueGroups,
    detailAddressLines,
    venueMetadataPanelHtml,
    insertCapacityIntoConcertCard,
    decorateNextConcert,
  });

  decorateNextConcert();
})(typeof globalThis !== 'undefined' ? globalThis : this);
