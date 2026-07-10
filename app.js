'use strict';
// Mobile/PWA build of the Concert Tracker UI. This is adapted from the
// Chrome extension's popup.js — nearly all business logic and rendering is
// identical (same dataLib.js helpers, same screens). The only real change
// is the storage layer: `remote` (an { endpoint, token } pair pointing at a
// small Cloudflare Worker) replaces `dirHandle` (a FileSystemDirectoryHandle
// from the desktop-only File System Access API), and chrome.storage.local /
// chrome.runtime calls are shimmed by remoteStore.js instead of being real
// extension APIs. See SETUP.md for what the Worker/R2 side needs to look
// like before this will actually load data.

let remote = null;
let bands = [];
let concerts = [];
let currentTab = 'concerts';
let currentScreen = 'main'; // 'main' | 'profile' | 'settings'
let activeProfileBandId = null;
let editingBandId = null;
let europeOnly = false;
let nearbyOnly = false;
// Band-page filters are intentionally separate from the Concerts tab's
// europeOnly/nearbyOnly above: they're not persisted, and reset every time
// a band's page is opened, so browsing one band's tour dates filtered
// doesn't affect the main Concerts feed (or any other band's page).
let profileEuropeOnly = false;
let profileNearbyOnly = false;
let inactivityYears = 3;
let hideInactiveBands = false;

const el = (id) => document.getElementById(id);

const SEED_BANDS = [];
const SEED_CONCERTS = [];

async function init() {
  const { europeOnly: savedEuropeOnly = true, nearbyOnly: savedNearbyOnly = false } =
    await chrome.storage.local.get(['europeOnly', 'nearbyOnly']);
  europeOnly = !!savedEuropeOnly;
  nearbyOnly = !!savedNearbyOnly && !europeOnly; // filters are mutually exclusive
  const { inactivityYears: savedInactivityYears = 3, hideInactiveBands: savedHideInactive = false } =
    await chrome.storage.local.get(['inactivityYears', 'hideInactiveBands']);
  inactivityYears = Number(savedInactivityYears) || 3;
  hideInactiveBands = !!savedHideInactive;

  wireOnboarding();
  wireHeader();
  wireTabs();
  wireConnectionError();

  registerServiceWorker();

  const saved = rsGetConnection();
  if (!saved) {
    showOnboarding();
    return;
  }
  remote = saved;
  try {
    await loadDataAndShowApp();
  } catch (e) {
    // A saved connection that fails to load is most likely a temporary
    // network blip (elevator, subway, airplane mode) rather than a bad
    // token/URL — showing the connect form here would look like the app
    // "forgot" your setup. Show a lightweight retry state instead and only
    // send people back to the connect form if they deliberately choose
    // "Change connection" in Settings.
    showConnectionError();
  }
}

function showConnectionError() {
  el('onboarding').classList.add('hidden');
  el('app').classList.remove('hidden');
  el('tabbar').classList.add('hidden');
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  setHeaderChrome({ showBack: false, isBrand: true });
  showScreen('screen-connection-error');
}

function wireConnectionError() {
  el('retry-connect-btn').addEventListener('click', async () => {
    el('retry-connect-btn').textContent = 'Retrying…';
    try {
      await loadDataAndShowApp();
    } catch (e) {
      showConnectionError();
    } finally {
      el('retry-connect-btn').textContent = 'Retry';
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

function showOnboarding(errorMessage) {
  el('onboarding').classList.remove('hidden');
  el('app').classList.add('hidden');
  const saved = rsGetConnection();
  if (saved) {
    el('connect-endpoint').value = saved.endpoint || '';
    el('connect-token').value = saved.token || '';
  }
  const errEl = el('onboarding-error');
  if (errorMessage) {
    errEl.textContent = errorMessage;
    errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }
}

function wireOnboarding() {
  el('onboarding').querySelector('.onboarding-icon').innerHTML = icon('folder');
  el('connect-submit').addEventListener('click', async () => {
    const errEl = el('onboarding-error');
    errEl.classList.add('hidden');
    const endpoint = el('connect-endpoint').value.trim().replace(/\/$/, '');
    const token = el('connect-token').value.trim();
    if (!endpoint || !token) {
      errEl.textContent = 'Enter both the Worker URL and the access token.';
      errEl.classList.remove('hidden');
      return;
    }
    const candidate = { endpoint, token };
    try {
      const existingBands = await dlReadJsonFile(candidate, 'bands.json', null);
      if (existingBands === null) {
        await dlWriteJsonFile(candidate, 'bands.json', SEED_BANDS);
        await dlWriteJsonFile(candidate, 'concerts.json', SEED_CONCERTS);
      }
      rsSaveConnection(candidate);
      remote = candidate;
      await loadDataAndShowApp();
    } catch (e) {
      errEl.textContent = 'Could not connect. Check the URL and token, then try again.';
      errEl.classList.remove('hidden');
    }
  });
}

async function loadDataAndShowApp() {
  bands = await dlReadJsonFile(remote, 'bands.json', []);
  concerts = await dlReadJsonFile(remote, 'concerts.json', []);
  el('onboarding').classList.add('hidden');
  el('app').classList.remove('hidden');
  await updateHeaderBadge();
  // Only (re)establish the base screen when we're not already deeper in the
  // navigation stack (e.g. tapping "Refresh now" inside Settings shouldn't
  // bounce back out to the Concerts tab). Use replaceState rather than push
  // so this always sits at the bottom of the back-gesture stack.
  if (currentScreen === 'main') {
    history.replaceState({ tab: currentTab, screen: 'main' }, '');
    goToTab(currentTab, { fromHistory: true });
  }
}

async function updateHeaderBadge() {
  const { seenIds = [] } = await chrome.storage.local.get('seenIds');
  const unseenNew = concerts.filter((c) => c.isNew && dlIsUpcoming(c) && !seenIds.includes(c.id));
  const pill = el('new-badge');
  if (unseenNew.length > 0) {
    pill.textContent = `${unseenNew.length} new`;
    pill.classList.remove('hidden');
    const updated = [...new Set([...seenIds, ...unseenNew.map((c) => c.id)])];
    await chrome.storage.local.set({ seenIds: updated });
  } else {
    pill.classList.add('hidden');
  }
}

function wireHeader() {
  el('header-icon').innerHTML = icon('calendarBrand');
  el('back-btn').innerHTML = icon('back');
  el('settings-btn').innerHTML = icon('settings');
  el('europe-toggle-btn').textContent = 'EU';
  el('europe-toggle-btn').classList.toggle('active', europeOnly);
  el('nearby-toggle-btn').innerHTML = icon('nearbyPin');
  el('nearby-toggle-btn').classList.toggle('active', nearbyOnly);

  el('back-btn').addEventListener('click', () => {
    if (currentScreen === 'settings' || currentScreen === 'profile') {
      history.back();
    }
  });
  el('settings-btn').addEventListener('click', () => showSettingsScreen());
  el('europe-toggle-btn').addEventListener('click', async () => {
    europeOnly = !europeOnly;
    if (europeOnly) nearbyOnly = false; // EU and Nearby are mutually exclusive
    el('europe-toggle-btn').classList.toggle('active', europeOnly);
    el('nearby-toggle-btn').classList.toggle('active', nearbyOnly);
    await chrome.storage.local.set({ europeOnly, nearbyOnly });
    if (currentTab === 'concerts' && currentScreen === 'main') renderConcertsScreen();
  });
  el('nearby-toggle-btn').addEventListener('click', async () => {
    nearbyOnly = !nearbyOnly;
    if (nearbyOnly) europeOnly = false; // EU and Nearby are mutually exclusive
    el('nearby-toggle-btn').classList.toggle('active', nearbyOnly);
    el('europe-toggle-btn').classList.toggle('active', europeOnly);
    await chrome.storage.local.set({ europeOnly, nearbyOnly });
    if (currentTab === 'concerts' && currentScreen === 'main') renderConcertsScreen();
  });

  // Android/Chrome's system back gesture (and hardware/on-screen back
  // button) fires 'popstate' in a standalone PWA rather than exiting a
  // screen the way it does in a regular browser tab. Route it through the
  // same navigation functions the UI's own back button and tab bar use, so
  // swiping back steps through in-app screens instead of closing the app.
  window.addEventListener('popstate', (ev) => {
    const state = ev.state;
    if (!state) return;
    if (state.screen === 'profile' && state.bandId) {
      openProfile(state.bandId, { fromHistory: true });
    } else if (state.screen === 'settings') {
      showSettingsScreen({ fromHistory: true });
    } else {
      goToTab(state.tab || currentTab, { fromHistory: true });
    }
  });
}

const TAB_ICONS = { concerts: 'music', myconcerts: 'ticketStub', mybands: 'users' };
const TAB_TITLES = { concerts: 'ConcertDates', myconcerts: 'My Concerts', mybands: 'My Bands' };
const TAB_SCREENS = { concerts: 'screen-concerts', myconcerts: 'screen-myconcerts', mybands: 'screen-mybands' };
// Two-tone brand header markup per root tab (first part blue, rest white),
// matching the CONCERTDATES treatment.
const TAB_BRAND_HTML = {
  concerts: '<span class="brand-blue">CONCERT</span>DATES',
  myconcerts: '<span class="brand-blue">MY</span>CONCERTS',
  mybands: '<span class="brand-blue">MY</span>BANDS',
};

function wireTabs() {
  el('tabbar').querySelectorAll('.tabitem').forEach((btn) => {
    btn.querySelector('.tab-icon').innerHTML = icon(TAB_ICONS[btn.dataset.tab] || 'music');
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });
}

function setHeaderChrome({ showBack, title, isBrand = false, brandHtml }) {
  el('back-btn').classList.toggle('hidden', !showBack);
  el('settings-btn').classList.toggle('hidden', showBack);
  el('header-icon').classList.toggle('hidden', showBack);
  const titleEl = el('header-title');
  if (isBrand) {
    titleEl.innerHTML = brandHtml || '<span class="brand-blue">CONCERT</span>DATES';
  } else {
    titleEl.textContent = title;
  }
}

function goToTab(tab, { fromHistory = false } = {}) {
  currentTab = tab;
  currentScreen = 'main';
  el('tabbar').classList.remove('hidden');
  el('tabbar').querySelectorAll('.tabitem').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  setHeaderChrome({ showBack: false, title: TAB_TITLES[tab] || 'ConcertDates', isBrand: true, brandHtml: TAB_BRAND_HTML[tab] });
  el('europe-toggle-btn').classList.toggle('hidden', tab !== 'concerts');
  el('nearby-toggle-btn').classList.toggle('hidden', tab !== 'concerts');
  showScreen(TAB_SCREENS[tab] || 'screen-concerts');
  if (tab === 'concerts') renderConcertsScreen();
  else if (tab === 'myconcerts') renderMyConcertsScreen();
  else renderMyBandsScreen();
  if (!fromHistory) history.pushState({ tab, screen: 'main' }, '');
}

function showScreen(id) {
  ['screen-concerts', 'screen-myconcerts', 'screen-mybands', 'screen-profile', 'screen-settings', 'screen-connection-error'].forEach((s) => {
    el(s).classList.toggle('hidden', s !== id);
  });
  // All screens share one scrollable container (#content), so without this
  // a screen opened while scrolled down elsewhere (e.g. tapping a band from
  // partway down the Concerts list) would inherit that same scroll offset
  // instead of starting at the top.
  el('content').scrollTop = 0;
}

/* ---------------- Concerts tab ---------------- */

function renderWithYearDividers(items, rowRenderer, { showCount = false } = {}) {
  let yearCounts = null;
  if (showCount) {
    yearCounts = new Map();
    for (const item of items) {
      const year = (item.date || '').slice(0, 4);
      if (year) yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    }
  }
  let html = '';
  let lastYear = null;
  for (const item of items) {
    const year = (item.date || '').slice(0, 4);
    if (year && year !== lastYear) {
      const count = yearCounts?.get(year) || 0;
      const countHtml = showCount ? `<span class="year-divider-count">${count} ${count === 1 ? 'show' : 'shows'}</span>` : '';
      html += `<p class="section-label year-divider"><span>${escapeHtml(year)}</span><span class="year-divider-line"></span>${countHtml}</p>`;
      lastYear = year;
    }
    html += rowRenderer(item);
  }
  return html;
}

function renderConcertsScreen() {
  const container = el('screen-concerts');
  let nearest = dlNearestPerBand(concerts).filter((c) => bands.some((b) => b.id === c.bandId));
  if (europeOnly) nearest = nearest.filter((c) => dlIsEuropeCountry(c.country));
  else if (nearbyOnly) nearest = nearest.filter((c) => dlIsNearby(c));

  if (nearest.length === 0) {
    const emptyMsg = europeOnly
      ? 'No upcoming European concerts right now.'
      : nearbyOnly
        ? 'No upcoming concerts near you right now.'
        : "No upcoming concerts yet. They'll show up here after the next scheduled check.";
    container.innerHTML = `<p class="screen-empty">${emptyMsg}</p>`;
    return;
  }

  container.innerHTML = renderWithYearDividers(nearest, (c) => {
    const dateStr = formatDate(c.date, c.time);
    return `
        <div class="row-card clickable" data-band-id="${c.bandId}">
          <div class="row-top">
            <div class="row-title-group">
              <span class="row-name">${escapeHtml(c.bandName)}</span>
              ${c.attending ? `<span class="pill pill-going">${icon('check')} Going</span>` : ''}
            </div>
            <span class="row-chevron">${icon('chevronRight')}</span>
          </div>
          <p class="row-sub">${dateStr} · ${escapeHtml(c.venue)}, ${escapeHtml(c.city)}${c.country ? ', ' + escapeHtml(c.country) : ''}</p>
          <p class="row-km">${formatKm(c.distanceKm)} away</p>
        </div>`;
  }, { showCount: true });

  container.querySelectorAll('.row-card').forEach((row) => {
    row.addEventListener('click', () => openProfile(row.dataset.bandId));
  });
}

/* ---------------- My Concerts tab ---------------- */

function renderMyConcertsScreen() {
  const container = el('screen-myconcerts');
  const { upcoming, past } = dlMyConcerts(concerts);

  const bandOptions = [...bands]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.name)}</option>`)
    .join('');

  let html = '';

  if (upcoming.length === 0 && past.length === 0) {
    html += `<p class="screen-empty">No concerts saved yet. Tap "I'm going" on a band's page to add one, or backlog a past show below.</p>`;
  } else {
    if (upcoming.length > 0) {
      html += `<p class="section-label" style="margin-top:0">Upcoming concerts</p>`;
      html += renderWithYearDividers(upcoming, (c) => myConcertRowHtml(c, false), { showCount: true });
    }
    if (past.length > 0) {
      html += `<p class="section-label">Past concerts</p>`;
      html += renderWithYearDividers(past, (c) => myConcertRowHtml(c, true), { showCount: true });
    }
  }

  // Placed after the lists rather than above them — it's an occasional-use
  // form, not something to lead with every time this tab is opened.
  html += `
    <div class="row-card add-band-card" style="margin-top:18px">
      <p class="section-label" style="margin-top:0">Add a past concert</p>
      <select id="past-concert-band">
        <option value="">Select a band…</option>
        ${bandOptions}
      </select>
      <input type="text" id="past-concert-venue" placeholder="Venue" />
      <div class="form-row">
        <input type="text" id="past-concert-city" placeholder="City" />
        <input type="text" id="past-concert-country" placeholder="Country (optional)" />
      </div>
      <input type="text" id="past-concert-address" placeholder="Venue address (optional, for calendar)" />
      <input type="date" id="past-concert-date" />
      <button id="past-concert-submit" class="btn-primary btn-block">${icon('plus')}Add past concert</button>
      <p id="past-concert-error" class="error hidden" style="color:var(--danger);font-size:11.5px;margin:6px 0 0"></p>
    </div>`;

  container.innerHTML = html;
  wireMyConcertsHandlers(container);
}

function myConcertRowHtml(c, isPast) {
  return `
    <div class="row-card clickable has-corner-delete${isPast ? ' is-past' : ''}" data-band-id="${c.bandId}">
      <div class="row-top">
        <div class="row-title-group">
          <span class="row-name">${escapeHtml(c.bandName)}</span>
          ${isPast ? `<span class="pill pill-attended">${icon('check')} Attended</span>` : ''}
        </div>
        <span class="row-chevron">${icon('chevronRight')}</span>
      </div>
      <p class="row-sub">${formatDate(c.date, c.time)} · ${escapeHtml(c.venue)}, ${escapeHtml(c.city)}${c.country ? ', ' + escapeHtml(c.country) : ''}</p>
      ${c.distanceKm !== null && c.distanceKm !== undefined ? `<p class="row-km">${formatKm(c.distanceKm)} away</p>` : ''}
      ${c.venueAddress ? `
      <details class="venue-details">
        <summary>Venue details<span class="details-chevron">${icon('chevronDown')}</span></summary>
        <a class="venue-address-text" href="${escapeAttr(buildGoogleMapsUrl(c))}" target="_blank" rel="noopener"><span class="map-pin-icon">${icon('mapPin')}</span>${escapeHtml(c.venueAddress)}</a>
      </details>` : ''}
      <button class="icon-btn remove-going-btn delete-corner-btn" data-concert-id="${c.id}" aria-label="Remove">${icon('trash')}</button>
    </div>`;
}

function buildGoogleMapsUrl(c) {
  const query = c.venueAddress
    ? `${c.venue}, ${c.venueAddress}`
    : [c.venue, c.city, c.country].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function wireMyConcertsHandlers(container) {
  container.querySelector('#past-concert-submit')?.addEventListener('click', onAddPastConcert);

  container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('.icon-btn') || ev.target.closest('.venue-details')) return;
      openProfile(row.dataset.bandId);
    });
  });

  container.querySelectorAll('.remove-going-btn').forEach((b) => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const concertId = b.dataset.concertId;
      const c = concerts.find((x) => x.id === concertId);
      if (!c) return;
      if (c.manuallyAdded) {
        if (!confirm('Remove this concert from your history? This deletes it completely since it was added by hand.')) return;
        concerts = concerts.filter((x) => x.id !== concertId);
      } else {
        c.attending = false;
      }
      await dlWriteJsonFile(remote, 'concerts.json', concerts);
      renderMyConcertsScreen();
    });
  });
}

async function onAddPastConcert() {
  const bandSel = el('past-concert-band');
  const venueInput = el('past-concert-venue');
  const cityInput = el('past-concert-city');
  const countryInput = el('past-concert-country');
  const addressInput = el('past-concert-address');
  const dateInput = el('past-concert-date');
  const errEl = el('past-concert-error');
  errEl.classList.add('hidden');

  const bandId = bandSel.value;
  const venue = venueInput.value.trim();
  const city = cityInput.value.trim();
  const country = countryInput.value.trim();
  const venueAddress = addressInput.value.trim();
  const date = dateInput.value;

  if (!bandId || !venue || !city || !date) {
    errEl.textContent = 'Band, venue, city and date are required.';
    errEl.classList.remove('hidden');
    return;
  }

  const band = bands.find((b) => b.id === bandId);
  if (!band) return;

  let id = `${bandId}-${date}-${dlSlugify(city)}`;
  if (concerts.some((c) => c.id === id)) id = `${id}-${Math.floor(Math.random() * 1000)}`;

  const concert = {
    id, bandId, bandName: band.name,
    venue, venueAddress: venueAddress || null, city, country: country || null,
    date, time: null, distanceKm: null,
    articleUrl: null, ticketUrl: null, ticketRetailerVerified: false,
    isNew: false, foundAt: new Date().toISOString(),
    attending: true, manuallyAdded: true,
  };
  concerts.push(concert);
  await dlWriteJsonFile(remote, 'concerts.json', concerts);

  bandSel.value = '';
  venueInput.value = '';
  cityInput.value = '';
  countryInput.value = '';
  addressInput.value = '';
  dateInput.value = '';
  renderMyConcertsScreen();
}

/* ---------------- My bands tab ---------------- */

function renderMyBandsScreen() {
  const container = el('screen-mybands');
  let sorted = [...bands].sort((a, b) => a.name.localeCompare(b.name));
  const activityById = new Map(sorted.map((b) => [b.id, dlBandActivity(b, concerts, inactivityYears)]));
  if (hideInactiveBands) sorted = sorted.filter((b) => activityById.get(b.id).status === 'active');

  let html = `
    <div class="filter-row">
      <span class="filter-label">Hide inactive bands</span>
      <button id="hide-inactive-toggle" class="toggle-pill${hideInactiveBands ? ' active' : ''}">${hideInactiveBands ? 'On' : 'Off'}</button>
    </div>`;

  let lastLetter = '';
  for (const band of sorted) {
    const letter = band.name[0]?.toUpperCase() || '#';
    if (letter !== lastLetter) {
      html += `<p class="section-label">${letter}</p>`;
      lastLetter = letter;
    }
    if (editingBandId === band.id) {
      html += `
        <div class="row-card" data-editing="${band.id}">
          <input type="text" class="edit-name" value="${escapeAttr(band.name)}" placeholder="Band name" />
          <input type="url" class="edit-url" value="${escapeAttr(band.officialUrl || '')}" placeholder="Official band URL" />
          <div class="show-buttons" style="margin-top:8px">
            <button class="btn-primary edit-save">Save</button>
            <button class="btn-secondary edit-cancel">Cancel</button>
          </div>
        </div>`;
    } else {
      const activity = activityById.get(band.id);
      html += `
        <div class="row-card clickable" data-band-id="${band.id}">
          <div class="row-top">
            <div class="row-title-group">
              <span class="row-name">${escapeHtml(band.name)}${band._enriching ? ' <span class="muted" style="font-weight:400">· fetching info…</span>' : ''}</span>
              ${activityBadgeHtml(activity)}
            </div>
            <div class="row-actions">
              <button class="icon-btn edit-btn" data-band-id="${band.id}" aria-label="Edit">${icon('edit')}</button>
              <button class="icon-btn trash-btn" data-band-id="${band.id}" aria-label="Remove">${icon('trash')}</button>
              <span class="row-chevron">${icon('chevronRight')}</span>
            </div>
          </div>
          ${activity.status !== 'active' ? `<p class="row-sub">${activity.status === 'unknown' ? 'No concerts on record' : `Last known show · ${activity.lastYear}`}</p>` : ''}
        </div>`;
    }
  }

  if (sorted.length === 0) {
    html += `<p class="screen-empty">${hideInactiveBands ? 'No active bands to show — turn off the filter above to see them all.' : 'No bands yet — add your first one below.'}</p>`;
  }

  // Placed after the list, same as "Add a past concert" on My Concerts —
  // an occasional-use form shouldn't be the first thing you see here.
  html += `
    <div class="row-card add-band-card" style="margin-top:18px">
      <p class="section-label" style="margin-top:0">Add a band</p>
      <input type="text" id="add-band-name" placeholder="Band name" />
      <input type="url" id="add-band-url" placeholder="Official band URL (optional)" />
      <button id="add-band-submit" class="btn-primary btn-block">${icon('plus')}Add band</button>
      <p id="add-band-error" class="error hidden" style="color:var(--danger);font-size:11.5px;margin:6px 0 0"></p>
    </div>`;

  container.innerHTML = html;
  wireMyBandsHandlers(container);
}

function activityBadgeHtml(activity) {
  if (activity.status === 'unknown') return `<span class="pill pill-unknown">${icon('moon')}No shows found</span>`;
  if (activity.status === 'inactive') return `<span class="pill pill-inactive">${icon('moon')}Inactive</span>`;
  return '';
}

function wireMyBandsHandlers(container) {
  container.querySelector('#add-band-submit')?.addEventListener('click', onAddBand);
  container.querySelector('#hide-inactive-toggle')?.addEventListener('click', async () => {
    hideInactiveBands = !hideInactiveBands;
    await chrome.storage.local.set({ hideInactiveBands });
    renderMyBandsScreen();
  });

  container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('.icon-btn')) return;
      openProfile(row.dataset.bandId);
    });
  });
  container.querySelectorAll('.edit-btn').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      editingBandId = b.dataset.bandId;
      renderMyBandsScreen();
    })
  );
  container.querySelectorAll('.trash-btn').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (confirm('Remove this band from your list?')) {
        bands = bands.filter((x) => x.id !== b.dataset.bandId);
        await dlWriteJsonFile(remote, 'bands.json', bands);
        renderMyBandsScreen();
      }
    })
  );
  container.querySelectorAll('[data-editing]').forEach((row) => {
    const bandId = row.dataset.editing;
    row.querySelector('.edit-save').addEventListener('click', async () => {
      const name = row.querySelector('.edit-name').value.trim();
      const url = row.querySelector('.edit-url').value.trim();
      if (!name) return;
      const band = bands.find((x) => x.id === bandId);
      band.name = name;
      band.officialUrl = url || null;
      await dlWriteJsonFile(remote, 'bands.json', bands);
      editingBandId = null;
      renderMyBandsScreen();
    });
    row.querySelector('.edit-cancel').addEventListener('click', () => {
      editingBandId = null;
      renderMyBandsScreen();
    });
  });
}

async function onAddBand() {
  const nameInput = el('add-band-name');
  const urlInput = el('add-band-url');
  const errEl = el('add-band-error');
  const name = nameInput.value.trim();
  let url = urlInput.value.trim();
  errEl.classList.add('hidden');

  if (!name) {
    errEl.textContent = 'Enter a band name.';
    errEl.classList.remove('hidden');
    return;
  }
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;

  let id = dlSlugify(name);
  if (bands.some((b) => b.id === id)) id = `${id}-${Math.floor(Math.random() * 1000)}`;

  const band = {
    id, name, officialUrl: url || null,
    photoUrl: null, genre: null, origin: null, formedYear: null, bio: null,
    socials: {}, addedAt: new Date().toISOString(), enrichedAt: null,
    _enriching: true,
  };
  bands.push(band);
  await dlWriteJsonFile(remote, 'bands.json', stripTransient(bands));
  nameInput.value = '';
  urlInput.value = '';
  renderMyBandsScreen();

  enrichBand(band.id);
}

function stripTransient(list) {
  return list.map(({ _enriching, ...rest }) => rest);
}

/* ---------------- Band profile screen ---------------- */

function openProfile(bandId, { fromHistory = false } = {}) {
  activeProfileBandId = bandId;
  currentScreen = 'profile';
  profileEuropeOnly = false;
  profileNearbyOnly = false;
  const band = bands.find((b) => b.id === bandId);
  setHeaderChrome({ showBack: true, title: band ? band.name : 'Band' });
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  showScreen('screen-profile');
  renderProfileScreen(bandId);
  if (!fromHistory) history.pushState({ tab: currentTab, screen: 'profile', bandId }, '');
}

function renderProfileScreen(bandId) {
  const band = bands.find((b) => b.id === bandId);
  const container = el('screen-profile');
  if (!band) {
    container.innerHTML = `<p class="screen-empty">Band not found.</p>`;
    return;
  }
  const shows = dlAllUpcomingForBand(concerts, bandId);
  let filteredShows = shows;
  if (profileEuropeOnly) filteredShows = filteredShows.filter((c) => dlIsEuropeCountry(c.country));
  else if (profileNearbyOnly) filteredShows = filteredShows.filter((c) => dlIsNearby(c));
  const initials = band.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const activity = dlBandActivity(band, concerts, inactivityYears);

  const metaParts = [band.genre, [band.origin, band.formedYear ? `formed ${band.formedYear}` : null].filter(Boolean).join(', ')].filter(Boolean);
  if (activity.lastDate) {
    metaParts.push(`${activity.status === 'active' && activity.lastDate > new Date() ? 'next show' : 'last show'} ${activity.lastYear}`);
  }

  const socialButtons = [];
  if (band.socials?.instagram) socialButtons.push(linkIconBtn(band.socials.instagram, 'instagram'));
  if (band.socials?.spotify) socialButtons.push(linkIconBtn(band.socials.spotify, 'spotify'));

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">${band.photoUrl ? `<img src="${escapeAttr(band.photoUrl)}" alt="" />` : initials}</div>
      <div>
        <div class="profile-name-row">
          <p class="profile-name">${escapeHtml(band.name)}</p>
          ${activityBadgeHtml(activity)}
        </div>
        ${metaParts.length ? `<p class="profile-meta">${escapeHtml(metaParts.join(' · '))}</p>` : ''}
      </div>
    </div>
    ${band._enriching ? `<p class="muted" style="font-size:12px;margin:-4px 0 10px">Fetching band info…</p>` : ''}
    <div class="profile-links">
      ${band.officialUrl ? `<a class="btn-primary" href="${escapeAttr(band.officialUrl)}" target="_blank" rel="noopener">${icon('link')}Official site</a>` : ''}
      ${socialButtons.join('')}
    </div>
    ${band.bio ? `<p class="profile-bio">${escapeHtml(band.bio)}</p>` : ''}
    <div class="profile-divider">
      <div class="section-label-row">
        <p class="section-label" style="margin:0">Upcoming shows</p>
        ${shows.length > 0 ? `
          <div class="section-label-filters">
            <button id="profile-nearby-toggle-btn" class="icon-btn${profileNearbyOnly ? ' active' : ''}" aria-label="Show nearby only" title="Show nearby only">${icon('nearbyPin')}</button>
            <button id="profile-europe-toggle-btn" class="icon-btn${profileEuropeOnly ? ' active' : ''}" aria-label="Show Europe only" title="Show Europe only">EU</button>
          </div>
        ` : ''}
      </div>
      ${shows.length === 0
        ? `<p class="screen-empty" style="padding:16px 0">No upcoming shows tracked yet.</p>`
        : filteredShows.length === 0
          ? `<p class="screen-empty" style="padding:16px 0">${profileEuropeOnly ? 'No upcoming European shows for this band right now.' : 'No upcoming shows near you for this band right now.'}</p>`
          : filteredShows.map(showRowHtml).join('')}
    </div>
  `;

  container.querySelectorAll('a').forEach((a) => a.addEventListener('click', (ev) => ev.stopPropagation()));
  container.querySelector('#profile-europe-toggle-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    profileEuropeOnly = !profileEuropeOnly;
    if (profileEuropeOnly) profileNearbyOnly = false;
    renderProfileScreen(bandId);
  });
  container.querySelector('#profile-nearby-toggle-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    profileNearbyOnly = !profileNearbyOnly;
    if (profileNearbyOnly) profileEuropeOnly = false;
    renderProfileScreen(bandId);
  });
  container.querySelectorAll('.going-btn').forEach((b) => {
    b.addEventListener('click', async () => {
      await toggleAttending(b.dataset.concertId);
      renderProfileScreen(bandId);
    });
  });
}

function showRowHtml(c) {
  const going = !!c.attending;
  return `
    <div class="row-card">
      <p class="row-name" style="font-size:13px">${escapeHtml(c.venue)}, ${escapeHtml(c.city)}${c.country ? ', ' + escapeHtml(c.country) : ''}</p>
      <p class="row-km">${formatDate(c.date, c.time)} · ${formatKm(c.distanceKm)}</p>
      ${c.venueAddress ? `
      <details class="venue-details">
        <summary>Venue details<span class="details-chevron">${icon('chevronDown')}</span></summary>
        <a class="venue-address-text" href="${escapeAttr(buildGoogleMapsUrl(c))}" target="_blank" rel="noopener"><span class="map-pin-icon">${icon('mapPin')}</span>${escapeHtml(c.venueAddress)}</a>
      </details>` : ''}
      <div class="show-buttons">
        <div class="show-buttons-group">
          ${c.articleUrl ? `<a class="btn-secondary" href="${escapeAttr(c.articleUrl)}" target="_blank" rel="noopener">${icon('link')}Article</a>` : ''}
          ${c.ticketUrl ? `<a class="btn-primary" href="${escapeAttr(c.ticketUrl)}" target="_blank" rel="noopener">${icon('ticket')}Tickets</a>` : `<span class="muted" style="font-size:11.5px">Tickets not on sale yet</span>`}
        </div>
        <div class="show-buttons-group">
          <button class="${going ? 'btn-primary' : 'btn-secondary'} going-btn" data-concert-id="${c.id}">${icon(going ? 'check' : 'plus')}${going ? 'Going' : "I'm going"}</button>
          <a class="btn-secondary" href="${escapeAttr(buildGoogleCalendarUrl(c))}" target="_blank" rel="noopener">${icon('calendarPlus')}Add to calendar</a>
        </div>
      </div>
      ${c.ticketUrl && c.ticketRetailerVerified === false ? `<p class="settings-hint" style="color:var(--danger)">Unverified retailer — double-check before buying</p>` : ''}
    </div>`;
}

function buildGoogleCalendarUrl(c) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDateTime = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const fmtDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  const [y, m, d] = c.date.split('-').map(Number);
  let datesParam;
  if (c.time) {
    const [hh, mm] = c.time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh || 0, mm || 0);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    datesParam = `${fmtDateTime(start)}/${fmtDateTime(end)}`;
  } else {
    const start = new Date(y, m - 1, d);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    datesParam = `${fmtDate(start)}/${fmtDate(end)}`;
  }

  const location = c.venueAddress
    ? `${c.venue}, ${c.venueAddress}`
    : [c.venue, c.city, c.country].filter(Boolean).join(', ');
  const detailsLines = [];
  if (c.ticketUrl) detailsLines.push(`Tickets: ${c.ticketUrl}`);
  if (c.articleUrl) detailsLines.push(`Info: ${c.articleUrl}`);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${c.bandName} — ${c.venue}`,
    dates: datesParam,
    location,
    details: detailsLines.join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function toggleAttending(concertId) {
  const c = concerts.find((x) => x.id === concertId);
  if (!c) return;
  c.attending = !c.attending;
  await dlWriteJsonFile(remote, 'concerts.json', concerts);
}

function linkIconBtn(url, name) {
  return `<a class="icon-btn" style="border:1px solid var(--border-strong)" href="${escapeAttr(url)}" target="_blank" rel="noopener">${icon(name)}</a>`;
}

/* ---------------- Settings screen ---------------- */

function showSettingsScreen({ fromHistory = false } = {}) {
  currentScreen = 'settings';
  setHeaderChrome({ showBack: true, title: 'Settings' });
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  showScreen('screen-settings');
  renderSettingsScreen();
  if (!fromHistory) history.pushState({ tab: currentTab, screen: 'settings' }, '');
}

async function renderSettingsScreen() {
  let { groqApiKey = '', groqApiKeyAddedAt = null } = await chrome.storage.local.get(['groqApiKey', 'groqApiKeyAddedAt']);
  if (groqApiKey && !groqApiKeyAddedAt) {
    groqApiKeyAddedAt = new Date().toISOString();
    await chrome.storage.local.set({ groqApiKeyAddedAt });
  }
  const container = el('screen-settings');
  const savedKeyInfo = groqApiKey
    ? `<p class="muted" style="font-size:12px;margin:0 0 8px">
         Current key: <strong>${escapeHtml(maskApiKey(groqApiKey))}</strong>
         ${groqApiKeyAddedAt ? ` · added ${escapeHtml(formatSettingsDate(groqApiKeyAddedAt))}` : ''}
       </p>`
    : '';
  container.innerHTML = `
    <div class="settings-field">
      <label>Connection</label>
      <p class="muted" style="font-size:12px;margin:0 0 8px">${escapeHtml(remote?.endpoint || 'Not connected')}${remote?.token ? ` · ${escapeHtml(maskApiKey(remote.token))}` : ''}</p>
      <button id="change-connection-btn" class="btn-secondary">Change connection</button>
    </div>
    <div class="settings-field">
      <label>Groq API key (optional)</label>
      ${savedKeyInfo}
      <input type="password" id="groq-key-input" value="" placeholder="${groqApiKey ? 'Enter a new key to replace it' : 'For faster, more reliable band-info lookups'}" />
      <p class="settings-hint">Used to fill in genre, bio and links when you add a band. Leave blank to use a free fallback (slower, less reliable).</p>
      <div class="show-buttons" style="margin-top:8px">
        <button id="save-groq-key" class="btn-primary">Save</button>
        ${groqApiKey ? `<button id="remove-groq-key" class="btn-secondary btn-danger">Remove key</button>` : ''}
      </div>
      <span id="groq-save-status" class="settings-hint"></span>
    </div>
    <div class="settings-field">
      <label>Inactive after</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="inactivity-years-input" class="narrow-input" min="1" max="10" step="1" value="${inactivityYears}" />
        <span class="muted" style="font-size:12px">years with no known or upcoming shows</span>
      </div>
      <p class="settings-hint">Bands past this get an "Inactive" flag in My Bands and on their profile. Updates automatically as new tour dates come in.</p>
    </div>
    <div class="settings-field">
      <button id="recheck-btn" class="btn-secondary btn-block">Refresh now</button>
      <p class="settings-hint">Re-fetches bands.json/concerts.json from your Worker. Doesn't run new research — that still happens on your scheduled Claude task, which writes to the same storage.</p>
    </div>
  `;

  el('change-connection-btn').addEventListener('click', () => {
    showOnboarding();
  });

  el('save-groq-key').addEventListener('click', async () => {
    const val = el('groq-key-input').value.trim();
    if (!val) {
      el('groq-save-status').textContent = 'Enter a key to save, or use Remove key to clear it.';
      setTimeout(() => (el('groq-save-status').textContent = ''), 2500);
      return;
    }
    await chrome.storage.local.set({ groqApiKey: val, groqApiKeyAddedAt: new Date().toISOString() });
    el('groq-save-status').textContent = 'Saved.';
    setTimeout(() => (el('groq-save-status').textContent = ''), 1500);
    renderSettingsScreen();
  });

  el('remove-groq-key')?.addEventListener('click', async () => {
    await chrome.storage.local.remove(['groqApiKey', 'groqApiKeyAddedAt']);
    renderSettingsScreen();
  });

  el('inactivity-years-input').addEventListener('change', async (ev) => {
    const val = Math.max(1, Math.min(10, parseInt(ev.target.value, 10) || 3));
    inactivityYears = val;
    ev.target.value = val;
    await chrome.storage.local.set({ inactivityYears: val });
  });

  el('recheck-btn').addEventListener('click', async () => {
    el('recheck-btn').textContent = 'Refreshing…';
    try {
      await loadDataAndShowApp();
      showSettingsScreen({ fromHistory: true });
      el('recheck-btn').textContent = 'Refreshed.';
    } catch {
      el('recheck-btn').textContent = 'Could not refresh — check connection.';
    }
    setTimeout(() => {
      const btn = el('recheck-btn');
      if (btn) btn.textContent = 'Refresh now';
    }, 1800);
  });
}

/* ---------------- Enrichment (runs on add) ---------------- */

async function enrichBand(bandId) {
  const band = bands.find((b) => b.id === bandId);
  if (!band) return;

  let homepage = null;
  if (band.officialUrl) {
    homepage = await fetchHomepageInfo(band.officialUrl).catch(() => null);
  }
  const wikiText = await fetchWikipediaText(band.name).catch(() => null);
  const { groqApiKey = '' } = await chrome.storage.local.get('groqApiKey');

  const prompt = buildEnrichPrompt(band.name, homepage, wikiText);
  let ai = null;
  try {
    ai = groqApiKey ? await callGroq(prompt, groqApiKey) : await callPollinations(prompt);
  } catch {
    ai = null;
  }

  if (ai) {
    band.genre = clean(ai.genre) || band.genre;
    band.origin = clean(ai.origin) || band.origin;
    band.formedYear = clean(ai.formedYear) || band.formedYear;
    band.bio = clean(ai.bio) || band.bio;
  }
  if (homepage) {
    band.photoUrl = band.photoUrl || homepage.image || null;
    band.socials = {
      instagram: homepage.instagram || band.socials?.instagram || null,
      spotify: homepage.spotify || band.socials?.spotify || null,
    };
  }
  band.enrichedAt = new Date().toISOString();
  band._enriching = false;

  await dlWriteJsonFile(remote, 'bands.json', stripTransient(bands));
  if (currentScreen === 'profile' && activeProfileBandId === bandId) renderProfileScreen(bandId);
  if (currentScreen === 'main' && currentTab === 'mybands') renderMyBandsScreen();
}

async function fetchHomepageInfo(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const findSocial = (domain) => {
      for (const a of doc.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        if (href.includes(domain)) return href;
      }
      return null;
    };
    const description =
      doc.querySelector('meta[name="description"]')?.content ||
      doc.querySelector('meta[property="og:description"]')?.content || '';
    const image = doc.querySelector('meta[property="og:image"]')?.content || null;
    const bodyText = (doc.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    return {
      title: doc.title || '', description, image,
      instagram: findSocial('instagram.com'),
      spotify: findSocial('open.spotify.com'),
      bodyText,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWikipediaText(name) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&format=json&origin=*`;
  const sr = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
  if (!sr.ok) return null;
  const sd = await sr.json();
  const title = sd[1]?.[0];
  if (!title) return null;
  const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const wr = await fetch(sumUrl, { signal: AbortSignal.timeout(6000) });
  if (!wr.ok) return null;
  const wd = await wr.json();
  return wd.extract?.slice(0, 500) || null;
}

function buildEnrichPrompt(name, homepage, wikiText) {
  return `You are a music research assistant. Return ONLY valid JSON, nothing else:
{"genre":"one or two words or null","origin":"country or null","formedYear":"year or null","bio":"max 2 sentences, or null"}
Band name: ${name}
Official site title: ${homepage?.title || 'unknown'}
Official site description: ${homepage?.description || 'unknown'}
Official site excerpt: ${homepage?.bodyText || 'unknown'}
Wikipedia summary: ${wikiText || 'not found'}
Use Wikipedia and the official site as ground truth. If nothing is known, use your own knowledge of the band. Use null only if truly unknown.`;
}

async function callGroq(prompt, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2, max_tokens: 300,
      }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Not JSON');
    return JSON.parse(m[0]);
  } finally {
    clearTimeout(timer);
  }
}

async function callPollinations(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'mistral', seed: 42, jsonMode: true }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Not JSON');
    return JSON.parse(m[0]);
  } finally {
    clearTimeout(timer);
  }
}

function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || ['null', 'n/a', 'undefined', '-'].includes(s.toLowerCase())) return null;
  return s;
}

/* ---------------- Utilities ---------------- */

function formatDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  const s = d.toLocaleDateString('en-GB', opts);
  return timeStr ? `${s}, ${timeStr}` : s;
}

function formatKm(km) {
  if (km === null || km === undefined) return 'Distance unknown';
  return `${Math.round(km).toLocaleString()} km`;
}

function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return `${key[0]}••••${key[key.length - 1]}`;
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

function formatSettingsDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

document.addEventListener('DOMContentLoaded', init);
