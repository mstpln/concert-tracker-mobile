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
let news = [];
let apiUsage = null;
let alertsLastOpenedAt = null;
let newsSubTab = 'news'; // 'news' | 'alerts'
let currentTab = 'myconcerts';
let currentScreen = 'main'; // 'main' | 'profile' | 'settings' | 'stats' | 'connection-error' (only reachable pre-navigation)
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
let selectedGenre = 'all';
let mutedOnly = false;
// Venues sub-tab (Concerts tab). Not persisted across reloads, same as
// newsSubTab above — always starts back on the plain Concerts list.
let concertsSubTab = 'concerts'; // 'concerts' | 'venues'
let venuesNearbyOnly = false;
let venuesEuropeOnly = false;
// Scoped exactly as clarified with the user: concerts at these venues that
// are in the past AND were attended by me (the same set My Concerts' "Past
// concerts" list uses), not just any already-happened date regardless of
// attendance.
let venuesPastOnly = false;
let activeVenueKey = null;
const weatherViews = new Map(); // browser-local, transient UI state only
const playlistReviews = new Map(); // transient selections only; never concert data
const playlistOperations = new Map();
const prepOpenPanels = new Map(); // browser-local accordion state only; never concert data
const ticketPanelViews = new Map(); // add/edit form state only; never concert data
const ticketOperations = new Map();
const ticketCacheStatus = new Map();
const ticketNotices = new Map();
let spotifyAuthMessage = '';
// Settings starts on Research each time it is opened. These are deliberately
// browser-local display choices, never stored with the user's concert data.
let settingsTab = 'research';
let settingsExpandedTool = null;

const el = (id) => document.getElementById(id);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SEED_BANDS = [];
const SEED_CONCERTS = [];
const SEED_NEWS = [];

// The weekly research pipeline's provider keys live only as GitHub
// Actions secrets — by design, secret values can never be read back once
// saved, so there's no way for this app to fetch them live. This is a
// small static record of what was saved, filled in once at setup time.
// Deliberately has no "added" date: an earlier version of this record
// stamped all three keys with the date this code was last edited (not the
// real secret-creation date, which isn't knowable), which was misleading —
// see QA pass notes. If a key is ever rotated, update the masked value here
// to match.
const RESEARCH_KEY_METADATA = {
  ticketmaster: { label: 'Ticketmaster API key', masked: 'iS4B••••••••sraA' },
  tavily: { label: 'Tavily API key', masked: 'tvly••••••••yzt0' },
  groq: { label: 'Groq API key (research pipeline)', masked: 'gsk_••••••••rhcu' },
  setlistfm: { label: 'setlist.fm API key', masked: 'lM9u••••••••oLZB' },
  // Client ID: no masked digits — this app never saw the real value (it was
  // entered directly into GitHub Actions secrets by hand, per the "never
  // enter API keys on your behalf" rule), so there's nothing real to mask.
  spotifyClientId: { label: 'Spotify Client ID', masked: 'configured via GitHub secrets' },
  // Client Secret: unlike the other keys above, the real add-date IS known
  // here (2026-07-13, this build) rather than guessed — so, unlike the
  // no-date policy those follow (see the QA-pass note above), it's included
  // here since it's actually accurate. Now a structured field (addedAt)
  // rather than baked into the masked string, so the Settings usage cards
  // can render it as its own row.
  spotifyClientSecret: { label: 'Spotify Client Secret', masked: 'cafa••••••••ff48', addedAt: '2026-07-13' },
};

async function init() {
  const { europeOnly: savedEuropeOnly = true, nearbyOnly: savedNearbyOnly = false } =
    await chrome.storage.local.get(['europeOnly', 'nearbyOnly']);
  europeOnly = !!savedEuropeOnly;
  nearbyOnly = !!savedNearbyOnly && !europeOnly; // filters are mutually exclusive
  const { inactivityYears: savedInactivityYears = 3, hideInactiveBands: savedHideInactive = false } =
    await chrome.storage.local.get(['inactivityYears', 'hideInactiveBands']);
  inactivityYears = Number(savedInactivityYears) || 3;
  hideInactiveBands = !!savedHideInactive;
  const { selectedGenre: savedSelectedGenre = 'all' } = await chrome.storage.local.get('selectedGenre');
  selectedGenre = savedSelectedGenre || 'all';
  const { mutedOnly: savedMutedOnly = false } = await chrome.storage.local.get('mutedOnly');
  mutedOnly = !!savedMutedOnly;
  const {
    venuesNearbyOnly: savedVenuesNearby = false,
    venuesEuropeOnly: savedVenuesEurope = false,
    venuesPastOnly: savedVenuesPast = false,
  } = await chrome.storage.local.get(['venuesNearbyOnly', 'venuesEuropeOnly', 'venuesPastOnly']);
  venuesNearbyOnly = !!savedVenuesNearby && !savedVenuesEurope;
  venuesEuropeOnly = !!savedVenuesEurope;
  venuesPastOnly = !!savedVenuesPast;
  const { alertsLastOpenedAt: savedAlertsLastOpenedAt = null } = await chrome.storage.local.get('alertsLastOpenedAt');
  alertsLastOpenedAt = savedAlertsLastOpenedAt;
  const spotifyCallback = await SpotifyUser.handleCallback();
  if (spotifyCallback.kind === 'error') spotifyAuthMessage = spotifyCallback.message;
  if (spotifyCallback.kind === 'ok') spotifyAuthMessage = 'Spotify connected.';

  wireOnboarding();
  wireHeader();
  wireTabs();
  wireConnectionError();

  registerServiceWorker();
  setInterval(tickCountdownCard, 1000);

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
        await dlWriteJsonFile(candidate, 'news.json', SEED_NEWS);
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
  news = await dlReadJsonFile(remote, 'news.json', []);
  // Written by the weekly GitHub Actions research pipeline, not by this
  // app — read-only here, just to power the usage counters in Settings.
  apiUsage = await dlReadJsonFile(remote, 'apiUsage.json', null);
  el('onboarding').classList.add('hidden');
  el('app').classList.remove('hidden');
  updateAlertsBadge();
  // Only (re)establish the base screen when we're not already deeper in the
  // navigation stack (e.g. tapping "Refresh now" inside Settings shouldn't
  // bounce back out to the Concerts tab). Use replaceState rather than push
  // so this always sits at the bottom of the back-gesture stack.
  if (currentScreen === 'main') {
    history.replaceState({ tab: currentTab, screen: 'main' }, '');
    goToTab(currentTab, { fromHistory: true });
  }
}

// Alerts unread indicator — a single red dot on the Alerts tab icon, not a
// per-item count. It clears specifically when the Alerts sub-view is opened
// (not just the News tab in general), so it only ever means "a new show
// arrived since you last actually looked at Alerts". This replaces the old
// header "X new" pill + seenIds tracking, which covered the exact same
// concept (newly-discovered concerts) through a separate mechanism that
// could drift out of sync with this one — one source of truth now instead
// of two.
// "Tour Announcement Summary": dates discovered in the same research run
// for the same band (identical bandId+foundAt) are collapsed into one
// batch card instead of flooding the list with one row per date — a 26-date
// tour used to mean 26 near-identical "New show added" rows. A band with
// only one new date still gets its own plain row, unchanged from before.
function getAlertItems() {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const raw = concerts
    .filter((c) => !c.manuallyAdded && c.foundAt && bands.some((b) => b.id === c.bandId))
    // Muting a band suppresses its "new show added" alerts too, not just the
    // Concerts tab discovery feed — see dlNearestPerBand's caller below for
    // the matching filter on that side.
    .filter((c) => !bands.find((b) => b.id === c.bandId)?.muted)
    .filter((c) => new Date(c.foundAt).getTime() >= cutoff);

  const byBatch = new Map();
  for (const c of raw) {
    const key = `${c.bandId}|${c.foundAt}`;
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(c);
  }

  const items = [];
  for (const group of byBatch.values()) {
    if (group.length === 1) {
      items.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => new Date(a.date) - new Date(b.date));
    items.push({
      isBatch: true,
      bandId: sorted[0].bandId,
      bandName: sorted[0].bandName,
      foundAt: sorted[0].foundAt,
      count: sorted.length,
      nearbyCount: sorted.filter(dlIsNearby).length,
      europeCount: sorted.filter((c) => dlIsEuropeCountry(c.country)).length,
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
    });
  }
  return items.sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''));
}

function updateAlertsBadge() {
  const hasUnread = getAlertItems().some((c) => !alertsLastOpenedAt || c.foundAt > alertsLastOpenedAt);
  el('news-unread-dot')?.classList.toggle('hidden', !hasUnread);
}

async function markAlertsSeen() {
  alertsLastOpenedAt = new Date().toISOString();
  await chrome.storage.local.set({ alertsLastOpenedAt });
  updateAlertsBadge();
}

function daysAgoLabel(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function alertRowHtml(item) {
  const band = bands.find((b) => b.id === item.bandId);
  const isFavorite = !!band?.favorite;

  if (item.isBatch) {
    const rangeLabel = item.firstDate === item.lastDate
      ? formatShortDate(item.firstDate)
      : `${formatShortDate(item.firstDate)}–${formatShortDate(item.lastDate)}`;
    const breakdownParts = [];
    if (item.nearbyCount > 0) breakdownParts.push(`${item.nearbyCount} nearby`);
    if (item.europeCount > 0) breakdownParts.push(`${item.europeCount} in Europe`);
    const breakdown = breakdownParts.length ? ` · ${breakdownParts.join(', ')}` : '';
    return `
      <div class="row-card clickable${isFavorite ? ' has-favorite' : ''}" data-band-id="${escapeAttr(item.bandId)}">
        ${isFavorite ? `<span class="alert-favorite-badge" aria-label="Favorite band">${icon('heartFill')}</span>` : ''}
        <div class="alert-row">
          <span class="alert-icon">${icon('bell')}</span>
          <div class="alert-row-body">
            <p class="alert-title">New tour announced · ${escapeHtml(item.bandName)}</p>
            <p class="alert-meta">${item.count} new dates${breakdown} · ${rangeLabel}</p>
            <p class="alert-time">${daysAgoLabel(item.foundAt)}</p>
          </div>
        </div>
      </div>`;
  }

  const c = item;
  return `
    <div class="row-card clickable${isFavorite ? ' has-favorite' : ''}" data-band-id="${escapeAttr(c.bandId)}">
      ${isFavorite ? `<span class="alert-favorite-badge" aria-label="Favorite band">${icon('heartFill')}</span>` : ''}
      <div class="alert-row">
        <span class="alert-icon">${icon('bell')}</span>
        <div class="alert-row-body">
          <p class="alert-title">New show added</p>
          <p class="alert-meta">${escapeHtml(c.bandName)} · ${escapeHtml(c.venue)}, ${escapeHtml(c.city)} · ${formatShortDate(c.date)}</p>
          <p class="alert-time">${daysAgoLabel(c.foundAt)}</p>
        </div>
      </div>
    </div>`;
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
    if (currentScreen === 'settings' || currentScreen === 'profile' || currentScreen === 'stats' || currentScreen === 'venue-detail') {
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
    } else if (state.screen === 'venue-detail' && state.venueKey) {
      openVenueDetail(state.venueKey, { fromHistory: true });
    } else if (state.screen === 'settings') {
      showSettingsScreen({ fromHistory: true });
    } else if (state.screen === 'stats') {
      openStatsScreen({ fromHistory: true });
    } else {
      goToTab(state.tab || currentTab, { fromHistory: true });
    }
  });
}

// The "news" tab id/screen/data-tab are kept as-is internally (renaming
// every reference would touch a lot of code for a purely cosmetic change) —
// only the visible icon/label become Alerts. The tab now covers both the
// original News feed and the new Alerts sub-view (see renderNewsScreen).
const TAB_ICONS = { concerts: 'music', myconcerts: 'ticketStub', mybands: 'users', news: 'bell' };
const TAB_TITLES = { concerts: 'ConcertDates', myconcerts: 'My Concerts', mybands: 'My Bands', news: 'Alerts' };
const TAB_SCREENS = { concerts: 'screen-concerts', myconcerts: 'screen-myconcerts', mybands: 'screen-mybands', news: 'screen-news' };
// Two-tone brand header markup per root tab (first part blue, rest white),
// matching the CONCERTDATES treatment. "Alerts" has no natural two-part
// split, so it's rendered plain (no highlighted segment).
const TAB_BRAND_HTML = {
  concerts: '<span class="brand-blue">CONCERT</span>DATES',
  myconcerts: '<span class="brand-blue">MY</span>CONCERTS',
  mybands: '<span class="brand-blue">MY</span>BANDS',
  news: 'ALERTS',
};

function wireTabs() {
  el('tabbar').querySelectorAll('.tabitem').forEach((btn) => {
    btn.querySelector('.tab-icon').innerHTML = icon(TAB_ICONS[btn.dataset.tab] || 'music');
    btn.addEventListener('click', () => {
      // Tapping the bottom-nav "Alerts" tab should always land on the Alerts
      // sub-view, not whichever of News/Alerts was last viewed — found via
      // user report that clicking Alerts opened the News sub-tab instead.
      if (btn.dataset.tab === 'news') newsSubTab = 'alerts';
      goToTab(btn.dataset.tab);
    });
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
  el('header-icon').innerHTML = icon(TAB_ICONS[tab] || 'music');
  el('europe-toggle-btn').classList.toggle('hidden', tab !== 'concerts');
  el('nearby-toggle-btn').classList.toggle('hidden', tab !== 'concerts');
  showScreen(TAB_SCREENS[tab] || 'screen-concerts');
  if (tab === 'concerts') renderConcertsScreen();
  else if (tab === 'myconcerts') renderMyConcertsScreen();
  else if (tab === 'mybands') renderMyBandsScreen();
  else if (tab === 'news') {
    renderNewsScreen();
    if (newsSubTab === 'alerts') markAlertsSeen();
  }
  if (!fromHistory) history.pushState({ tab, screen: 'main' }, '');
}

function showScreen(id) {
  ['screen-concerts', 'screen-myconcerts', 'screen-mybands', 'screen-news', 'screen-profile', 'screen-venue-detail', 'screen-settings', 'screen-stats', 'screen-connection-error'].forEach((s) => {
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

// The Concerts tab is now two sub-views under one tab (same pattern as the
// Alerts/News switch on the "news" tab): the original discovery feed
// (nearest upcoming show per band) and a new Venues directory grouped
// across every venue in the database. Switching sub-tabs doesn't change the
// URL/history stack, same as the EU/Nearby filters elsewhere in the app.
function renderConcertsScreen() {
  const container = el('screen-concerts');
  el('nearby-toggle-btn').classList.toggle('hidden', concertsSubTab !== 'concerts');
  el('europe-toggle-btn').classList.toggle('hidden', concertsSubTab !== 'concerts');

  const switchHtml = `
    <div class="news-subtab-switch">
      <button class="news-subtab-btn${concertsSubTab === 'concerts' ? ' active' : ''}" data-subtab="concerts">Concerts</button>
      <button class="news-subtab-btn${concertsSubTab === 'venues' ? ' active' : ''}" data-subtab="venues">Venues</button>
    </div>`;

  container.innerHTML = switchHtml + (concertsSubTab === 'venues' ? venuesSubTabHtml() : concertsListHtml());

  container.querySelectorAll('.news-subtab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      concertsSubTab = b.dataset.subtab;
      renderConcertsScreen();
    });
  });

  if (concertsSubTab === 'venues') {
    wireVenuesSubTab(container);
  } else {
    container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
      row.addEventListener('click', () => openProfile(row.dataset.bandId));
    });
  }
}

function concertsListHtml() {
  // A muted band's own profile page still shows its upcoming shows normally
  // (see renderProfileScreen/dlAllUpcomingForBand, untouched by mute) — this
  // filter only strips muted bands out of the aggregate discovery feed here.
  let nearest = dlNearestPerBand(concerts).filter((c) => {
    const band = bands.find((b) => b.id === c.bandId);
    return !!band && !band.muted;
  });
  if (europeOnly) nearest = nearest.filter((c) => dlIsEuropeCountry(c.country));
  else if (nearbyOnly) nearest = nearest.filter((c) => dlIsNearby(c));

  if (nearest.length === 0) {
    const emptyMsg = europeOnly
      ? 'No upcoming European concerts right now.'
      : nearbyOnly
        ? 'No upcoming concerts near you right now.'
        : "No upcoming concerts yet. They'll show up here after the next scheduled check.";
    return `<p class="screen-empty">${emptyMsg}</p>`;
  }

  return renderWithYearDividers(nearest, (c) => {
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
}

/* ---------------- Venues sub-tab ---------------- */

// Scope confirmed with the user: every concert on record for any tracked
// band (past or upcoming, attending or not) — the same breadth as the
// Concerts discovery feed above, not narrowed to personal attendance.
function venuesSubTabHtml() {
  const liveConcerts = concerts.filter((c) => bands.some((b) => b.id === c.bandId));
  const allGroups = dlVenueGroups(liveConcerts);
  const totalVenueCount = allGroups.length;
  let groups = allGroups;

  if (venuesEuropeOnly) groups = groups.filter((g) => g.concerts.some((c) => dlIsEuropeCountry(c.country)));
  else if (venuesNearbyOnly) groups = groups.filter((g) => g.concerts.some(dlIsNearby));
  // "Past Concerts" is scoped to shows the user personally attended, per the
  // user's explicit clarification — not just any already-happened date.
  if (venuesPastOnly) groups = groups.filter((g) => g.concerts.some((c) => c.attending && !dlIsUpcoming(c)));

  // Total header — same design/copy pattern as My Bands' "145 bands in your
  // collection" (bands-total-header/bands-total-value), always the
  // unfiltered count, not affected by the EU/Nearby/Past Concerts filters.
  const totalHeader = `<p class="bands-total-header"><span class="bands-total-value">${totalVenueCount.toLocaleString()}</span> venues in your collection</p>`;

  const filterRow = `
    <div class="section-label-filters" style="margin-bottom:14px">
      <button id="venues-nearby-toggle-btn" class="icon-btn${venuesNearbyOnly ? ' active' : ''}" aria-label="Show nearby only" title="Show nearby only">${icon('nearbyPin')}</button>
      <button id="venues-europe-toggle-btn" class="icon-btn${venuesEuropeOnly ? ' active' : ''}" aria-label="Show Europe only" title="Show Europe only">EU</button>
      <button id="venues-past-toggle-btn" class="icon-btn${venuesPastOnly ? ' active' : ''}" aria-label="Show only venues I've been to" title="Show only venues I've been to">Past Concerts</button>
    </div>`;

  if (groups.length === 0) {
    return totalHeader + filterRow + `<p class="screen-empty">No venues match these filters yet.</p>`;
  }

  const rows = groups.map((g) => `
    <div class="row-card clickable" data-venue-key="${escapeAttr(g.key)}">
      <div class="row-top">
        <div class="row-title-group"><span class="row-name">${escapeHtml(g.venue)}</span></div>
        <span class="row-chevron">${icon('chevronRight')}</span>
      </div>
      <p class="row-sub">${escapeHtml(g.city)}${g.country ? ', ' + escapeHtml(g.country) : ''}</p>
      <p class="row-km">${g.concerts.length} ${g.concerts.length === 1 ? 'show' : 'shows'} on record</p>
    </div>`).join('');

  return totalHeader + filterRow + rows;
}

function wireVenuesSubTab(container) {
  container.querySelector('#venues-nearby-toggle-btn')?.addEventListener('click', async () => {
    venuesNearbyOnly = !venuesNearbyOnly;
    if (venuesNearbyOnly) venuesEuropeOnly = false; // EU and Nearby are mutually exclusive
    await chrome.storage.local.set({ venuesNearbyOnly, venuesEuropeOnly });
    renderConcertsScreen();
  });
  container.querySelector('#venues-europe-toggle-btn')?.addEventListener('click', async () => {
    venuesEuropeOnly = !venuesEuropeOnly;
    if (venuesEuropeOnly) venuesNearbyOnly = false; // EU and Nearby are mutually exclusive
    await chrome.storage.local.set({ venuesNearbyOnly, venuesEuropeOnly });
    renderConcertsScreen();
  });
  container.querySelector('#venues-past-toggle-btn')?.addEventListener('click', async () => {
    venuesPastOnly = !venuesPastOnly;
    await chrome.storage.local.set({ venuesPastOnly });
    renderConcertsScreen();
  });
  container.querySelectorAll('.row-card[data-venue-key]').forEach((row) => {
    row.addEventListener('click', () => openVenueDetail(row.dataset.venueKey));
  });
}

function openVenueDetail(key, { fromHistory = false } = {}) {
  activeVenueKey = key;
  currentScreen = 'venue-detail';
  const liveConcerts = concerts.filter((c) => bands.some((b) => b.id === c.bandId));
  const group = dlVenueGroups(liveConcerts).find((g) => g.key === key);
  setHeaderChrome({ showBack: true, title: group ? group.venue : 'Venue' });
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  showScreen('screen-venue-detail');
  renderVenueDetailScreen(key);
  if (!fromHistory) history.pushState({ tab: currentTab, screen: 'venue-detail', venueKey: key }, '');
}

// Full concert history at a single venue — every band that's ever played
// there, past and upcoming alike, tapping through to that band's own
// profile (same drill-down the Concerts tab and Alerts list already use).
function renderVenueDetailScreen(key) {
  const container = el('screen-venue-detail');
  const liveConcerts = concerts.filter((c) => bands.some((b) => b.id === c.bandId));
  const group = dlVenueGroups(liveConcerts).find((g) => g.key === key);
  if (!group) {
    container.innerHTML = `<p class="screen-empty">Venue not found.</p>`;
    return;
  }
  const sorted = [...group.concerts].sort((a, b) => new Date(b.date) - new Date(a.date));
  container.innerHTML = `
    <p class="section-label" style="margin-top:0">${escapeHtml(group.city)}${group.country ? ', ' + escapeHtml(group.country) : ''}</p>
    ${renderWithYearDividers(sorted, (c) => {
      const dateStr = formatDate(c.date, c.time);
      const isPast = !dlIsUpcoming(c);
      return `
        <div class="row-card clickable${isPast ? ' is-past' : ''}" data-band-id="${escapeAttr(c.bandId)}">
          <div class="row-top">
            <div class="row-title-group">
              <span class="row-name">${escapeHtml(c.bandName)}</span>
              ${c.attending ? `<span class="pill ${isPast ? 'pill-attended' : 'pill-going'}">${icon('check')} ${isPast ? 'Attended' : 'Going'}</span>` : ''}
            </div>
            <span class="row-chevron">${icon('chevronRight')}</span>
          </div>
          <p class="row-sub">${dateStr}</p>
        </div>`;
    }, { showCount: true })}
  `;
  container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
    row.addEventListener('click', () => openProfile(row.dataset.bandId));
  });
}

/* ---------------- My Concerts tab ---------------- */

function renderMyConcertsScreen() {
  const container = el('screen-myconcerts');
  // Same guard as renderConcertsScreen: a concert whose band was removed via
  // the My Bands trash button has no matching entry in `bands` anymore (band
  // removal only rewrites bands.json, never concerts.json). Without this
  // filter a "going"/"attended" concert for a deleted band would still show
  // up here, and tapping it would dead-end on openProfile's "Band not found."
  const liveConcerts = concerts.filter((c) => bands.some((b) => b.id === c.bandId));
  const { upcoming, past } = dlMyConcerts(liveConcerts);

  const bandOptions = [...bands]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.name)}</option>`)
    .join('');

  let html = '';

  // Stats teaser only once there's at least one past show to summarize —
  // otherwise it'd just be a row of zeroes above an empty list. `upcoming`
  // is passed through too so tickets already bought for a not-yet-happened
  // show count toward the spend/average stats (see dlConcertStats).
  if (past.length > 0) html += statsTeaserHtml(dlConcertStats(past, bands, upcoming));

  // Countdown to the next "going" show — always rendered (with an empty
  // state when nothing's upcoming) so it stays in a fixed spot: under the
  // stats card, above the upcoming/past lists.
  html += countdownCardHtml(upcoming[0] || null);

  if (upcoming.length === 0 && past.length === 0) {
    html += `<p class="screen-empty">No concerts saved yet. Tap "I'm going" on a band's page to add one, or backlog a past show below.</p>`;
  } else {
    if (upcoming.length > 0) {
      html += `<p class="section-label" style="margin-top:0">Upcoming concerts</p>`;
      html += renderWithYearDividers(upcoming, (c) => myConcertRowHtml(c, false), { showCount: true });
    }
    if (past.length > 0) {
      html += `<p class="section-label section-label-gap-lg">Past concerts</p>`;
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
      <div class="form-row">
        <input type="text" id="past-concert-venue" placeholder="Venue" />
        <select id="past-concert-type">
          <option value="concert">Concert</option>
          <option value="festival">Festival</option>
        </select>
      </div>
      <div class="form-row">
        <input type="text" id="past-concert-city" placeholder="City" />
        <input type="text" id="past-concert-country" placeholder="Country (optional)" />
      </div>
      <input type="text" id="past-concert-address" placeholder="Venue address (optional, for calendar)" />
      <div class="form-row date-select-row">
        <select id="past-concert-year">${pastConcertYearOptionsHtml()}</select>
        <select id="past-concert-month">${pastConcertMonthOptionsHtml()}</select>
        <select id="past-concert-day">${pastConcertDayOptionsHtml()}</select>
      </div>
      <button id="past-concert-submit" class="btn-primary btn-block">${icon('plus')}Add past concert</button>
      <p id="past-concert-error" class="error hidden" style="color:var(--danger);font-size:11.5px;margin:6px 0 0"></p>
    </div>`;

  container.innerHTML = html;
  wireMyConcertsHandlers(container);
  upcoming.forEach((concert) => ensureConcertWeather(concert));
}

function statsTeaserHtml(stats) {
  return `
    <div class="stats-teaser-card">
      <div class="stats-teaser-row stats-teaser-row-4up">
        <div class="stats-teaser-item"><span class="stats-teaser-value">${stats.totalShows.toLocaleString()}</span><span class="stats-teaser-label">shows</span></div>
        <div class="stats-teaser-item"><span class="stats-teaser-value">${stats.countries.toLocaleString()}</span><span class="stats-teaser-label">countries</span></div>
        <div class="stats-teaser-item"><span class="stats-teaser-value">${dlCompactNumber(stats.kmTraveled)} km</span><span class="stats-teaser-label">traveled</span></div>
        <div class="stats-teaser-item"><span class="stats-teaser-value">${dlCompactNumber(stats.totalSpend)} kr</span><span class="stats-teaser-label">spent</span></div>
      </div>
      <button type="button" id="stats-teaser-cta" class="stats-teaser-footer">See your full stats${icon('chevronRight')}</button>
    </div>`;
}

// Countdown to the next "going" show. Ticket-stub shaped, styled on
// --header-bg (always dark, same as the app header bar, in both light and
// dark mode) rather than --surface, so it reads as a distinct "feature"
// card. The ring math itself lives in dataLib's dlCountdownParts — this
// just renders whatever it returns and stamps the target datetime onto the
// card so tickCountdownCard() can recompute it every second without a
// full re-render.
function countdownCardHtml(nextConcert) {
  if (!nextConcert) {
    return `
      <div class="countdown-card countdown-empty">
        <p class="countdown-empty-text">No upcoming concert marked as attending</p>
      </div>`;
  }
  const time = nextConcert.time ? nextConcert.time.slice(0, 5) : '00:00';
  const targetIso = `${nextConcert.date}T${time}:00`;
  const venueLine = [nextConcert.venue, nextConcert.city].filter(Boolean).join(', ');

  // Show-day state: swaps the day-countdown ring for a solid disc + ticket
  // glyph and drops the d/h/m/s breakdown (there's nothing meaningful left
  // to count down to a day granularity) in favor of a "Get directions"
  // action — the actual show start time isn't reliably known (Ticketmaster
  // doesn't always supply it, and there's no separate "doors" field at all),
  // so this deliberately never claims a start time. Compared by calendar
  // date (local), not diffMs, so it stays in this state all day even after
  // the nominal target time has passed.
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (nextConcert.date === todayStr) {
    return `
      <div class="countdown-card countdown-card-today" id="countdown-card" data-target="${escapeAttr(targetIso)}" data-today="true">
        <div class="countdown-info">
          <p class="countdown-label">Show today</p>
          <p class="countdown-band">${escapeHtml(nextConcert.bandName)}</p>
          <p class="countdown-venue">${escapeHtml(venueLine)}</p>
          <a class="countdown-directions-btn" href="${escapeAttr(buildGoogleMapsUrl(nextConcert))}" target="_blank" rel="noopener">${icon('mapPin')}Get directions</a>
        </div>
        <div class="countdown-ring-wrap">
          <svg width="84" height="84" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r="38" fill="#f2c230"></circle>
            <path d="M30 34a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v3a3 3 0 0 0 0 6v3a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4v-3a3 3 0 0 0 0-6z" fill="none" stroke="#1c1400" stroke-width="2.4"></path>
            <line x1="42" y1="33" x2="42" y2="51" stroke="#1c1400" stroke-width="2.2" stroke-dasharray="3 3"></line>
          </svg>
        </div>
      </div>`;
  }

  const { days, hours, minutes, seconds, outerPct, innerPct } = dlCountdownParts(new Date(targetIso));
  // Ring sized ~1.5x the original 56/24/16 dimensions to match the card's
  // 50%-taller layout (see .countdown-card in app.css) — circumferences
  // recomputed for r=36/r=24 rather than reused from the old r=24/r=16 pair.
  const outerCirc = 226.19;
  const innerCirc = 150.8;
  return `
    <div class="countdown-card" id="countdown-card" data-target="${escapeAttr(targetIso)}" data-today="false">
      <div class="countdown-info">
        <p class="countdown-label">Next up</p>
        <p class="countdown-band">${escapeHtml(nextConcert.bandName)}</p>
        <p class="countdown-venue">${escapeHtml(venueLine)}</p>
        <p class="countdown-breakdown"><span id="countdown-d">${days}</span>d <span id="countdown-h">${String(hours).padStart(2, '0')}</span>h <span id="countdown-m">${String(minutes).padStart(2, '0')}</span>m <span id="countdown-s">${String(seconds).padStart(2, '0')}</span>s</p>
      </div>
      <div class="countdown-ring-wrap">
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle class="countdown-ring-track" cx="42" cy="42" r="36" fill="none" stroke-width="8"></circle>
          <circle id="countdown-ring-outer" data-circ="${outerCirc}" cx="42" cy="42" r="36" fill="none" stroke-width="8" stroke-linecap="round" transform="rotate(-90 42 42)" stroke-dasharray="${outerCirc}" stroke-dashoffset="${outerCirc * (1 - outerPct)}"></circle>
          <circle class="countdown-ring-track" cx="42" cy="42" r="24" fill="none" stroke-width="8"></circle>
          <circle id="countdown-ring-inner" data-circ="${innerCirc}" cx="42" cy="42" r="24" fill="none" stroke-width="8" stroke-linecap="round" transform="rotate(-90 42 42)" stroke-dasharray="${innerCirc}" stroke-dashoffset="${innerCirc * (1 - innerPct)}"></circle>
          <text x="42" y="49" text-anchor="middle" id="countdown-ring-day">${days}</text>
        </svg>
      </div>
    </div>`;
}

// Runs on a plain always-on interval (started once in init(), see below)
// rather than being wired to My Concerts' own open/close — el() lookups
// just miss silently on every other screen, which is cheaper than hooking
// start/stop into every place the tab can be entered or left.
function tickCountdownCard() {
  const card = el('countdown-card');
  if (!card || card.dataset.today === 'true') return;
  const target = new Date(card.dataset.target);
  const { days, hours, minutes, seconds, outerPct, innerPct } = dlCountdownParts(target);
  el('countdown-d').textContent = days;
  el('countdown-h').textContent = String(hours).padStart(2, '0');
  el('countdown-m').textContent = String(minutes).padStart(2, '0');
  el('countdown-s').textContent = String(seconds).padStart(2, '0');
  el('countdown-ring-day').textContent = days;
  const outer = el('countdown-ring-outer');
  const circOuter = Number(outer.dataset.circ);
  outer.setAttribute('stroke-dashoffset', String(circOuter * (1 - outerPct)));
  const inner = el('countdown-ring-inner');
  const circInner = Number(inner.dataset.circ);
  inner.setAttribute('stroke-dashoffset', String(circInner * (1 - innerPct)));
}

// Band avatar for My Concerts cards only (see myConcertRowHtml below) —
// mirrors the band profile page's own .profile-avatar treatment exactly
// (real photo when band.photoUrl exists, else initials), just bigger (84px,
// matching the countdown ring). Deliberately never called for the Concerts
// tab or a band's own profile page — those already show/imply the band
// identity, so the avatar would be redundant there. That's why this is only
// invoked when showBandName is true below.
function rowAvatarHtml(bandId) {
  const band = bands.find((b) => b.id === bandId);
  if (!band) return '';
  const initials = band.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<div class="row-avatar">${band.photoUrl ? `<img src="${escapeAttr(band.photoUrl)}" alt="" />` : initials}</div>`;
}

// showBandName is turned off only by the band-profile page's own Past
// concerts section (see renderProfileScreen) — the band name (and avatar)
// would just repeat the page you're already on there. My Concerts (where a
// single list mixes every band) always passes the default true.
//
// Card is split into three visually separated groups (divider lines
// between each): (1) avatar/name/tour/date/venue/address/distance,
// (2) Playlist/Photos/Setlist, (3) star rating + notes (past only) — see
// the .row-card-mc rules in app.css. The Festival/Attended pills sit on
// their own row above the band name (rather than sharing its line) so a
// long band name never crowds them.
function myConcertRowHtml(c, isPast, { showBandName = true } = {}) {
  const tourName = isPast ? c.setlist?.tourName : null;
  const showPillRow = c.type === 'festival' || isPast;
  return `
    <div class="row-card-mc row-card clickable has-corner-delete${isPast ? ' is-past' : ''}" data-band-id="${c.bandId}">
      <div class="row-header">
        ${showBandName ? rowAvatarHtml(c.bandId) : ''}
        <div class="row-title-col">
          ${showPillRow ? `
          <div class="row-pill-row">
            ${c.type === 'festival' ? `<span class="pill pill-festival">Festival</span>` : ''}
            ${isPast ? `<span class="pill pill-attended">${icon('check')} Attended</span>` : ''}
          </div>` : ''}
          <div class="row-name-line">
            <span class="row-name">${showBandName ? escapeHtml(c.bandName) : ''}</span>
            <span class="row-chevron">${icon('chevronRight')}</span>
          </div>
          ${tourName ? `<p class="row-tour">${escapeHtml(tourName)}</p>` : ''}
        </div>
      </div>
      <p class="row-sub">${formatDate(c.date, c.time)} · ${escapeHtml(c.venue)}, ${escapeHtml(c.city)}${c.country ? ', ' + escapeHtml(c.country) : ''}</p>
      ${venueAddressLinkHtml(c)}
      ${c.distanceKm !== null && c.distanceKm !== undefined ? `<p class="row-km">${formatKm(c.distanceKm)} away</p>` : ''}
      ${isPast ? ticketCostBlockHtml(c) : ''}
      ${isPast ? '<div class="row-divider"></div>' : ''}
      ${isPast ? mcLinksRowHtml(c, true) : concertPrepGroupHtml(c)}
      ${isPast ? `<div class="row-divider"></div>${concertReviewHtml(c)}` : ''}
      <button class="icon-btn remove-going-btn delete-corner-btn" data-concert-id="${c.id}" aria-label="Remove">${icon('trash')}</button>
    </div>`;
}

// Venue address — shown directly on My Concerts rows and the band profile
// page's own Upcoming/Past concerts rows alike (see myConcertRowHtml and
// profileUpcomingRowHtml below), positioned above "X km away". Still just a
// plain clickable link out to Google Maps.
function venueAddressLinkHtml(c) {
  if (!c.venueAddress) return '';
  return `<a class="venue-address-link" href="${escapeAttr(buildGoogleMapsUrl(c))}" target="_blank" rel="noopener">${escapeHtml(c.venueAddress)}</a>`;
}

// Playlist link — unlike rating/notes/photo (concertReviewHtml below),
// this is meant for both upcoming and past shows: a pre-show hype playlist
// is just as useful as a "what we heard" one, so it's its own standalone
// block rather than living inside the past-only review block. Same two-state
// shape as the review block (collapsed "Add" toggle vs. always-visible link
// with an "Edit" toggle), just with a single URL field instead of
// rating+notes+photo.
function playlistLinkHtml(c) {
  if (c.playlistUrl) {
    return `
      <div class="playlist-block">
        <a class="playlist-link" href="${escapeAttr(c.playlistUrl)}" target="_blank" rel="noopener">${icon('music')}Playlist</a>
        <details class="playlist-edit-toggle">
          <summary>Edit playlist link<span class="details-chevron">${icon('chevronDown')}</span></summary>
          ${playlistFormHtml(c)}
        </details>
      </div>`;
  }
  return `
    <details class="playlist-block playlist-add-toggle">
      <summary>Add playlist link<span class="details-chevron">${icon('chevronDown')}</span></summary>
      ${playlistFormHtml(c)}
    </details>`;
}

function playlistFormHtml(c) {
  return `
    <div class="playlist-form">
      <input type="url" class="playlist-url-input" value="${escapeAttr(c.playlistUrl || '')}" placeholder="Spotify or Apple Music playlist link" />
      <button type="button" class="btn-primary playlist-save-btn" data-concert-id="${escapeAttr(c.id)}">Save</button>
    </div>`;
}

// Photo entry form — the actual input+Save pair, reused directly by the new
// My Concerts links row below (mcLinksRowHtml). photoLinkHtml() used to wrap
// this in its own standalone <details> block; that wrapper is gone (see the
// My Concerts links row comment below for why), but this form generator is
// still exactly what gets shown once the Photos panel is opened.
function photoFormHtml(c) {
  return `
    <div class="photo-form">
      <input type="url" class="photo-url-input" value="${escapeAttr(c.photoUrl || '')}" placeholder="Google Photos link" />
      <button type="button" class="btn-primary photo-save-btn" data-concert-id="${escapeAttr(c.id)}">Save</button>
    </div>`;
}

// --- My Concerts links row (Playlist / Photos / Setlist) -------------------
// Scoped entirely to myConcertRowHtml (My Concerts screen, plus the band
// profile page's own Past concerts section, which reuses myConcertRowHtml
// as-is) — NOT used by profileUpcomingRowHtml, which deliberately keeps the
// older stacked playlistLinkHtml() block since that page is out of scope
// for this redesign.
//
// Why this exists: Playlist/Photos/Setlist used to each be an independent
// full-width <details> block, which is why they rendered stacked underneath
// each other instead of side by side like the approved mockup. A native
// <details> can't have its <summary> sit in one flex row while its expanded
// content escapes to a shared full-width area below a second row — the
// content always renders as a direct descendant of its own <details> box.
// So instead this builds two aligned flex rows (a link/trigger row, then a
// short Edit/Add row underneath it) plus a set of full-width panel <div>s
// that a small click handler (see wireMyConcertsHandlers) shows and hides
// directly, rather than relying on <details>/<summary>.
function mcLinkFieldConfig(kind) {
  return kind === 'playlist'
    ? { field: 'playlistUrl', iconName: 'spotify', label: 'Playlist', formFn: playlistFormHtml }
    : { field: 'photoUrl', iconName: 'photo', label: 'Photos', formFn: photoFormHtml };
}

// Row 1 cell: the real link once a URL exists (opens it in a new tab, same
// as before); otherwise a muted, non-clickable label so the column still
// holds its place and every card's columns line up while scrolling.
function mcLinkTriggerCellHtml(kind, c) {
  const cfg = mcLinkFieldConfig(kind);
  const url = c[cfg.field];
  // Label text lives in its own span so IT alone truncates with an ellipsis
  // on narrow phones — the leading icon and (for Setlist, see
  // mcSetlistTriggerCellHtml) the trailing chevron are flex-shrink:0 in CSS
  // so they're never the part that gets clipped off.
  if (url) {
    return `<a class="link-trigger" href="${escapeAttr(url)}" target="_blank" rel="noopener">${icon(cfg.iconName)}<span class="link-trigger-label">${cfg.label}</span></a>`;
  }
  return `<span class="link-trigger is-empty">${icon(cfg.iconName)}<span class="link-trigger-label">${cfg.label}</span></span>`;
}

// Row 2 cell: a short Edit/Add toggle sitting directly under its matching
// row-1 cell — replaces the old, too-long-to-share-a-row "Edit playlist
// link"/"Add photos link" wording.
function mcLinkEditCellHtml(kind, c) {
  const cfg = mcLinkFieldConfig(kind);
  const hasUrl = !!c[cfg.field];
  return `<button type="button" class="link-edit-btn" data-toggle-panel="${kind}" data-concert-id="${escapeAttr(c.id)}">${hasUrl ? 'Edit' : 'Add'}<span class="details-chevron">${icon('chevronDown')}</span></button>`;
}

// Setlist (My Concerts, past shows only) — read-only, populated solely by
// the automatic setlist.fm pipeline (scripts/lib/setlistfm.js). Has no row-2
// counterpart since there's nothing to edit — its row-1 cell IS its own
// open/close toggle, matching how it behaved before this restructure.
function mcSetlistTriggerCellHtml(c) {
  const songCount = Array.isArray(c.setlist?.songs) ? c.setlist.songs.length : 0;
  // Past cards always reserve the third column.  A missing setlist is shown
  // as a muted, non-interactive value, matching unavailable playlist/photo
  // fields without adding an empty panel or keyboard stop.
  if (!songCount) {
    return `<span class="link-trigger setlist-trigger is-empty">${icon('setlistOrdered')}<span class="link-trigger-label">Setlist (0)</span></span>`;
  }
  // Deliberately just the count, not "N songs" — at real phone widths (tested
  // down to 375px) the word "songs" pushed the label past the column's
  // available width and got ellipsis-truncated, sometimes eating into the
  // chevron too. The chevron itself is untouched.
  return `<button type="button" class="link-trigger setlist-trigger" data-toggle-panel="setlist" data-concert-id="${escapeAttr(c.id)}">${icon('setlistOrdered')}<span class="link-trigger-label">Setlist (${songCount})</span><span class="details-chevron">${icon('chevronDown')}</span></button>`;
}

function actualSetlistNormalizedName(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function actualSetlistTagsHtml(c, song, index) {
  const songs = c.setlist?.songs || []; const firstEncore = songs.findIndex((item) => item?.isEncore);
  const closerIndex = firstEncore < 0 ? songs.length - 1 : firstEncore - 1;
  const tags = [];
  if (index === 0) tags.push('Opener');
  if (index === closerIndex && !song.isEncore) tags.push('Main-set closer');
  const generated = (c.setlistInsights?.status === 'ready' ? c.setlistInsights.insights || [] : []).filter((item) => item.normalizedName === actualSetlistNormalizedName(song.name)).slice(0, 1);
  for (const item of generated) tags.push(item.label);
  return tags.length ? `<span class="setlist-insight-tags">${tags.map((tag) => `<span class="setlist-insight-tag">${escapeHtml(tag)}</span>`).join('')}</span>` : '';
}

function mcSetlistPanelContentHtml(c) {
  const songsHtml = c.setlist.songs
    .map((s, index) => {
      const encoreLabel = s.isEncore ? `<span class="setlist-encore-divider">Encore</span>` : '';
      const coverTag = s.isCover ? `<span class="setlist-cover-tag">cover</span>` : '';
      // Only an original (non-cover) song with a resolved Spotify link becomes
      // clickable — the song title itself is the link (no icon), per the
      // chosen UI variant. Covers are never linked (setlist.fm only tells us
      // a song IS a cover, not who the original artist is, and the user only
      // wants links for the band's own songs). A song that was checked but
      // had no confident match just renders as plain text, same as a cover.
      const nameHtml =
        !s.isCover && s.spotifyUrl
          ? `<a class="setlist-song-link" href="${escapeAttr(s.spotifyUrl)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>`
          : escapeHtml(s.name);
      return `${encoreLabel}<li class="setlist-song${s.isCover ? ' setlist-cover' : ''}">${nameHtml}${actualSetlistTagsHtml(c, s, index)}${coverTag}</li>`;
    })
    .join('');
  return `
    <ol class="setlist-song-list">${songsHtml}</ol>
    ${c.setlistInsights?.status === 'ready' && c.setlistInsights.insights?.length ? `<p class="setlist-insight-context">Compared with ${c.setlistInsights.comparisonWindow?.setlistCount || 0} earlier recorded setlists · setlist.fm data may be incomplete</p>` : ''}
    ${c.setlist.url ? `<a class="setlist-attribution" href="${escapeAttr(c.setlist.url)}" target="_blank" rel="noopener">View on setlist.fm</a>` : ''}`;
}

// Assembles the two rows plus the hidden full-width panels described above.
// Only one panel is ever open at a time per card (see wireMyConcertsHandlers)
// — opening a different one closes whichever was already open, so the card
// never has to show two expanded panels stacked at once.
function mcLinksRowHtml(c, isPast) {
  const hasSetlist = isPast && c.setlist && Array.isArray(c.setlist.songs) && c.setlist.songs.length > 0;
  return `
    <div class="row-links-group" data-open="">
      <div class="row-links-row">
        ${mcLinkTriggerCellHtml('playlist', c)}
        ${isPast ? mcLinkTriggerCellHtml('photo', c) : ''}
        ${isPast ? mcSetlistTriggerCellHtml(c) : ''}
      </div>
      <div class="row-edit-row">
        ${mcLinkEditCellHtml('playlist', c)}
        ${isPast ? mcLinkEditCellHtml('photo', c) : ''}
        ${isPast ? '<span class="row-edit-spacer"></span>' : ''}
      </div>
      <div class="expand-panel" data-panel="playlist" hidden>${playlistFormHtml(c)}</div>
      ${isPast ? `<div class="expand-panel" data-panel="photo" hidden>${photoFormHtml(c)}</div>` : ''}
      ${hasSetlist ? `<div class="expand-panel" data-panel="setlist" hidden>${mcSetlistPanelContentHtml(c)}</div>` : ''}
    </div>`;
}

const PREP_CHECKLIST = [
  ['ticketReady', 'Ticket ready'], ['travelPlanned', 'Travel planned'], ['timesChecked', 'Doors & stage times checked'],
  ['venueRulesChecked', 'Venue rules checked'], ['playlistReady', 'Playlist ready'],
];
function prepCount(c) { return PREP_CHECKLIST.filter(([key]) => c.prepChecklist?.[key]).length; }
function prepPanel(id, content, isOpen = false) { return `<div id="prep-${escapeAttr(id)}" class="concert-prep-panel"${isOpen ? '' : ' hidden'}>${content}</div>`; }
function predictedMixSongs(c) { const seen = new Set(); return (c.predictedSetlist?.songs || []).filter((song) => song.spotifyMatched && song.spotifyUri && !song.isCover && !seen.has(song.spotifyUri) && seen.add(song.spotifyUri)); }
function predictedMixReviewItems(c, review) { const seen = new Set(); return (c.predictedSetlist?.songs || []).map((song) => { if (song.isCover) return `<p class="muted">${escapeHtml(song.name)} · Cover excluded</p>`; if (!song.spotifyMatched || !song.spotifyUri) return `<p class="muted">${escapeHtml(song.name)} · Unmatched</p>`; if (seen.has(song.spotifyUri)) return ''; seen.add(song.spotifyUri); return `<label><input type="checkbox" class="predicted-track-check" data-concert-id="${escapeAttr(c.id)}" data-uri="${escapeAttr(song.spotifyUri)}" ${review.uris.includes(song.spotifyUri) ? 'checked' : ''}/> ${escapeHtml(song.name)}</label>`; }).join(''); }
function predictedPlaylistStatus(c) { const manual = !!c.playlistUrl; const generated = c.predictedPlaylist; if (manual && generated) return 'Manual linked · Predicted mix saved'; if (manual) return 'Manual playlist linked'; if (generated) return `Predicted mix · ${generated.trackCount} track${generated.trackCount === 1 ? '' : 's'}`; return 'Add manually or create from prediction'; }
function predictedMixName(c) { const year = (c.date || '').slice(0, 4); return [c.bandName, c.venue || c.city, year].filter(Boolean).join(' — ').replace(/ — (\d{4})$/, ' $1'); }
function predictedMixPanelHtml(c) {
  const prediction = c.predictedSetlist; const matched = predictedMixSongs(c); const generated = c.predictedPlaylist; const changed = generated && prediction?.fingerprint && generated.sourcePredictionFingerprint !== prediction.fingerprint;
  if (prediction?.status !== 'ready') return `<div class="prep-section"><strong>Create from Predicted Setlist</strong><p>${prediction?.status === 'pending' ? 'Prediction is being prepared' : prediction?.status === 'insufficient_data' ? 'Not enough recent setlists yet' : 'Prediction not available'}</p></div>`;
  const songCount = prediction.predictedSongCount || prediction.songs?.length || 0;
  if (!matched.length) {
    const message = ['error', 'quota_blocked'].includes(prediction.spotifyMatchStatus) ? 'Spotify matching could not be completed yet. It will retry.' : prediction.spotifyMatchStatus === 'no_match' ? `0 of ${songCount} predicted songs matched on Spotify.` : 'Spotify matching has not run yet.';
    return `<div class="prep-section"><strong>Create from Predicted Setlist</strong><p>${message}</p></div>`;
  }
  const review = playlistReviews.get(c.id); const creating = playlistOperations.has(c.id);
  if (review) return `<div class="prep-section playlist-review"><label for="predicted-playlist-name-${escapeAttr(c.id)}">Playlist name</label><input id="predicted-playlist-name-${escapeAttr(c.id)}" class="predicted-playlist-name" data-concert-id="${escapeAttr(c.id)}" value="${escapeAttr(review.name)}"/><p>${matched.length} of ${songCount} songs available on Spotify</p><div class="playlist-review-songs">${predictedMixReviewItems(c, review)}</div><p class="playlist-operation-status" aria-live="polite">${escapeHtml(review.message || '')}${review.operation?.playlist?.external_urls?.spotify && review.message?.includes('could not be saved') ? ` <a href="${escapeAttr(review.operation.playlist.external_urls.spotify)}" target="_blank" rel="noopener">Open playlist</a>` : ''}</p><div class="playlist-review-actions"><button type="button" class="btn-secondary playlist-review-cancel" data-concert-id="${escapeAttr(c.id)}" ${creating ? 'disabled' : ''}>Cancel</button><button type="button" class="btn-primary playlist-create-confirm" data-concert-id="${escapeAttr(c.id)}" ${review.uris.length && !creating ? '' : 'disabled'}>Create private playlist</button></div></div>`;
  return `<div class="prep-section"><strong>Create from Predicted Setlist</strong><p>${generated ? `Predicted mix · ${generated.trackCount} track${generated.trackCount === 1 ? '' : 's'}` : `${matched.length} of ${songCount} songs available on Spotify`}</p>${generated ? `<a class="btn-secondary" href="${escapeAttr(generated.spotifyUrl)}" target="_blank" rel="noopener">Open predicted mix</a>${changed ? '<p>The prediction has changed since this mix was created.</p><button type="button" class="btn-primary playlist-review-open" data-concert-id="' + escapeAttr(c.id) + '">Review & create</button>' : ''}` : `<button type="button" class="btn-primary playlist-review-open" data-concert-id="${escapeAttr(c.id)}">Review & create</button>`}</div>`;
}
function weatherDateLabel(value) { return value ? new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(new Date(`${value}T00:00:00Z`)) : null; }
function weatherSummary(weather) { const focus = weather.hours?.[Math.floor((weather.hours?.length || 1) / 2)] || weather.hours?.[0]; if (!focus) return null; const rain = Math.max(...weather.hours.map((hour) => hour.precipitationProbability)); return `${focus.temperatureC}°C · ${focus.conditionText} · ${rain}% rain`; }
function weatherPanelHtml(c) {
  const current = weatherViews.get(c.id); const availability = ConcertWeather.availability(c, c.timezone || 'UTC');
  if (!availability.available) return `<p>Forecasts become available 10 days before the concert.${availability.availableDate ? ` Available ${escapeHtml(weatherDateLabel(availability.availableDate))}.` : ''}</p>`;
  if (!current || current.kind === 'loading') return '<p aria-live="polite">Loading forecast…</p>';
  if (current.kind === 'location_unavailable') return '<p>Weather unavailable for this venue</p>';
  if (current.kind === 'unavailable') return '<p aria-live="polite">Forecast temporarily unavailable</p><button type="button" class="weather-retry" data-concert-id="' + escapeAttr(c.id) + '">Try again</button>';
  const weather = current.forecast; const stale = current.kind === 'stale';
  return `<div class="weather-hours" aria-label="Concert weather forecast">${weather.hours.map((hour) => `<div class="weather-hour"><span>${escapeHtml(hour.time.slice(11, 16))}</span><span aria-hidden="true">${icon(`weather${hour.conditionKey[0].toUpperCase()}${hour.conditionKey.slice(1)}`)}</span><strong>${hour.temperatureC}°C</strong><small>${hour.precipitationProbability}% rain · ${hour.windSpeedKmh} km/h</small></div>`).join('')}</div><p class="weather-updated">Updated ${escapeHtml(weather.fetchedAt.slice(11, 16))}${stale ? ' · Showing the latest saved forecast' : ''}</p>`;
}
function weatherRowStatus(c) { const current = weatherViews.get(c.id); const availability = ConcertWeather.availability(c, c.timezone || 'UTC'); if (!availability.available) return 'Available 10 days before the concert'; if (current?.forecast) return weatherSummary(current.forecast) || 'Forecast temporarily unavailable'; if (current?.kind === 'location_unavailable') return 'Weather unavailable for this venue'; if (current?.kind === 'unavailable') return 'Forecast temporarily unavailable'; return 'Loading forecast…'; }
function ensureConcertWeather(concert, force = false) {
  const availability = ConcertWeather.availability(concert, concert.timezone || 'UTC'); if (!availability.available || weatherViews.get(concert.id)?.kind === 'loading') return;
  const current = weatherViews.get(concert.id); if (!force && current?.kind === 'ok') return;
  weatherViews.set(concert.id, { kind: 'loading' });
  ConcertWeather.load(concert, { force }).then((result) => { weatherViews.set(concert.id, result); if (currentTab === 'myconcerts' && currentScreen === 'main') renderMyConcertsScreen(); });
}
function ticketCostSummaryParts(c) {
  if (typeof c.ticketPrice !== 'number' || Number.isNaN(c.ticketPrice)) return { primary: 'Add ticket cost', quantity: null, known: false };
  const quantity = c.ticketQuantity || 1;
  if (c.ticketPrice === 0) return { primary: 'Free', quantity: quantity > 1 ? `${quantity} tickets` : null, known: true };
  return { primary: `${(c.ticketPrice * quantity).toLocaleString('sv-SE')} kr`, quantity: quantity > 1 ? `${quantity} tickets` : null, known: true };
}

function ownedTicketItems(c) { return OwnedTickets.ticketNames(c.ownedTickets); }

function ticketPrepSummaryHtml(c) {
  const cost = ticketCostSummaryParts(c);
  const ownedStatus = OwnedTickets.statusLabel(c.ownedTickets);
  return `<span class="ticket-summary-primary${cost.known ? '' : ' is-empty'}">${escapeHtml(cost.primary)}</span>${cost.quantity ? `<span class="ticket-summary-secondary"> · ${escapeHtml(cost.quantity)}</span>` : ''}<span class="ticket-summary-secondary"> · ${escapeHtml(ownedStatus)}</span>`;
}

function ownedTicketItemHtml(c, item) {
  const cacheState = item.type === 'pdf' ? ticketCacheStatus.get(`${c.id}:${item.id}`) : null;
  const detail = item.type === 'pdf'
    ? `PDF · ${cacheState === 'cached' ? 'Available offline' : cacheState === 'unavailable' ? 'Offline copy unavailable on this device' : 'Open once to save offline'}`
    : 'Internet required';
  const actions = item.type === 'pdf'
    ? `<button type="button" class="btn-secondary ticket-remove-btn" data-concert-id="${escapeAttr(c.id)}" data-ticket-id="${escapeAttr(item.id)}">Remove</button>`
    : `<a class="btn-secondary" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Open</a><button type="button" class="btn-secondary ticket-link-edit-btn" data-concert-id="${escapeAttr(c.id)}" data-ticket-id="${escapeAttr(item.id)}">Edit</button><button type="button" class="btn-secondary ticket-remove-btn" data-concert-id="${escapeAttr(c.id)}" data-ticket-id="${escapeAttr(item.id)}">Remove</button>`;
  return `<div class="owned-ticket-item"><div><strong>${escapeHtml(item.displayName)}</strong><small>${detail}</small></div><div class="owned-ticket-item-actions">${actions}</div></div>`;
}

function ticketOwnedPanelHtml(c) {
  const items = ownedTicketItems(c);
  const view = ticketPanelViews.get(c.id) || '';
  const editing = view.startsWith('edit:') ? items.find((item) => item.id === view.slice(5) && item.type === 'url') : null;
  const showLinkForm = view === 'add-link' || !!editing;
  const busy = ticketOperations.has(c.id);
  const pdfOpenButtons = items.filter((item) => item.type === 'pdf').map((item) => `<button type="button" class="btn-primary ticket-pdf-open-btn owned-ticket-open-btn" data-concert-id="${escapeAttr(c.id)}" data-ticket-id="${escapeAttr(item.id)}">Open ${escapeHtml(item.displayName)}</button>`).join('');
  return `<section class="prep-section owned-ticket-section"><strong>My ticket</strong><p>Upload a ticket PDF for offline access, or save a link to your mobile ticket.</p><p class="ticket-operation-status" aria-live="polite">${escapeHtml(ticketNotices.get(c.id) || '')}</p>${items.map((item) => ownedTicketItemHtml(c, item)).join('')}${showLinkForm ? `<div class="owned-ticket-link-form"><label>Ticket link<input type="url" class="owned-ticket-url-input" value="${escapeAttr(editing?.url || '')}" placeholder="https://secure-ticket-provider.example/" /></label><button type="button" class="btn-primary ticket-link-save-btn" data-concert-id="${escapeAttr(c.id)}" data-ticket-id="${escapeAttr(editing?.id || '')}" ${busy ? 'disabled' : ''}>Save link</button><button type="button" class="btn-secondary ticket-link-cancel-btn" data-concert-id="${escapeAttr(c.id)}">Cancel</button></div>` : `<div class="owned-ticket-add-actions">${pdfOpenButtons}<button type="button" class="btn-secondary ticket-pdf-select-btn" data-concert-id="${escapeAttr(c.id)}" ${busy ? 'disabled' : ''}>Upload PDF</button><input type="file" class="ticket-pdf-input" data-concert-id="${escapeAttr(c.id)}" accept="application/pdf,.pdf" hidden /><button type="button" class="btn-secondary ticket-link-add-btn" data-concert-id="${escapeAttr(c.id)}" ${busy ? 'disabled' : ''}>Add ticket link</button><small>PDF only · Maximum file size: 10 MB</small></div>`}</section>`;
}

function ticketPreparationPanelHtml(c) {
  return `${ticketCostFormHtml(c, { inPreparation: true })}${ticketOwnedPanelHtml(c)}`;
}

function concertPrepGroupHtml(c) {
  const prediction = c.predictedSetlist || null;
  const confidenceLabel = prediction?.confidence ? `${prediction.confidence[0].toUpperCase()}${prediction.confidence.slice(1)}` : 'Low';
  const predicted = prediction?.status === 'ready' ? `${prediction.predictedSongCount || prediction.songs?.length || 0} songs · ${confidenceLabel} confidence${prediction.spotifyMatchedCount ? ` · ${prediction.spotifyMatchedCount} on Spotify` : ''}` : prediction?.status === 'pending' ? 'Prediction is being prepared' : prediction?.status === 'insufficient_data' ? 'Not enough recent setlists yet' : 'Prediction not available';
  const playlistStatus = predictedPlaylistStatus(c);
  const openPanel = prepOpenPanels.get(c.id) || '';
  const rows = [
    ['ticket', 'ticket', 'Ticket', ticketPrepSummaryHtml(c), ticketPreparationPanelHtml(c)],
    ['playlist', 'spotify', 'Playlist', playlistStatus, `<div class="prep-section"><strong>Your playlist</strong>${c.playlistUrl ? `<p>Manual playlist linked</p><a class="btn-secondary" href="${escapeAttr(c.playlistUrl)}" target="_blank" rel="noopener">Open</a><button type="button" class="prep-edit-playlist">Edit</button><button type="button" class="prep-remove-playlist">Remove</button>` : `<p>Add a playlist you already use before the concert.</p>${playlistFormHtml(c)}`}</div>${predictedMixPanelHtml(c)}`],
    ['weather', 'weather', 'Weather forecast', weatherRowStatus(c), weatherPanelHtml(c)],
    ['prediction', 'setlistOrdered', 'Predicted setlist', predicted, prediction?.status === 'ready' ? `<p>Predicted order based on ${prediction.sourceSetlistCount || 0} recent setlists · ${confidenceLabel} confidence</p><ol>${(prediction.songs || []).slice(0, 10).map((s) => `<li>${escapeHtml(s.name)} <span class="muted">Played in ${s.performanceRate || 0}%${s.evidenceLabel ? ` · ${escapeHtml(s.evidenceLabel)}` : ''}${s.spotifyMatched ? ' · Spotify matched' : ''}</span></li>`).join('')}</ol><p class="muted">Updated ${escapeHtml(prediction.generatedAt ? formatDate(prediction.generatedAt.slice(0, 10)) : 'recently')} · setlist.fm</p><p class="muted">Create a playlist from the Playlist section.</p>` : `<p>${predicted}</p>`],
    ['checklist', 'checklist', 'Checklist', `${prepCount(c)} of 5 complete`, `<div class="prep-checklist">${PREP_CHECKLIST.map(([key, label]) => `<label><input type="checkbox" data-prep-key="${key}" data-concert-id="${escapeAttr(c.id)}" ${c.prepChecklist?.[key] ? 'checked' : ''}/> ${label}</label>`).join('')}<p class="prep-save-error" aria-live="polite"></p></div>`],
  ];
  return `<div class="concert-prep-group" data-open="" data-concert-id="${escapeAttr(c.id)}">${rows.map(([id, iconName, title, status, panel]) => { const isOpen = openPanel === id; return `<button type="button" class="concert-prep-row${isOpen ? ' is-open' : ''}" data-prep-toggle="${id}" aria-expanded="${isOpen}" aria-controls="prep-${escapeAttr(c.id)}-${id}">${icon(iconName)}<span><strong>${title}</strong><small>${id === 'ticket' ? status : escapeHtml(status)}</small></span><span class="details-chevron">${icon('chevronDown')}</span></button>${prepPanel(`${c.id}-${id}`, panel, isOpen)}`; }).join('')}</div>`;
}

// Rating (1-5) and notes, only ever shown for past + attended concerts —
// never upcoming "going" shows. Two states: once either field has been
// filled in, they're always visible on the card (rating + full notes text,
// no expand needed); until then, a collapsed "Add rating & notes" accordion
// holds the entry form so it doesn't clutter the ~1000+ already-logged
// historical shows that will likely never get rated. Photos used to live
// inside this same block/condition, and ticket cost briefly did too — both
// are now their own standalone peer elements (photoLinkHtml, ticketCostBlockHtml
// below), so this only ever tracks rating/notes.
function dlHasReview(c) {
  return !!(c.rating || c.notes);
}

// Ticket cost display line — shows the total actually paid for the show
// (price * quantity), with a "· 2 tickets" note when more than one ticket
// was bought (e.g. going with a partner) so the total doesn't read as a
// single-ticket price. Returns null when no cost has been entered, so
// ticketCostBlockHtml can skip the line entirely rather than showing "0 kr".
// A ticketPrice of exactly 0 means "marked free" (see the Free toggle in
// ticketCostFormHtml) — deliberately distinct from ticketPrice being
// missing/null, which means no cost has been entered at all. Free shows
// still count as a "known" price for the average-ticket-price calculation
// in dlConcertStats (0 is a valid number there, not skipped), so marking a
// free show is what lets it pull the average down instead of being quietly
// left out.
function dlTicketCostLabel(c) {
  if (typeof c.ticketPrice !== 'number' || Number.isNaN(c.ticketPrice)) return null;
  const qty = c.ticketQuantity || 1;
  if (c.ticketPrice === 0) {
    return qty > 1 ? `Free · ${qty} tickets` : 'Free';
  }
  const total = c.ticketPrice * qty;
  const totalLabel = `${total.toLocaleString('sv-SE')} kr`;
  return qty > 1 ? `${totalLabel} · ${qty} tickets` : totalLabel;
}

// Ticket cost — standalone only on past cards. Upcoming cards use the same
// underlying fields inside their Ticket preparation panel so Build 1 can add
// private owned-ticket files/links without changing historical-card visuals.
function ticketCostBlockHtml(c) {
  const costLabel = dlTicketCostLabel(c);
  if (costLabel) {
    return `
      <div class="ticket-cost-block">
        <p class="review-cost">${icon('ticket')}<span>${escapeHtml(costLabel)}</span></p>
        <details class="ticket-cost-edit-toggle">
          <summary>Edit ticket cost<span class="details-chevron">${icon('chevronDown')}</span></summary>
          ${ticketCostFormHtml(c)}
        </details>
      </div>`;
  }
  return `
    <details class="ticket-cost-block ticket-cost-add-toggle">
      <summary>Add ticket cost<span class="details-chevron">${icon('chevronDown')}</span></summary>
      ${ticketCostFormHtml(c)}
    </details>`;
}

function ticketCostFormHtml(c, { inPreparation = false } = {}) {
  const isFree = c.ticketPrice === 0;
  const hasPrice = typeof c.ticketPrice === 'number' && !Number.isNaN(c.ticketPrice);
  return `
    <div class="ticket-cost-form${inPreparation ? ' ticket-cost-form-preparation' : ''}">
      ${inPreparation ? '<strong class="ticket-cost-heading">Ticket cost</strong>' : ''}
      <div class="ticket-cost-free-row">
        <span class="review-cost-label">${inPreparation ? 'Free ticket' : 'Ticket cost'}</span>
        <button type="button" class="toggle-pill ticket-cost-free-toggle${isFree ? ' active' : ''}">${isFree ? icon('check') + ' Free' : 'Free'}</button>
      </div>
      <div class="review-cost-row">
        <label class="review-cost-field">
          <span class="review-cost-label">${inPreparation ? 'Price per ticket' : 'Price'}</span>
          <span class="review-cost-input-wrap">
            <input type="number" class="ticket-price-input" min="0" step="1" inputmode="numeric" placeholder="0" value="${hasPrice ? escapeAttr(c.ticketPrice) : ''}" ${isFree ? 'disabled' : ''} />
            <span class="review-cost-suffix">kr</span>
          </span>
        </label>
        <label class="review-cost-field review-qty-field">
          <span class="review-cost-label">Tickets</span>
          <input type="number" class="ticket-qty-input" min="1" step="1" inputmode="numeric" value="${escapeAttr(c.ticketQuantity || 1)}" />
        </label>
      </div>
      <p class="ticket-cost-free-hint${isFree ? '' : ' hidden'}">Counted as 0 kr in your average ticket price.</p>
      <button type="button" class="btn-primary ticket-cost-save-btn" data-concert-id="${escapeAttr(c.id)}">Save</button>
      ${inPreparation ? `<button type="button" class="btn-secondary ticket-cost-cancel-btn" data-concert-id="${escapeAttr(c.id)}">Cancel</button>` : ''}
    </div>`;
}

function concertReviewHtml(c) {
  if (dlHasReview(c)) {
    return `
      <div class="review-block concert-review">
        ${c.rating ? starsHtml(c.rating) : ''}
        ${c.notes ? `<p class="review-notes">${escapeHtml(c.notes)}</p>` : ''}
        <details class="review-edit-toggle">
          <summary>Edit rating &amp; notes<span class="details-chevron">${icon('chevronDown')}</span></summary>
          ${reviewFormHtml(c)}
        </details>
      </div>`;
  }
  return `
    <details class="review-block review-add-toggle">
      <summary>Add rating &amp; notes<span class="details-chevron">${icon('chevronDown')}</span></summary>
      ${reviewFormHtml(c)}
    </details>`;
}

function starsHtml(rating, { interactive = false } = {}) {
  const r = Number(rating) || 0;
  let html = interactive ? `<span class="star-picker" data-rating="${r}">` : `<span class="stars-display">`;
  for (let i = 1; i <= 5; i++) {
    const filled = i <= r;
    html += interactive
      ? `<button type="button" class="star-btn${filled ? ' filled' : ''}" data-value="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">${icon(filled ? 'starFill' : 'star')}</button>`
      : `<span class="star-btn${filled ? ' filled' : ''}">${icon(filled ? 'starFill' : 'star')}</span>`;
  }
  return html + '</span>';
}

// Larger textarea than the app's other free-text inputs (rows="4"), since
// this is meant to hold an actual few-sentence review rather than a single
// line like the "Add a band"/"Add a past concert" forms.
function reviewFormHtml(c) {
  return `
    <div class="review-form">
      ${starsHtml(c.rating, { interactive: true })}
      <textarea class="review-notes-input" rows="4" placeholder="What did you think of this show?">${escapeHtml(c.notes || '')}</textarea>
      <button type="button" class="btn-primary review-save-btn" data-concert-id="${escapeAttr(c.id)}">Save</button>
    </div>`;
}

function buildGoogleMapsUrl(c) {
  const query = c.venueAddress
    ? `${c.venue}, ${c.venueAddress}`
    : [c.venue, c.city, c.country].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

async function patchLatestConcert(concertId, patch) {
  const latest = await dlReadJsonFile(remote, 'concerts.json', []);
  const index = latest.findIndex((item) => item.id === concertId);
  if (index < 0) throw new Error('This concert was removed before it could be saved.');
  const updated = patch(latest[index]);
  const next = latest.map((item, itemIndex) => itemIndex === index ? updated : item);
  await dlWriteJsonFile(remote, 'concerts.json', next);
  concerts = next;
  return updated;
}

async function hydrateTicketCacheStatus(concert, refresh) {
  const pdfs = ownedTicketItems(concert).filter((item) => item.type === 'pdf');
  if (!pdfs.length) return;
  const results = await Promise.all(pdfs.map(async (item) => [item.id, await OwnedTickets.readCachedPdf(concert.id, item.id)]));
  let changed = false;
  for (const [id, cache] of results) {
    const key = `${concert.id}:${id}`;
    if (ticketCacheStatus.get(key) !== cache.state) { ticketCacheStatus.set(key, cache.state); changed = true; }
  }
  if (changed && prepOpenPanels.get(concert.id) === 'ticket') refresh();
}

async function removeManuallyAddedConcert(concertId) {
  const latest = await dlReadJsonFile(remote, 'concerts.json', []);
  const concert = latest.find((item) => item.id === concertId);
  if (!concert) throw new Error('This concert was removed before it could be saved.');
  const next = latest.filter((item) => item.id !== concertId);
  const pdfs = ownedTicketItems(concert).filter((item) => item.type === 'pdf');
  const result = await OwnedTickets.removeConcertAfterMetadataSave({
    saveMetadata: async () => { await dlWriteJsonFile(remote, 'concerts.json', next); concerts = next; },
    pdfTickets: pdfs,
    cleanupRemote: (item) => OwnedTickets.deletePdf(remote, concert.id, item.id),
    cleanupCache: () => OwnedTickets.removeCachedConcert(concert.id),
  });
  return result.failures.map((error) => error.message || 'Could not delete a ticket PDF.');
}

// refresh defaults to My Concerts' own re-render; the band-profile page
// (which reuses this same wiring for its Past concerts cards, see
// renderProfileScreen) passes its own re-render instead so edits made from
// a band's page redraw that page rather than jumping the user to My
// Concerts.
function wireMyConcertsHandlers(container, refresh = renderMyConcertsScreen) {
  container.querySelector('#past-concert-submit')?.addEventListener('click', onAddPastConcert);
  container.querySelector('#stats-teaser-cta')?.addEventListener('click', () => openStatsScreen());
  container.querySelector('#past-concert-year')?.addEventListener('change', () => refreshPastConcertDayOptions(container));
  container.querySelector('#past-concert-month')?.addEventListener('change', () => refreshPastConcertDayOptions(container));

  container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (
        ev.target.closest('.icon-btn') ||
        ev.target.closest('.venue-address-link') ||
        ev.target.closest('.review-block') ||
        ev.target.closest('.ticket-cost-block') ||
        ev.target.closest('.row-links-group') ||
        ev.target.closest('.concert-prep-group')
      ) return;
      openProfile(row.dataset.bandId);
    });
  });

  // Preparation controls are all interactive. Contain their clicks here as
  // well as excluding the group in the card-navigation guard above, because
  // a checkbox click reaches the card before its later change event fires.
  container.querySelectorAll('.concert-prep-group').forEach((group) => {
    group.addEventListener('click', (ev) => ev.stopPropagation());
  });

  // Playlist/Photos/Setlist row (see mcLinksRowHtml) — tapping a trigger or
  // an Edit/Add button shows the matching full-width panel below both rows;
  // only one panel stays open at a time per card.
  container.querySelectorAll('[data-toggle-panel]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const group = btn.closest('.row-links-group');
      if (!group) return;
      const which = btn.dataset.togglePanel;
      const target = group.querySelector(`.expand-panel[data-panel="${which}"]`);
      if (!target) return;
      const isOpening = target.hidden;
      group.querySelectorAll('.expand-panel').forEach((p) => { p.hidden = true; });
      group.querySelectorAll('[data-toggle-panel]').forEach((b) => b.classList.remove('is-open'));
      if (isOpening) {
        target.hidden = false;
        btn.classList.add('is-open');
        group.dataset.open = which;
      } else {
        group.dataset.open = '';
      }
    });
  });

  container.querySelectorAll('[data-prep-toggle]').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation(); const group = btn.closest('.concert-prep-group'); const id = btn.getAttribute('aria-controls'); const panel = group?.querySelector(`#${CSS.escape(id)}`); if (!panel) return;
    const open = panel.hidden; group.querySelectorAll('.concert-prep-panel').forEach((item) => { item.hidden = true; }); group.querySelectorAll('[data-prep-toggle]').forEach((item) => { item.setAttribute('aria-expanded', 'false'); item.classList.remove('is-open'); });
    if (open) {
      panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-open'); prepOpenPanels.set(group.dataset.concertId, btn.dataset.prepToggle);
      if (btn.dataset.prepToggle === 'ticket') { const concert = concerts.find((item) => item.id === group.dataset.concertId); if (concert) hydrateTicketCacheStatus(concert, refresh); }
    } else prepOpenPanels.delete(group.dataset.concertId);
  }));
  container.querySelectorAll('.weather-retry').forEach((btn) => btn.addEventListener('click', (ev) => { ev.stopPropagation(); const concert = concerts.find((item) => item.id === btn.dataset.concertId); if (concert) ensureConcertWeather(concert, true); }));
  container.querySelectorAll('.playlist-review-open').forEach((btn) => btn.addEventListener('click', (ev) => { ev.stopPropagation(); const c = concerts.find((item) => item.id === btn.dataset.concertId); if (!c) return; playlistReviews.set(c.id, { name: predictedMixName(c), uris: predictedMixSongs(c).map((song) => song.spotifyUri), message: '' }); prepOpenPanels.set(c.id, 'playlist'); refresh(); }));
  container.querySelectorAll('.playlist-review-cancel').forEach((btn) => btn.addEventListener('click', (ev) => { ev.stopPropagation(); playlistReviews.delete(btn.dataset.concertId); refresh(); }));
  container.querySelectorAll('.predicted-playlist-name').forEach((input) => input.addEventListener('input', () => { const review = playlistReviews.get(input.dataset.concertId); if (review) review.name = input.value; }));
  container.querySelectorAll('.predicted-track-check').forEach((input) => input.addEventListener('change', () => { const review = playlistReviews.get(input.dataset.concertId); if (!review) return; review.uris = review.uris.filter((uri) => uri !== input.dataset.uri); if (input.checked) { const c = concerts.find((item) => item.id === input.dataset.concertId); const order = predictedMixSongs(c).map((song) => song.spotifyUri); review.uris = order.filter((uri) => review.uris.includes(uri) || uri === input.dataset.uri); } refresh(); }));
  container.querySelectorAll('.playlist-create-confirm').forEach((btn) => btn.addEventListener('click', async (ev) => { ev.stopPropagation(); const c = concerts.find((item) => item.id === btn.dataset.concertId); const review = playlistReviews.get(btn.dataset.concertId); if (!c || !review?.uris.length || playlistOperations.has(c.id)) return; prepOpenPanels.set(c.id, 'playlist'); if (!await SpotifyUser.getAuth()) { review.message = 'Spotify is not connected. Connect Spotify in Settings.'; refresh(); return; } playlistOperations.set(c.id, true); review.message = 'Creating playlist…'; refresh(); try { const result = await SpotifyUser.createPrivatePlaylist(review.name.trim() || predictedMixName(c), review.uris, fetch, review.operation); review.operation = { playlist: result.playlist, added: result.added }; const metadata = { spotifyPlaylistId: result.playlist.id, spotifyUrl: result.playlist.external_urls.spotify, name: review.name.trim() || predictedMixName(c), trackCount: result.added, sourcePredictionFingerprint: c.predictedSetlist?.fingerprint || null, createdAt: new Date().toISOString() }; const latest = await dlReadJsonFile(remote, 'concerts.json', []); const exists = latest.some((item) => item.id === c.id); if (!exists) throw new Error('Playlist exists, but this concert was removed before it could be saved.'); await dlWriteJsonFile(remote, 'concerts.json', latest.map((item) => item.id === c.id ? { ...item, predictedPlaylist: metadata } : item)); concerts = latest.map((item) => item.id === c.id ? { ...item, predictedPlaylist: metadata } : item); playlistReviews.delete(c.id); } catch (error) { if (error.operation) review.operation = error.operation; review.message = error.operation ? 'Playlist created, but tracks could not be added. Try again.' : review.operation?.playlist ? 'Playlist created, but could not be saved in the app. Try again.' : (error.message || 'Could not create playlist. Try again.'); } finally { playlistOperations.delete(c.id); refresh(); } }));
  container.querySelectorAll('[data-prep-key]').forEach((input) => {
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('change', async (ev) => {
    ev.stopPropagation(); const c = concerts.find((item) => item.id === input.dataset.concertId); if (!c) return; const previous = c.prepChecklist;
    c.prepChecklist = { ticketReady: false, travelPlanned: false, timesChecked: false, venueRulesChecked: false, playlistReady: false, ...(previous || {}), [input.dataset.prepKey]: input.checked, updatedAt: new Date().toISOString() };
    try { await dlWriteJsonFile(remote, 'concerts.json', concerts); refresh(); } catch (error) { c.prepChecklist = previous; input.checked = !input.checked; const message = input.closest('.prep-checklist')?.querySelector('.prep-save-error'); if (message) message.textContent = 'Could not save. Please try again.'; }
    });
  });
  container.querySelectorAll('.prep-edit-playlist').forEach((btn) => btn.addEventListener('click', (ev) => { ev.stopPropagation(); const panel = btn.closest('.concert-prep-panel'); panel.innerHTML = playlistFormHtml(concerts.find((c) => c.id === btn.closest('.row-card-mc').querySelector('.remove-going-btn').dataset.concertId)); }));
  container.querySelectorAll('.prep-remove-playlist').forEach((btn) => btn.addEventListener('click', async (ev) => { ev.stopPropagation(); if (!confirm('Remove this playlist link?')) return; const c = concerts.find((item) => item.id === btn.closest('.row-card-mc').querySelector('.remove-going-btn').dataset.concertId); if (!c) return; const previous = c.playlistUrl; c.playlistUrl = null; try { await dlWriteJsonFile(remote, 'concerts.json', concerts); refresh(); } catch { c.playlistUrl = previous; } }));

  container.querySelectorAll('.remove-going-btn').forEach((b) => {
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const concertId = b.dataset.concertId;
      const c = concerts.find((x) => x.id === concertId);
      if (!c) return;
      if (c.manuallyAdded) {
        if (!confirm('Remove this concert from your history? This deletes it completely since it was added by hand.')) return;
        try {
          const failures = await removeManuallyAddedConcert(concertId);
          refresh();
          if (failures.length) alert(`Concert removed, but ${failures.length === 1 ? 'a private ticket file could not be cleaned up' : 'some private ticket files could not be cleaned up'}.`);
        } catch (error) { alert(error.message || 'Could not remove this concert.'); }
        return;
      } else {
        c.attending = false;
      }
      await dlWriteJsonFile(remote, 'concerts.json', concerts);
      refresh();
    });
  });

  // Rating stars: clicking one just updates the pending value + visual fill
  // in place — the actual write happens once via the Save button below, so
  // stars/notes/photo link all land in a single dlWriteJsonFile call rather
  // than racing each other.
  container.querySelectorAll('.star-picker').forEach((picker) => {
    picker.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.star-btn');
      if (!btn) return;
      ev.stopPropagation();
      const value = Number(btn.dataset.value);
      picker.dataset.rating = String(value);
      picker.querySelectorAll('.star-btn').forEach((b) => {
        const filled = Number(b.dataset.value) <= value;
        b.classList.toggle('filled', filled);
        b.innerHTML = icon(filled ? 'starFill' : 'star');
      });
    });
  });

  container.querySelectorAll('.review-save-btn').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const concertId = btn.dataset.concertId;
      const c = concerts.find((x) => x.id === concertId);
      if (!c) return;
      const form = btn.closest('.review-form');
      const picker = form.querySelector('.star-picker');
      const rating = picker ? Number(picker.dataset.rating) || null : null;
      const notes = form.querySelector('.review-notes-input').value.trim();
      c.rating = rating || null;
      c.notes = notes || null;
      await dlWriteJsonFile(remote, 'concerts.json', concerts);
      refresh();
    });
  });

  // Ticket cost — separate save action from rating/notes above (see
  // ticketCostBlockHtml/ticketCostFormHtml), used on both upcoming and past
  // cards, unlike the review form which is past-only.
  container.querySelectorAll('.ticket-cost-save-btn').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const concertId = btn.dataset.concertId;
      const form = btn.closest('.ticket-cost-form');
      const priceRaw = form.querySelector('.ticket-price-input').value;
      const qtyRaw = form.querySelector('.ticket-qty-input').value;
      // Read as a plain Number() + isNaN check, not `Number(x) || null` — the
      // old `||` version silently turned a genuine 0 price into null, which
      // would have broken the new Free toggle (0 kr) the same way.
      const parsedPrice = priceRaw !== '' ? Number(priceRaw) : null;
      const ticketPrice = parsedPrice === null || Number.isNaN(parsedPrice) ? null : parsedPrice;
      try {
        await patchLatestConcert(concertId, (latest) => ({ ...latest, ticketPrice, ticketQuantity: ticketPrice !== null ? (Number(qtyRaw) || 1) : null }));
        if (btn.closest('.concert-prep-panel')) prepOpenPanels.set(concertId, 'ticket');
        refresh();
      } catch (error) {
        const message = form.querySelector('.ticket-cost-save-error') || document.createElement('p');
        message.className = 'ticket-cost-save-error error'; message.setAttribute('aria-live', 'polite'); message.textContent = error.message || 'Could not save ticket cost.';
        if (!message.parentNode) form.appendChild(message);
      }
    });
  });

  container.querySelectorAll('.ticket-cost-cancel-btn').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation(); prepOpenPanels.set(btn.dataset.concertId, 'ticket'); refresh();
  }));

  // Free toggle — a plain client-side flip of the price input's value/
  // disabled state before Save is pressed (no data write here). Marking a
  // show free sets the price to 0 and disables the field; toggling back off
  // clears it to blank so the user can enter a real price again.
  container.querySelectorAll('.ticket-cost-free-toggle').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const form = btn.closest('.ticket-cost-form');
      const priceInput = form.querySelector('.ticket-price-input');
      const hint = form.querySelector('.ticket-cost-free-hint');
      const nowFree = !btn.classList.contains('active');
      btn.classList.toggle('active', nowFree);
      btn.innerHTML = nowFree ? `${icon('check')} Free` : 'Free';
      priceInput.disabled = nowFree;
      priceInput.value = nowFree ? '0' : '';
      hint?.classList.toggle('hidden', !nowFree);
    });
  });

  container.querySelectorAll('.ticket-link-add-btn').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ticketPanelViews.set(btn.dataset.concertId, 'add-link'); prepOpenPanels.set(btn.dataset.concertId, 'ticket'); refresh();
  }));
  container.querySelectorAll('.ticket-link-edit-btn').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ticketPanelViews.set(btn.dataset.concertId, `edit:${btn.dataset.ticketId}`); prepOpenPanels.set(btn.dataset.concertId, 'ticket'); refresh();
  }));
  container.querySelectorAll('.ticket-link-cancel-btn').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ticketPanelViews.delete(btn.dataset.concertId); prepOpenPanels.set(btn.dataset.concertId, 'ticket'); refresh();
  }));
  container.querySelectorAll('.ticket-link-save-btn').forEach((btn) => btn.addEventListener('click', async (ev) => {
    ev.stopPropagation(); const concertId = btn.dataset.concertId; const url = OwnedTickets.safeUrl(btn.closest('.owned-ticket-link-form').querySelector('.owned-ticket-url-input').value);
    const status = btn.closest('.owned-ticket-section').querySelector('.ticket-operation-status');
    if (!url) { status.textContent = 'Enter a secure https ticket link.'; return; }
    if (ticketOperations.has(concertId)) return;
    ticketOperations.set(concertId, true); btn.disabled = true; status.textContent = 'Saving ticket link…';
    try {
      const editingId = btn.dataset.ticketId;
      await patchLatestConcert(concertId, (latest) => {
        const items = OwnedTickets.orderedTickets(latest.ownedTickets);
        const next = editingId ? items.map((item) => item.id === editingId ? { ...item, url } : item) : [...items, { id: OwnedTickets.createId(), type: 'url', url, addedAt: new Date().toISOString() }];
        return { ...latest, ownedTickets: next };
      });
      ticketPanelViews.delete(concertId); prepOpenPanels.set(concertId, 'ticket'); ticketOperations.delete(concertId); refresh();
    } catch (error) { status.textContent = error.message || 'Could not save ticket link.'; btn.disabled = false; } finally { ticketOperations.delete(concertId); }
  }));
  container.querySelectorAll('.ticket-pdf-select-btn').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation(); btn.closest('.owned-ticket-section').querySelector('.ticket-pdf-input')?.click();
  }));
  container.querySelectorAll('.ticket-pdf-input').forEach((input) => input.addEventListener('change', async (ev) => {
    ev.stopPropagation(); const concertId = input.dataset.concertId; const file = input.files?.[0]; const section = input.closest('.owned-ticket-section'); const status = section.querySelector('.ticket-operation-status');
    if (!file || ticketOperations.has(concertId)) return;
    ticketOperations.set(concertId, true); status.textContent = 'Uploading PDF…'; const ticketId = OwnedTickets.createId();
    try {
      const metadata = await OwnedTickets.uploadPdf(remote, concertId, ticketId, file);
      const cache = await OwnedTickets.finalizeUploadedPdf({
        saveMetadata: () => patchLatestConcert(concertId, (latest) => ({ ...latest, ownedTickets: [...OwnedTickets.orderedTickets(latest.ownedTickets), metadata] })),
        writeCache: () => OwnedTickets.writeCachedPdf(concertId, ticketId, file),
        cleanupRemote: () => OwnedTickets.deletePdf(remote, concertId, ticketId),
        cleanupCache: () => OwnedTickets.removeCachedPdf(concertId, ticketId),
      });
      ticketCacheStatus.set(`${concertId}:${ticketId}`, cache.state);
      ticketNotices.set(concertId, cache.cacheError ? 'PDF saved. Offline copy unavailable on this device.' : 'PDF saved.');
      prepOpenPanels.set(concertId, 'ticket'); ticketOperations.delete(concertId); refresh();
    } catch (error) { status.textContent = error.message || 'Could not upload PDF.'; input.value = ''; } finally { ticketOperations.delete(concertId); }
  }));
  container.querySelectorAll('.ticket-pdf-open-btn').forEach((btn) => btn.addEventListener('click', async (ev) => {
    ev.stopPropagation(); const status = btn.closest('.owned-ticket-section').querySelector('.ticket-operation-status');
    try {
      const result = await OwnedTickets.openPdf(remote, btn.dataset.concertId, btn.dataset.ticketId);
      ticketCacheStatus.set(`${btn.dataset.concertId}:${btn.dataset.ticketId}`, result.cacheState);
      ticketNotices.set(btn.dataset.concertId, result.cacheWriteFailed ? 'Ticket opened. Offline copy unavailable on this device.' : '');
      prepOpenPanels.set(btn.dataset.concertId, 'ticket'); refresh();
    }
    catch (error) { status.textContent = error.message || 'Could not open PDF.'; }
  }));
  container.querySelectorAll('.ticket-remove-btn').forEach((btn) => btn.addEventListener('click', async (ev) => {
    ev.stopPropagation(); const concertId = btn.dataset.concertId; const ticketId = btn.dataset.ticketId; const concert = concerts.find((item) => item.id === concertId); const item = concert && OwnedTickets.orderedTickets(concert.ownedTickets).find((candidate) => candidate.id === ticketId);
    const status = btn.closest('.owned-ticket-section').querySelector('.ticket-operation-status');
    if (!item || !confirm(`Remove ${item.type === 'pdf' ? 'this PDF ticket' : 'this ticket link'}?`)) return;
    if (ticketOperations.has(concertId)) return; ticketOperations.set(concertId, true); btn.disabled = true; status.textContent = 'Removing ticket…';
    try {
      let removed;
      const result = await OwnedTickets.removePdfAfterMetadataSave({
        saveMetadata: () => patchLatestConcert(concertId, (latest) => {
          const items = OwnedTickets.orderedTickets(latest.ownedTickets);
          removed = items.find((candidate) => candidate.id === ticketId);
          if (!removed) throw new Error('This ticket was already removed.');
          return { ...latest, ownedTickets: items.filter((candidate) => candidate.id !== ticketId) };
        }),
        cleanupRemote: () => removed.type === 'pdf' ? OwnedTickets.deletePdf(remote, concertId, ticketId) : null,
        cleanupCache: () => removed.type === 'pdf' ? OwnedTickets.removeCachedPdf(concertId, ticketId) : null,
      });
      if (removed.type === 'pdf') {
        ticketCacheStatus.delete(`${concertId}:${ticketId}`);
      }
      ticketNotices.set(concertId, result.remoteError ? 'Ticket removed from the app, but remote file cleanup failed.' : '');
      prepOpenPanels.set(concertId, 'ticket'); ticketOperations.delete(concertId); refresh();
    } catch (error) { status.textContent = error.message || 'Could not remove ticket.'; btn.disabled = false; } finally { ticketOperations.delete(concertId); }
  }));

  container.querySelectorAll('.playlist-save-btn').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const concertId = btn.dataset.concertId;
      const c = concerts.find((x) => x.id === concertId);
      if (!c) return;
      const form = btn.closest('.playlist-form');
      let playlistUrl = form.querySelector('.playlist-url-input').value.trim();
      if (playlistUrl && !/^https?:\/\//i.test(playlistUrl)) playlistUrl = 'https://' + playlistUrl;
      c.playlistUrl = playlistUrl || null;
      await dlWriteJsonFile(remote, 'concerts.json', concerts);
      refresh();
    });
  });

  container.querySelectorAll('.photo-save-btn').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const concertId = btn.dataset.concertId;
      const c = concerts.find((x) => x.id === concertId);
      if (!c) return;
      const form = btn.closest('.photo-form');
      let photoUrl = form.querySelector('.photo-url-input').value.trim();
      if (photoUrl && !/^https?:\/\//i.test(photoUrl)) photoUrl = 'https://' + photoUrl;
      c.photoUrl = photoUrl || null;
      await dlWriteJsonFile(remote, 'concerts.json', concerts);
      refresh();
    });
  });
}

// A plain <input type="date"> forces the native calendar picker's
// month-by-month paging to reach an old year — fine for last month, painful
// for 2002. Three independent <select>s let you jump straight to any year
// in one tap instead of paging back decades. Year list is capped at 1960;
// bump the floor if you ever need to backlog something older.
function pastConcertYearOptionsHtml() {
  const currentYear = new Date().getFullYear();
  let html = '<option value="">Year</option>';
  for (let y = currentYear; y >= 1960; y--) html += `<option value="${y}">${y}</option>`;
  return html;
}

function pastConcertMonthOptionsHtml() {
  let html = '<option value="">Month</option>';
  MONTH_NAMES.forEach((name, i) => {
    const v = String(i + 1).padStart(2, '0');
    html += `<option value="${v}">${name}</option>`;
  });
  return html;
}

function pastConcertDayOptionsHtml(daysInMonth = 31) {
  let html = '<option value="">Day</option>';
  for (let d = 1; d <= daysInMonth; d++) html += `<option value="${String(d).padStart(2, '0')}">${d}</option>`;
  return html;
}

// Rebuilds the Day dropdown to match the selected Year/Month (leap-year
// aware via `new Date(y, m, 0).getDate()`) so it's impossible to pick a
// date that doesn't exist, like Feb 31 — falls back to a generic 31-day
// list until both Year and Month are chosen. Preserves the previously
// selected day if it's still valid in the new range.
function refreshPastConcertDayOptions(container) {
  const yearSel = container.querySelector('#past-concert-year');
  const monthSel = container.querySelector('#past-concert-month');
  const daySel = container.querySelector('#past-concert-day');
  if (!yearSel || !monthSel || !daySel) return;
  const year = Number(yearSel.value) || null;
  const month = Number(monthSel.value) || null;
  const daysInMonth = year && month ? new Date(year, month, 0).getDate() : 31;
  const previousDay = daySel.value;
  daySel.innerHTML = pastConcertDayOptionsHtml(daysInMonth);
  if (previousDay && Number(previousDay) <= daysInMonth) daySel.value = previousDay;
}

async function onAddPastConcert() {
  const bandSel = el('past-concert-band');
  const venueInput = el('past-concert-venue');
  const typeSel = el('past-concert-type');
  const cityInput = el('past-concert-city');
  const countryInput = el('past-concert-country');
  const addressInput = el('past-concert-address');
  const yearSel = el('past-concert-year');
  const monthSel = el('past-concert-month');
  const daySel = el('past-concert-day');
  const errEl = el('past-concert-error');
  errEl.classList.add('hidden');

  const bandId = bandSel.value;
  const venue = venueInput.value.trim();
  const type = typeSel.value === 'festival' ? 'festival' : 'concert';
  const city = cityInput.value.trim();
  const country = countryInput.value.trim();
  const venueAddress = addressInput.value.trim();
  const year = yearSel.value;
  const month = monthSel.value;
  const day = daySel.value;
  const date = year && month && day ? `${year}-${month}-${day}` : '';

  if (!bandId || !venue || !city || !date) {
    errEl.textContent = 'Band, venue, city and date (year, month, day) are required.';
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
    type,
  };
  concerts.push(concert);
  await dlWriteJsonFile(remote, 'concerts.json', concerts);

  bandSel.value = '';
  venueInput.value = '';
  typeSel.value = 'concert';
  cityInput.value = '';
  countryInput.value = '';
  addressInput.value = '';
  yearSel.value = '';
  monthSel.value = '';
  daySel.value = '';
  renderMyConcertsScreen();
}

/* ---------------- My bands tab ---------------- */

function renderMyBandsScreen() {
  const container = el('screen-mybands');
  let sorted = [...bands].sort((a, b) => a.name.localeCompare(b.name));
  const totalBandCount = bands.length;
  const activityById = new Map(sorted.map((b) => [b.id, dlBandActivity(b, concerts, inactivityYears)]));
  if (hideInactiveBands) sorted = sorted.filter((b) => activityById.get(b.id).status === 'active');
  if (selectedGenre !== 'all') sorted = sorted.filter((b) => dlGenreGroupsForBand(b).includes(selectedGenre));
  // Lets you find muted bands again to unmute them, without hunting through
  // the whole list — parallel to "Hide inactive bands" above.
  if (mutedOnly) sorted = sorted.filter((b) => b.muted);

  // Grouped filter (Rock / Punk / Metal / Hip-hop & R&B / Pop / Folk / Not
  // tagged yet) rather than the ~90 raw, inconsistently-formatted genre
  // strings — see dlGenreGroupsForBand in dataLib.js. This never touches
  // band.genre itself, which still shows its original raw value on the
  // band's own profile page.
  const genreOptionsHtml = DL_GENRE_GROUPS.map((g) => `<option value="${g.id}"${g.id === selectedGenre ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('');

  // Total count of ALL bands (not the filtered/sorted list below, which
  // shrinks when "Hide inactive" or a genre filter is active) — echoes the
  // bold-number-plus-muted-label language used by the stats teaser card on
  // My Concerts, just as a single inline stat rather than a whole card,
  // since there's only one number to show here.
  let html = `
    <p class="bands-total-header"><span class="bands-total-value">${totalBandCount.toLocaleString()}</span> bands in your collection</p>
    <div class="filter-row">
      <span class="filter-label">Hide inactive bands</span>
      <button id="hide-inactive-toggle" class="toggle-pill${hideInactiveBands ? ' active' : ''}">${hideInactiveBands ? 'On' : 'Off'}</button>
    </div>
    <div class="filter-row">
      <span class="filter-label">Show muted only</span>
      <button id="muted-filter-toggle" class="toggle-pill${mutedOnly ? ' active' : ''}">${mutedOnly ? 'On' : 'Off'}</button>
    </div>
    <div class="filter-row">
      <span class="filter-label">Genre</span>
      <select id="genre-filter-select">
        <option value="all"${selectedGenre === 'all' ? ' selected' : ''}>All genres</option>
        ${genreOptionsHtml}
      </select>
    </div>`;

  let lastLetter = '';
  for (const band of sorted) {
    const letter = band.name[0]?.toUpperCase() || '#';
    if (letter !== lastLetter) {
      html += `<p class="section-label">${letter}</p>`;
      lastLetter = letter;
    }
    // Edit/delete used to live as icon buttons on this row — moved to the
    // band's own profile page (edit icon next to the name, delete tucked
    // away at the bottom as a deliberate "danger zone" so it's not one
    // accidental tap away from the list). This row is now just a plain,
    // tappable summary.
    const activity = activityById.get(band.id);
    html += `
      <div class="row-card clickable" data-band-id="${band.id}">
        <div class="row-top">
          <div class="row-title-group">
            <span class="row-name">${escapeHtml(band.name)}${band._enriching ? ' <span class="muted" style="font-weight:400">· fetching info…</span>' : ''}</span>
            ${activityBadgeHtml(activity)}
          </div>
          <span class="row-chevron">${icon('chevronRight')}</span>
        </div>
        ${activity.status !== 'active' ? `<p class="row-sub">${activity.status === 'unknown' ? 'No concerts on record' : `Last known show · ${activity.lastYear}`}</p>` : ''}
      </div>`;
  }

  if (sorted.length === 0) {
    html += `<p class="screen-empty">${hideInactiveBands || selectedGenre !== 'all' || mutedOnly ? 'No bands match these filters — adjust them above to see more.' : 'No bands yet — add your first one below.'}</p>`;
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
  container.querySelector('#muted-filter-toggle')?.addEventListener('click', async () => {
    mutedOnly = !mutedOnly;
    await chrome.storage.local.set({ mutedOnly });
    renderMyBandsScreen();
  });
  container.querySelector('#genre-filter-select')?.addEventListener('change', async (ev) => {
    selectedGenre = ev.target.value;
    await chrome.storage.local.set({ selectedGenre });
    renderMyBandsScreen();
  });

  container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
    row.addEventListener('click', () => openProfile(row.dataset.bandId));
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

/* ---------------- News tab ---------------- */
//
// news.json validation rules (enforced by whatever writes to this file —
// the weekly GitHub Actions research pipeline, scripts/research.js, not
// this client, which only reads/displays):
//   1. Scope — only bands present in bands.json, matched by exact name/id,
//      never guessed. Ambiguous band names are skipped rather than assumed.
//   2. Recency — only items discovered in roughly the last 14 days count as
//      "new" for a given pipeline run; older items already in the file are
//      left alone.
//   3. concert / album / ticket — relaxed sourcing. Each requires a hard,
//      checkable fact (a date+venue, an album title, or a live ticket
//      link/on-sale date), so the source outlet matters less than the fact
//      itself being present and specific.
//   4. hiatus — stricter bar. Only published if backed by a direct quote/
//      statement from the band or label, or corroborated by 2+ independent
//      outlets. Otherwise treated as unconfirmed rumor and dropped.
//   5. Dedup — skip if an item for the same band+category+fact already
//      exists in the file.

// Category metadata: label shown as the card's kicker, and which CSS
// variable supplies its color. Colors themselves live in app.css (they
// differ between light/dark mode) — see --news-concert/--news-album/
// --news-ticket/--news-hiatus.
const NEWS_CATEGORIES = {
  concert: { label: 'Concert announcement', varName: '--news-concert' },
  album: { label: 'New album', varName: '--news-album' },
  ticket: { label: 'Tickets on sale', varName: '--news-ticket' },
  hiatus: { label: 'Band news', varName: '--news-hiatus' },
};

// This screen is now two sub-views under one tab: the original News feed
// (editorial content from the research pipeline — announcements, albums,
// tickets, band status) and a new Alerts view (a plain chronological log of
// "a new show was added" events, derived straight from concerts.json's own
// foundAt/isNew fields rather than a separately-stored list — see
// getAlertItems). Switching sub-tabs doesn't change the URL/history stack,
// same as the EU/Nearby filters elsewhere in the app.
function renderNewsScreen() {
  const container = el('screen-news');
  const switchHtml = `
    <div class="news-subtab-switch">
      <button class="news-subtab-btn${newsSubTab === 'alerts' ? ' active' : ''}" data-subtab="alerts">Alerts</button>
      <button class="news-subtab-btn${newsSubTab === 'news' ? ' active' : ''}" data-subtab="news">News</button>
    </div>`;

  let bodyHtml;
  if (newsSubTab === 'alerts') {
    const alerts = getAlertItems();
    bodyHtml = alerts.length === 0
      ? `<p class="screen-empty">No new shows found in the last 90 days.</p>`
      : alerts.map(alertRowHtml).join('');
  } else {
    const sorted = [...news].sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''));
    bodyHtml = sorted.length === 0
      ? `<p class="screen-empty">No news yet. Concert and album announcements, ticket on-sale dates, and band status updates for the acts you track will show up here.</p>`
      : sorted.map(newsCardHtml).join('');
  }

  container.innerHTML = switchHtml + bodyHtml;

  container.querySelectorAll('.news-subtab-btn').forEach((b) => {
    b.addEventListener('click', () => {
      newsSubTab = b.dataset.subtab;
      renderNewsScreen();
      if (newsSubTab === 'alerts') markAlertsSeen();
    });
  });
  if (newsSubTab === 'alerts') {
    container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
      row.addEventListener('click', () => openProfile(row.dataset.bandId));
    });
  }
}

function newsCardHtml(n) {
  const cat = NEWS_CATEGORIES[n.category] || { label: 'News', varName: '--news-hiatus' };
  const metaParts = [n.bandName, formatShortDate(n.date), n.sourceName].filter(Boolean);
  return `
    <div class="news-card">
      <span class="news-card-bar" style="background:var(${cat.varName})"></span>
      <p class="news-kicker" style="color:var(${cat.varName})">${escapeHtml(cat.label.toUpperCase())}</p>
      ${n.sourceUrl
        ? `<a class="news-headline-link" href="${escapeAttr(n.sourceUrl)}" target="_blank" rel="noopener"><p class="news-headline">${escapeHtml(n.headline)}</p></a>`
        : `<p class="news-headline">${escapeHtml(n.headline)}</p>`}
      <p class="news-meta">${escapeHtml(metaParts.join(' · '))}</p>
    </div>`;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
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

// Editing a band's name/URL now happens on its own profile page rather than
// inline in the My Bands list (see QA/design pass — the edit/delete icons on
// every list row were cluttering a screen you mostly just want to scan).
function bandEditFormHtml(band) {
  return `
    <div class="row-card">
      <p class="section-label" style="margin-top:0">Edit band</p>
      <input type="text" class="edit-name" value="${escapeAttr(band.name)}" placeholder="Band name" />
      <input type="url" class="edit-url" value="${escapeAttr(band.officialUrl || '')}" placeholder="Official band URL" />
      <div class="show-buttons" style="margin-top:8px">
        <button class="btn-primary edit-save">Save</button>
        <button class="btn-secondary edit-cancel">Cancel</button>
      </div>
    </div>`;
}

function wireBandEditForm(container, bandId) {
  container.querySelector('.edit-save').addEventListener('click', async () => {
    const name = container.querySelector('.edit-name').value.trim();
    const url = container.querySelector('.edit-url').value.trim();
    if (!name) return;
    const band = bands.find((x) => x.id === bandId);
    band.name = name;
    band.officialUrl = url || null;
    await dlWriteJsonFile(remote, 'bands.json', bands);
    editingBandId = null;
    renderProfileScreen(bandId);
  });
  container.querySelector('.edit-cancel').addEventListener('click', () => {
    editingBandId = null;
    renderProfileScreen(bandId);
  });
}

function renderProfileScreen(bandId) {
  const band = bands.find((b) => b.id === bandId);
  const container = el('screen-profile');
  if (!band) {
    container.innerHTML = `<p class="screen-empty">Band not found.</p>`;
    return;
  }
  if (editingBandId === bandId) {
    container.innerHTML = bandEditFormHtml(band);
    wireBandEditForm(container, bandId);
    return;
  }
  const shows = dlAllUpcomingForBand(concerts, bandId);
  let filteredShows = shows;
  if (profileEuropeOnly) filteredShows = filteredShows.filter((c) => dlIsEuropeCountry(c.country));
  else if (profileNearbyOnly) filteredShows = filteredShows.filter((c) => dlIsNearby(c));
  // Past/attended shows for just this band — same attending+date-passed
  // definition as dlMyConcerts' "past" bucket, scoped to bandId and sorted
  // newest-first to match My Concerts. Rendered with the exact same
  // myConcertRowHtml used there (see below), just without that card's band
  // name line, which would be redundant on the band's own page.
  const pastAttended = concerts
    .filter((c) => c.bandId === bandId && c.attending && !dlIsUpcoming(c))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const initials = band.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const activity = dlBandActivity(band, concerts, inactivityYears);

  const metaParts = [band.genre, [band.origin, band.formedYear ? `formed ${band.formedYear}` : null].filter(Boolean).join(', ')].filter(Boolean);
  if (activity.lastDate) {
    // activity.lastDate is always normalized to midnight, so comparing it
    // against `new Date()` (current time-of-day) mislabels a show happening
    // later today as "last show" instead of "next show" for most of the
    // day. Compare against today's midnight instead for a date-only check.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    metaParts.push(`${activity.status === 'active' && activity.lastDate >= todayMidnight ? 'next show' : 'last show'} ${activity.lastYear}`);
  }

  const socialButtons = [];
  if (band.socials?.instagram) socialButtons.push(linkIconBtn(band.socials.instagram, 'instagram'));
  if (band.socials?.spotify) socialButtons.push(linkIconBtn(band.socials.spotify, 'spotify'));

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">${band.photoUrl ? `<img src="${escapeAttr(band.photoUrl)}" alt="" />` : initials}</div>
      <div style="min-width:0;flex:1;">
        <div class="profile-name-row">
          <p class="profile-name">${escapeHtml(band.name)}</p>
          ${activityBadgeHtml(activity)}
        </div>
        ${metaParts.length ? `<p class="profile-meta">${escapeHtml(metaParts.join(' · '))}</p>` : ''}
      </div>
      <button class="icon-btn profile-favorite-btn${band.favorite ? ' is-favorite' : ''}" data-band-id="${escapeAttr(band.id)}" aria-label="${band.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon(band.favorite ? 'heartFill' : 'heart')}</button>
      <button class="icon-btn profile-mute-btn${band.muted ? ' is-muted' : ''}" data-band-id="${escapeAttr(band.id)}" aria-label="${band.muted ? 'Unmute band' : 'Mute band'}" title="${band.muted ? 'Unmute — show this band’s upcoming shows on the Concerts tab and Alerts again' : 'Mute — hide this band’s upcoming shows from the Concerts tab and Alerts'}">${icon(band.muted ? 'bellOff' : 'bell')}</button>
      <button class="icon-btn profile-edit-btn" data-band-id="${escapeAttr(band.id)}" aria-label="Edit band">${icon('edit')}</button>
    </div>
    ${band._enriching ? `<p class="muted" style="font-size:12px;margin:-4px 0 10px">Fetching band info…</p>` : ''}
    <div class="profile-links">
      ${band.officialUrl ? `<a class="btn-primary" href="${escapeAttr(band.officialUrl)}" target="_blank" rel="noopener">${icon('link')}Official site</a>` : ''}
      ${socialButtons.join('')}
    </div>
    ${band.bio ? `<p class="profile-bio">${escapeHtml(band.bio)}</p>` : ''}
    <div class="profile-divider">
      <div class="section-label-row">
        <p class="section-label" style="margin:0">Upcoming concerts</p>
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
          : renderWithYearDividers(filteredShows, profileUpcomingRowHtml, { showCount: true })}
    </div>
    ${pastAttended.length > 0 ? `
    <div class="profile-divider">
      <p class="section-label">Past concerts</p>
      ${renderWithYearDividers(pastAttended, (c) => myConcertRowHtml(c, true, { showBandName: false }), { showCount: true })}
    </div>` : ''}
    <div class="profile-danger-zone">
      <button class="profile-remove-btn" data-band-id="${escapeAttr(band.id)}">Remove this band</button>
    </div>
  `;

  wireMyConcertsHandlers(container, () => renderProfileScreen(bandId));
  container.querySelectorAll('a').forEach((a) => a.addEventListener('click', (ev) => ev.stopPropagation()));
  container.querySelector('.profile-edit-btn')?.addEventListener('click', () => {
    editingBandId = bandId;
    renderProfileScreen(bandId);
  });
  container.querySelector('.profile-favorite-btn')?.addEventListener('click', async () => {
    band.favorite = !band.favorite;
    await dlWriteJsonFile(remote, 'bands.json', bands);
    renderProfileScreen(bandId);
  });
  container.querySelector('.profile-mute-btn')?.addEventListener('click', async () => {
    band.muted = !band.muted;
    await dlWriteJsonFile(remote, 'bands.json', bands);
    renderProfileScreen(bandId);
  });
  container.querySelector('.profile-remove-btn')?.addEventListener('click', async () => {
    if (confirm('Remove this band from your list?')) {
      bands = bands.filter((x) => x.id !== bandId);
      await dlWriteJsonFile(remote, 'bands.json', bands);
      goToTab('mybands');
    }
  });
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

// Band profile page, "Upcoming concerts" section. Same address-link/km/
// playlist-link treatment as My Concerts' cards (myConcertRowHtml) — no
// band name (redundant on the band's own page) and no chevron/click-through
// (you're already here) — plus this page's own discovery actions
// (Article/Tickets/"I'm going"/Add to calendar), which only make sense for
// shows you haven't necessarily marked as attending yet.
function profileUpcomingRowHtml(c) {
  const going = !!c.attending;
  return `
    <div class="row-card">
      ${c.type === 'festival' ? `<div class="row-top"><div class="row-title-group"><span class="pill pill-festival">Festival</span></div></div>` : ''}
      <p class="row-sub">${formatDate(c.date, c.time)} · ${escapeHtml(c.venue)}, ${escapeHtml(c.city)}${c.country ? ', ' + escapeHtml(c.country) : ''}</p>
      ${venueAddressLinkHtml(c)}
      ${c.distanceKm !== null && c.distanceKm !== undefined ? `<p class="row-km">${formatKm(c.distanceKm)} away</p>` : ''}
      ${playlistLinkHtml(c)}
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

/* ---------------- Stats screen ---------------- */

function openStatsScreen({ fromHistory = false } = {}) {
  currentScreen = 'stats';
  setHeaderChrome({ showBack: true, title: 'Your stats' });
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  showScreen('screen-stats');
  renderStatsScreen();
  if (!fromHistory) history.pushState({ tab: currentTab, screen: 'stats' }, '');
}

// Small "extra detail" line under a stat tile's label, for tiles that pick a
// single specific show — venue + year, so seeing the same band more than
// once doesn't leave you guessing which show a tile is actually about.
function venueYearCaveat(c) {
  const year = (c.date || '').slice(0, 4);
  const parts = [c.venue, year].filter(Boolean);
  return parts.length ? `<br><span class="stats-kpi-caveat">${escapeHtml(parts.join(', '))}</span>` : '';
}

function renderStatsScreen() {
  const container = el('screen-stats');
  const liveConcerts = concerts.filter((c) => bands.some((b) => b.id === c.bandId));
  const { past, upcoming } = dlMyConcerts(liveConcerts);

  if (past.length === 0) {
    container.innerHTML = `<p class="screen-empty">No past concerts logged yet — your stats will show up here once you've attended a few concerts.</p>`;
    return;
  }

  const stats = dlConcertStats(past, bands, upcoming);
  const kmCaveat = stats.knownDistanceCount < stats.totalShows
    ? `<br><span class="stats-kpi-caveat">from ${stats.knownDistanceCount} of ${stats.totalShows} concerts</span>`
    : '';

  // Headline row — the same always-shown overview numbers as before, plus
  // unique venues/cities, all under their own "Overview" label at the very
  // top, matching the other labeled sections below instead of standing alone
  // unlabeled.
  const summaryTiles = [
    { value: stats.totalShows.toLocaleString(), label: 'concerts attended' },
    { value: stats.countries.toLocaleString(), label: 'countries' },
    { value: stats.kmTraveled.toLocaleString(), label: `km traveled${kmCaveat}` },
    { value: stats.totalUniqueArtists.toLocaleString(), label: 'different artists seen' },
    { value: stats.uniqueVenues.toLocaleString(), label: 'unique venues' },
    { value: stats.uniqueCities.toLocaleString(), label: 'unique cities' },
  ];

  // Everything else groups into labeled sections instead of one flat grid,
  // now that there are enough tiles for a flat list to feel like a wall.
  const milestoneTiles = [];
  if (stats.firstShow) {
    // Leads with "years of concert-going" (headline number) rather than the
    // literal first-show year — the specific show is demoted to the detail
    // line below, replacing the old plain "first show, [Band]" tile with a
    // single combined card instead of two separate ones.
    const yearsAgo = Math.floor((Date.now() - new Date(stats.firstShow.date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    const year = (stats.firstShow.date || '').slice(0, 4);
    const detailParts = [stats.firstShow.bandName, stats.firstShow.venue, year].filter(Boolean).join(', ');
    milestoneTiles.push({
      value: yearsAgo.toLocaleString(),
      label: `years of concert-going${detailParts ? `<br><span class="stats-kpi-caveat">first: ${escapeHtml(detailParts)}</span>` : ''}`,
    });
  }
  if (stats.festivalsAttended > 0) milestoneTiles.push({ value: stats.festivalsAttended.toLocaleString(), label: 'festivals attended' });
  if (stats.totalSongsHeardLive > 0) milestoneTiles.push({ value: stats.totalSongsHeardLive.toLocaleString(), label: 'songs heard live' });
  if (stats.daysSinceLastShow !== null) {
    const lastShowDetail = [stats.lastShow.bandName, stats.lastShow.venue].filter(Boolean).join(', ');
    milestoneTiles.push({
      value: formatGapLabel(stats.daysSinceLastShow),
      label: `since your last concert${lastShowDetail ? `<br><span class="stats-kpi-caveat">${escapeHtml(lastShowDetail)}</span>` : ''}`,
    });
  }

  const habitTiles = [];
  if (stats.busiestYear) habitTiles.push({ value: escapeHtml(stats.busiestYear.year), label: `busiest year, ${stats.busiestYear.count} trips` });
  if (stats.busiestMonth) habitTiles.push({ value: MONTH_NAMES[stats.busiestMonth.month - 1], label: `busiest month, ${stats.busiestMonth.count} trips` });
  if (stats.mostVisitedCity) habitTiles.push({ value: stats.mostVisitedCity.count.toLocaleString(), label: `most-visited city, ${escapeHtml(stats.mostVisitedCity.city)}` });

  // "Extremes" — every tile that's really about one specific record-holding
  // show. Kept as adjacent opposite-pairs (farthest/closest, cheapest/
  // priciest) so the 2-column grid visually pairs them.
  const extremeTiles = [];
  if (stats.farthestShow) extremeTiles.push({ value: formatKm(stats.farthestShow.distanceKm), label: `farthest concert, ${escapeHtml(stats.farthestShow.bandName)}${venueYearCaveat(stats.farthestShow)}` });
  if (stats.closestShow) extremeTiles.push({ value: formatKm(stats.closestShow.distanceKm), label: `closest concert, ${escapeHtml(stats.closestShow.bandName)}${venueYearCaveat(stats.closestShow)}` });
  if (stats.cheapestTicket) {
    // dataLib.js's cheapestTicket is scoped to PAID shows only (Free is
    // excluded there on purpose), so this is always a real kr amount, never 0.
    extremeTiles.push({ value: `${stats.cheapestTicket.ticketPrice.toLocaleString()} kr`, label: `cheapest ticket, ${escapeHtml(stats.cheapestTicket.bandName)}${venueYearCaveat(stats.cheapestTicket)}` });
  }
  if (stats.priciestTicket) extremeTiles.push({ value: `${stats.priciestTicket.ticketPrice.toLocaleString()} kr`, label: `priciest ticket, ${escapeHtml(stats.priciestTicket.bandName)}${venueYearCaveat(stats.priciestTicket)}` });
  if (stats.longestSetlist) extremeTiles.push({ value: stats.longestSetlist.setlist.songs.length.toLocaleString(), label: `longest setlist, ${escapeHtml(stats.longestSetlist.bandName)}${venueYearCaveat(stats.longestSetlist)}` });
  if (stats.longestGap) extremeTiles.push({ value: formatGapLabel(stats.longestGap.days), label: 'longest gap' });

  const moneyTiles = [];
  if (stats.knownSpendCount > 0) {
    const spendCaveat = stats.knownSpendCountPast < stats.totalShows
      ? `<br><span class="stats-kpi-caveat">from ${stats.knownSpendCountPast} of ${stats.totalShows} past concerts</span>`
      : '';
    moneyTiles.push({ value: `${stats.totalSpend.toLocaleString()} kr`, label: `spent on tickets, all time${spendCaveat}` });
    moneyTiles.push({ value: `${stats.averageTicketPrice.toLocaleString()} kr`, label: 'average ticket price' });
    moneyTiles.push({ value: `${stats.pctWithTicketPrice}%`, label: 'of concerts with a price logged' });
  }
  if (stats.highestSpendYear) {
    moneyTiles.push({
      value: `${stats.highestSpendYear.total.toLocaleString()} kr`,
      label: `highest-spend year, ${stats.highestSpendYear.year}<br><span class="stats-kpi-caveat">${stats.highestSpendYear.count} concert${stats.highestSpendYear.count === 1 ? '' : 's'}</span>`,
    });
  }
  if (stats.lowestSpendYear) {
    moneyTiles.push({
      value: `${stats.lowestSpendYear.total.toLocaleString()} kr`,
      label: `lowest-spend year, ${stats.lowestSpendYear.year}<br><span class="stats-kpi-caveat">${stats.lowestSpendYear.count} concert${stats.lowestSpendYear.count === 1 ? '' : 's'}</span>`,
    });
  }

  // "Ratings" — a new section pairing overall average rating with rating
  // coverage, both per-concert (see dlConcertStats comments).
  const ratingTiles = [];
  if (stats.overallAverageRating !== null) ratingTiles.push({ value: stats.overallAverageRating.toFixed(1), label: 'average rating' });
  ratingTiles.push({
    value: `${stats.pctWithRating}%`,
    label: `of concerts rated${stats.ratedCount < stats.totalShows ? `<br><span class="stats-kpi-caveat">${stats.ratedCount} of ${stats.totalShows} concerts</span>` : ''}`,
  });

  const tileHtml = (t) => `<div class="stats-kpi-tile"><span class="stats-kpi-value">${t.value}</span><span class="stats-kpi-label">${t.label}</span></div>`;
  const gridHtml = (arr) => `<div class="stats-kpi-grid">${arr.map(tileHtml).join('')}</div>`;
  const sectionHtml = (label, arr) => (arr.length > 0 ? `<p class="section-label">${escapeHtml(label)}</p>${gridHtml(arr)}` : '');

  const TOP_RATED_DISPLAY_CAP = 8;

  container.innerHTML = `
    ${sectionHtml('Overview', summaryTiles)}
    ${sectionHtml('Milestones', milestoneTiles)}
    ${sectionHtml('Habits', habitTiles)}
    ${sectionHtml('Extremes', extremeTiles)}
    ${sectionHtml('Money', moneyTiles)}
    ${sectionHtml('Ratings', ratingTiles)}
    ${stats.topRatedShows.length > 0 ? `
      <p class="section-label">Top-rated concerts</p>
      <div class="stats-list-card">
        ${stats.topRatedShows.slice(0, TOP_RATED_DISPLAY_CAP).map((c) => `<div class="stats-list-row"><span>${escapeHtml(c.bandName)} &middot; ${escapeHtml((c.date || '').slice(0, 4))}</span>${starsHtml(c.rating)}</div>`).join('')}
        ${stats.topRatedShows.length > TOP_RATED_DISPLAY_CAP ? `<div class="stats-list-row"><span class="muted">+${stats.topRatedShows.length - TOP_RATED_DISPLAY_CAP} more</span></div>` : ''}
      </div>` : ''}
    ${stats.topArtists.length > 0 ? `
      <p class="section-label">Seen more than once</p>
      <div class="stats-list-card">
        ${stats.topArtists.map((a) => `<div class="stats-list-row"><span>${escapeHtml(a.bandName)}</span><span class="stats-list-value">${a.count}</span></div>`).join('')}
      </div>` : ''}
    ${stats.topVenues.length > 0 ? `
      <p class="section-label">Most-visited venues</p>
      <div class="stats-list-card">
        ${stats.topVenues.map((v) => `<div class="stats-list-row"><span>${escapeHtml(v.venue)}${v.city ? ', ' + escapeHtml(v.city) : ''}</span><span class="stats-list-value">${v.count}</span></div>`).join('')}
      </div>` : ''}
    ${stats.genreBreakdown.length > 0 ? `
      <p class="section-label">Genres</p>
      <div class="stats-list-card">
        ${stats.genreBreakdown.map((g) => `<div class="stats-list-row"><span>${escapeHtml(g.genre)}</span><span class="stats-list-value">${g.pct}%</span></div>`).join('')}
      </div>` : ''}
  `;
}

// Longest-gap-between-shows label: years once it's a year or more (one
// decimal, e.g. "3.5 yrs"), months while it's under a year, days below a
// month — whichever unit reads most naturally at that size.
function formatGapLabel(days) {
  if (days >= 365) return `${(days / 365.25).toFixed(1)} yrs`;
  if (days >= 30) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days)} days`;
}

/* ---------------- Data export (Settings) ---------------- */

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function toCsvValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Column set is derived from whatever keys actually appear across the
// records rather than a hand-maintained list, so this never silently drops
// a field (ticketPrice, setlist, playlistUrl, etc.) as the data model
// evolves.
function arrayToCsv(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [keys.map(toCsvValue).join(',')];
  for (const r of rows) lines.push(keys.map((k) => toCsvValue(r[k])).join(','));
  return lines.join('\r\n');
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Owned ticket metadata can contain a private mobile-ticket URL. Exports keep
// the concert record useful without exposing those private access links (and
// PDF bytes never exist in concert JSON in the first place).
function exportConcertRows(rows) {
  return rows.map(({ ownedTickets, ...concert }) => concert);
}

function exportDataAsCsv() {
  downloadTextFile(`bands-${todayStamp()}.csv`, arrayToCsv(bands), 'text/csv');
  downloadTextFile(`concerts-${todayStamp()}.csv`, arrayToCsv(exportConcertRows(concerts)), 'text/csv');
}

// The Excel export loads SheetJS from a CDN on demand (only when this
// button is actually clicked) rather than bundling it, so the app's normal
// offline-first load path is completely unaffected — this is the one
// deliberate exception to the "no external CDN" rule in icons.js's header
// comment, scoped to an optional, occasional export action rather than core
// UI. A real .xlsx (not an HTML-table trick) so it opens cleanly with two
// proper sheet tabs and no "format doesn't match extension" warning.
let xlsxLibPromise = null;
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLibPromise) return xlsxLibPromise;
  xlsxLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Excel export library'));
    document.head.appendChild(s);
  });
  return xlsxLibPromise;
}

async function exportDataAsExcel() {
  await loadXlsxLib();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bands), 'Bands');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportConcertRows(concerts)), 'Concerts');
  XLSX.writeFile(wb, `concert-tracker-export-${todayStamp()}.xlsx`);
}

/* ---------------- Settings screen ---------------- */

function showSettingsScreen({ fromHistory = false } = {}) {
  currentScreen = 'settings';
  settingsTab = 'research';
  settingsExpandedTool = null;
  setHeaderChrome({ showBack: true, title: 'Settings' });
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  showScreen('screen-settings');
  renderSettingsScreen();
  if (!fromHistory) history.pushState({ tab: currentTab, screen: 'settings' }, '');
}

async function renderSettingsScreen() {
  let { groqApiKey = '', groqApiKeyAddedAt = null } = await chrome.storage.local.get(['groqApiKey', 'groqApiKeyAddedAt']);
  const spotifySettings = await chrome.storage.local.get(['spotifyUserClientId', SpotifyUser.TOKEN_KEY]);
  const spotifyClientId = spotifySettings.spotifyUserClientId || '';
  const spotifyAuthorization = spotifySettings[SpotifyUser.TOKEN_KEY] || null;
  if (groqApiKey && !groqApiKeyAddedAt) {
    groqApiKeyAddedAt = new Date().toISOString();
    await chrome.storage.local.set({ groqApiKeyAddedAt });
  }
  const container = el('screen-settings');
  const savedKeyInfo = groqApiKey
    ? `<p class="muted" style="font-size:11.5px;margin:0 0 8px">
         <strong>${escapeHtml(maskApiKey(groqApiKey))}</strong>
         ${groqApiKeyAddedAt ? ` · added ${escapeHtml(formatSettingsDate(groqApiKeyAddedAt))}` : ''}
       </p>`
    : '';
  const settingsTabsHtml = `
    <div class="news-subtab-switch settings-subtab-switch" role="tablist" aria-label="Settings sections">
      ${['research', 'review', 'data'].map((tab) => `<button type="button" class="news-subtab-btn settings-subtab-btn${settingsTab === tab ? ' active' : ''}" data-settings-tab="${tab}" role="tab" aria-selected="${settingsTab === tab}"${settingsTab === tab ? '' : ' tabindex="-1"'}>${escapeHtml(tab[0].toUpperCase() + tab.slice(1))}</button>`).join('')}
    </div>`;
  const dataTabHtml = `
    <p class="section-label">Connection</p>
    <div class="settings-card">
      <p class="muted" style="font-size:11.5px;margin:0 0 8px">${escapeHtml(remote?.endpoint || 'Not connected')}${remote?.token ? ` · ${escapeHtml(maskApiKey(remote.token))}` : ''}</p>
      <button id="change-connection-btn" class="btn-secondary">Change connection</button>
    </div>

    <p class="section-label">Spotify playlist creation</p>
    <div class="settings-card">
      ${!spotifyClientId ? `<label for="spotify-client-id-input">Spotify public Client ID</label><input id="spotify-client-id-input" value="" placeholder="Public Client ID from Spotify Dashboard"/><p class="settings-hint">This ID is public. Do not enter a Client Secret.</p><button id="save-spotify-client-id" class="btn-primary">Save Client ID</button>` : !spotifyAuthorization ? `<p class="settings-hint">Spotify Client ID configured. Connect to create private playlists from predicted setlists.</p><button id="connect-spotify" class="btn-primary">Connect Spotify</button><button id="remove-spotify-client-id" class="btn-secondary">Remove Client ID</button>` : `<p class="settings-hint">Connected to Spotify</p><button id="disconnect-spotify" class="btn-secondary">Disconnect</button>`}
      <p id="spotify-settings-status" class="settings-hint" aria-live="polite">${escapeHtml(spotifyAuthMessage)}</p>
    </div>

    <p class="section-label">Band status</p>
    <div class="settings-card">
      <label>Inactive after</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="inactivity-years-input" class="narrow-input" min="1" max="10" step="1" value="${inactivityYears}" />
        <span class="muted" style="font-size:12px">years with no known or upcoming shows</span>
      </div>
      <p class="settings-hint">Bands past this get an "Inactive" flag in My Bands and on their profile. Updates automatically as new tour dates come in.</p>
    </div>

    <p class="section-label">Data export</p>
    <div class="settings-card">
      <p class="settings-hint" style="margin-top:0">Export your bands, concerts, ratings, notes, ticket costs and setlists.</p>
      <div class="show-buttons" style="margin-top:8px">
        <button id="export-csv-btn" class="btn-secondary">Export CSV</button>
        <button id="export-excel-btn" class="btn-secondary">Export Excel</button>
      </div>
      <span id="export-status" class="settings-hint"></span>
    </div>
    <p class="settings-version">LiveVault ${escapeHtml(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?')}</p>
  `;
  const researchTabHtml = researchPipelineSectionHtml({
    expandedTool: settingsExpandedTool,
    groqSettingsHtml: groqSettingsHtml({ groqApiKey, savedKeyInfo }),
  });
  container.innerHTML = `${settingsTabsHtml}${settingsTab === 'research' ? researchTabHtml : settingsTab === 'review' ? artistIdentityReviewHtml() : dataTabHtml}`;

  container.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => {
    settingsTab = button.dataset.settingsTab;
    settingsExpandedTool = null;
    renderSettingsScreen();
  }));
  container.querySelectorAll('[data-research-tool]').forEach((button) => button.addEventListener('click', () => {
    const tool = button.dataset.researchTool;
    settingsExpandedTool = settingsExpandedTool === tool ? null : tool;
    renderSettingsScreen();
  }));

  el('change-connection-btn')?.addEventListener('click', () => {
    showOnboarding();
  });
  el('save-spotify-client-id')?.addEventListener('click', async () => { const value = el('spotify-client-id-input').value.trim(); if (!value) { el('spotify-settings-status').textContent = 'Enter the public Client ID.'; return; } await chrome.storage.local.set({ spotifyUserClientId: value }); spotifyAuthMessage = ''; renderSettingsScreen(); });
  el('remove-spotify-client-id')?.addEventListener('click', async () => { await chrome.storage.local.remove('spotifyUserClientId'); spotifyAuthMessage = ''; renderSettingsScreen(); });
  el('connect-spotify')?.addEventListener('click', () => SpotifyUser.beginAuthorization(spotifyClientId));
  el('disconnect-spotify')?.addEventListener('click', async () => { await SpotifyUser.clearAuth(); spotifyAuthMessage = 'Spotify disconnected.'; renderSettingsScreen(); });

  el('save-groq-key')?.addEventListener('click', async () => {
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

  const groqKeyToggleBtn = el('groq-key-toggle-visibility');
  if (groqKeyToggleBtn) groqKeyToggleBtn.innerHTML = icon('eye');
  let groqKeyVisible = false;
  groqKeyToggleBtn?.addEventListener('click', () => {
    groqKeyVisible = !groqKeyVisible;
    el('groq-key-input').type = groqKeyVisible ? 'text' : 'password';
    groqKeyToggleBtn.innerHTML = icon(groqKeyVisible ? 'eyeOff' : 'eye');
    groqKeyToggleBtn.setAttribute('aria-label', groqKeyVisible ? 'Hide key' : 'Show key');
    groqKeyToggleBtn.setAttribute('title', groqKeyVisible ? 'Hide key' : 'Show key');
  });

  el('export-csv-btn')?.addEventListener('click', () => {
    exportDataAsCsv();
    el('export-status').textContent = 'CSV files downloading…';
    setTimeout(() => (el('export-status').textContent = ''), 2000);
  });

  el('export-excel-btn')?.addEventListener('click', async () => {
    const btn = el('export-excel-btn');
    const original = btn.textContent;
    btn.textContent = 'Preparing…';
    try {
      await exportDataAsExcel();
    } catch (e) {
      el('export-status').textContent = "Couldn't load the Excel export — check your connection, or use Export CSV instead.";
      setTimeout(() => (el('export-status').textContent = ''), 4000);
    } finally {
      btn.textContent = original;
    }
  });

  el('inactivity-years-input')?.addEventListener('change', async (ev) => {
    const val = Math.max(1, Math.min(10, parseInt(ev.target.value, 10) || 3));
    inactivityYears = val;
    ev.target.value = val;
    await chrome.storage.local.set({ inactivityYears: val });
  });

  el('recheck-btn')?.addEventListener('click', async () => {
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
  wireArtistIdentityReview();
}

function artistIdentityReviewHtml() {
  const summary = MusicbrainzState.artistIdentitySummary(bands);
  const identified = summary.autoConfirmed + summary.manualConfirmed;
  const lastMusicbrainzRun = apiUsage?.lastMusicbrainzRun;
  const lastRunHtml = lastMusicbrainzRun ? `<div class="settings-card"><p class="settings-hint" style="margin:0"><strong>Last manual MusicBrainz run:</strong> ${escapeHtml(formatSettingsDate(lastMusicbrainzRun.finishedAt))} · ${escapeHtml(lastMusicbrainzRun.status || 'unknown')} · ${escapeHtml(String(lastMusicbrainzRun.musicbrainzCalls ?? 0))} requests · ${escapeHtml(String(lastMusicbrainzRun.identityUpdates ?? 0))} records updated${lastMusicbrainzRun.error ? ` · ${escapeHtml(lastMusicbrainzRun.error)}` : ''}</p></div>` : '';
  const reviewable = bands.filter((b) => ['needs_review', 'no_match', 'error', 'manual_rejected'].includes(b.musicbrainz?.status));
  const cards = reviewable.filter((b) => b.musicbrainz?.status === 'needs_review').map((band) => {
    const candidates = (band.musicbrainz.reviewCandidates || []).map((c) => `<div class="identity-candidate"><strong>${escapeHtml(c.artistName)}</strong><p>${escapeHtml([c.area, c.country, c.artistType, c.disambiguation].filter(Boolean).join(' · ') || 'No extra metadata')}</p><p>${escapeHtml((c.matchReasons || []).join(' · '))} · ${escapeHtml(String(c.score))}/100 · Data from MusicBrainz</p><a class="btn-secondary" href="https://musicbrainz.org/artist/${escapeAttr(encodeURIComponent(String(c.mbid || '')))}" target="_blank" rel="noopener">View on MusicBrainz</a><button class="btn-secondary identity-use" data-band-id="${escapeAttr(band.id)}" data-mbid="${escapeAttr(c.mbid)}" aria-label="Use ${escapeAttr(c.artistName)} for ${escapeAttr(band.name)}">Use this artist</button></div>`).join('');
    return `<div class="settings-card identity-review-card"><p><strong>${escapeHtml(band.name)}</strong>${band.origin ? ` · ${escapeHtml(band.origin)}` : ''}</p>${candidates}<button class="btn-secondary identity-none" data-band-id="${escapeAttr(band.id)}" aria-label="Reject all displayed MusicBrainz candidates for ${escapeAttr(band.name)}">None of these</button></div>`;
  }).join('');
  const retryReasons = { no_match: 'No match', error: 'Lookup error', manual_rejected: 'Previously rejected' };
  const retries = reviewable.filter((b) => b.musicbrainz?.status !== 'needs_review').map((b) => `<button class="btn-secondary identity-retry" data-band-id="${escapeAttr(b.id)}" aria-label="Try MusicBrainz matching again for ${escapeAttr(b.name)}">Try again: ${escapeHtml(b.name)} · ${escapeHtml(retryReasons[b.musicbrainz.status])}</button>`).join('');
  return `<p class="section-label">MusicBrainz artist review</p><p class="settings-hint settings-section-intro">Review uncertain artist matches before they are used for future research.</p><div class="identity-review"><div class="settings-card"><p class="settings-hint" style="margin:0"><strong>${summary.total} followed artists</strong> · ${identified} identified (${summary.autoConfirmed} automatic, ${summary.manualConfirmed} manual) · ${summary.awaitingReview} awaiting review · ${summary.notCheckedYet} not checked yet · ${summary.noMatch} no match · ${summary.errors} errors · ${summary.manuallyRejected} manually rejected</p></div>${lastRunHtml}${cards || '<div class="settings-card"><p class="settings-hint" style="margin:0">No artist matches need review.</p></div>'}${retries ? `<p class="section-label identity-retry-label">Matches to revisit</p><div class="show-buttons">${retries}</div>` : ''}<p class="settings-hint">Weekly automatic MusicBrainz lookups are off. The manual workflow checks at most five artists per run.</p><a class="btn-secondary" href="https://github.com/mstpln/concert-tracker-mobile/actions/workflows/musicbrainz.yml" target="_blank" rel="noopener">Open MusicBrainz runs</a></div>`;
}

async function saveArtistIdentity(bandId, updater) {
  const latest = await dlReadJsonFile(remote, 'bands.json', []);
  const band = latest.find((b) => b.id === bandId);
  if (!band) throw new Error('Band no longer exists');
  const next = updater(band);
  if (!next) throw new Error('Artist candidate is no longer available');
  const merged = latest.map((b) => b.id === bandId ? { ...b, musicbrainz: next } : b);
  await dlWriteJsonFile(remote, 'bands.json', merged);
  bands = merged;
}

function wireArtistIdentityReview() {
  const submit = async (button, action) => {
    const controls = [...el('screen-settings').querySelectorAll('.identity-use, .identity-none, .identity-retry')].filter((control) => control.dataset.bandId === button.dataset.bandId);
    const labels = controls.map((control) => control.textContent);
    controls.forEach((control) => { control.disabled = true; control.textContent = 'Saving…'; });
    try { await action(); renderSettingsScreen(); }
    catch {
      controls.forEach((control, index) => { control.disabled = false; control.textContent = labels[index]; });
      alert('Could not save this review. Refresh and try again.');
    }
  };
  el('screen-settings').querySelectorAll('.identity-use').forEach((button) => button.addEventListener('click', () => submit(button, () => saveArtistIdentity(button.dataset.bandId, (band) => { const mb = band.musicbrainz || {}; const c = (mb.reviewCandidates || []).find((x) => x.mbid === button.dataset.mbid); return c ? MusicbrainzState.confirmedIdentity(c, mb) : null; }))));
  el('screen-settings').querySelectorAll('.identity-none').forEach((button) => button.addEventListener('click', () => submit(button, () => saveArtistIdentity(button.dataset.bandId, (band) => MusicbrainzState.rejectCandidates(band.musicbrainz || {})))));
  el('screen-settings').querySelectorAll('.identity-retry').forEach((button) => button.addEventListener('click', () => submit(button, () => saveArtistIdentity(button.dataset.bandId, (band) => MusicbrainzState.retryIdentity(band.musicbrainz || {})))));
}

// Where the GitHub Actions workflow lives — used only for an external
// "View pipeline runs" link. There's deliberately no way to trigger a run
// from inside the app: doing that would require a GitHub token with
// write access embedded in this public, client-side static site, which
// would be readable by anyone. Opening the Actions tab (gated by your own
// GitHub login) is the safe equivalent of a "run now" button.
const RESEARCH_PIPELINE_ACTIONS_URL = 'https://github.com/mstpln/concert-tracker-mobile/actions/workflows/research.yml';

// Tiered usage bar — the track's full width is the service's real free-tier
// ceiling (realLimit), not our own lower cap, so the bar always answers "how
// close to the REAL limit are we" rather than just "how close to our own
// arbitrary number". The cap-region fill (0 to ourCap) plus a tick at that
// boundary shows where our own safety cap sits inside that real ceiling; the
// accent fill (0 to used) is actual usage, on the same real-limit scale. For
// a service with no published real limit (Spotify), realLimit === ourCap is
// passed in and the tick is simply omitted — there's nothing to mark.
function tieredUsageBarHtml(used, ourCap, realLimit) {
  const real = Number(realLimit) || Number(ourCap) || 1;
  const cap = Number(ourCap) || real;
  const u = Number(used) || 0;
  const capPct = Math.round(Math.min(100, Math.max(0, (cap / real) * 100)) * 100) / 100;
  const usedPct = Math.round(Math.min(100, Math.max(0, (u / real) * 100)) * 100) / 100;
  return `
    <div class="usage-bar-track-tiered">
      <div class="usage-bar-cap-region" style="width:${capPct}%"></div>
      <div class="usage-bar-fill-tiered" style="width:${usedPct}%"></div>
      ${cap < real ? `<div class="usage-bar-cap-tick" style="left:${capPct}%"></div>` : ''}
    </div>`;
}

// The compact summary deliberately uses our internal safety cap rather than
// the provider's real ceiling. The tiered bar above continues to use the real
// ceiling, so the two elements answer two different, complementary questions.
function usageSummaryHtml(used, ourCap) {
  const cap = Number(ourCap) || 1;
  const actualUsed = Math.max(0, Number(used) || 0);
  const percentage = Math.round((actualUsed / cap) * 100);
  return `<div class="usage-summary" aria-label="${actualUsed.toLocaleString()} of ${cap.toLocaleString()} used, ${percentage}% of our cap">
    <span>${actualUsed.toLocaleString()} / ${cap.toLocaleString()} used&nbsp; •&nbsp; </span><span class="usage-summary-percent">${percentage}%</span>
  </div>`;
}

function usageDetailRowHtml(iconName, html) {
  return `<div class="usage-detail-row">${icon(iconName)}<span>${html}</span></div>`;
}

// One card per research-pipeline service: name + tiered bar, then up to 4
// grouped detail rows (key, added date, real limit, our own safety
// structure). addedAt is only rendered when it's a real, honestly-known
// date (see RESEARCH_KEY_METADATA's no-fabrication policy above) — most
// services simply omit that row rather than show a guessed date.
function usageServiceCardHtml({ name, providerIcon, keyMasked, addedAt, used, ourCap, realLimit, limitText, capText }) {
  return `
    <div class="usage-service-card">
      <div class="usage-service-header">
        <span class="usage-provider-logo" aria-hidden="true">${icon(providerIcon)}</span>
        <p class="usage-service-name">${escapeHtml(name)}</p>
      </div>
      ${tieredUsageBarHtml(used, ourCap, realLimit)}
      ${usageSummaryHtml(used, ourCap)}
      ${keyMasked ? usageDetailRowHtml('key', escapeHtml(keyMasked)) : ''}
      ${addedAt ? usageDetailRowHtml('calendarPlain', `Added ${escapeHtml(formatSettingsDate(addedAt))}`) : ''}
      ${usageDetailRowHtml('gauge', `Real limit: ${escapeHtml(limitText)}`)}
      ${usageDetailRowHtml('shieldCheck', `Our cap: ${escapeHtml(capText)}`)}
    </div>`;
}

function groqSettingsHtml({ groqApiKey, savedKeyInfo }) {
  return `
    <div class="settings-card settings-groq-local-key">
      <label>Groq API key (optional)</label>
      ${savedKeyInfo}
      <div class="password-field-wrap">
        <input type="password" id="groq-key-input" value="" placeholder="${groqApiKey ? 'Enter a new key to replace it' : 'For faster, more reliable band-info lookups'}" />
        <button type="button" id="groq-key-toggle-visibility" class="icon-btn password-toggle-btn" aria-label="Show key" title="Show key"></button>
      </div>
      <p class="settings-hint">Used to fill in genre, bio and links when you add a band. Leave blank to use a free fallback (slower, less reliable).</p>
      <div class="show-buttons" style="margin-top:8px">
        <button id="save-groq-key" class="btn-primary">Save</button>
        ${groqApiKey ? `<button id="remove-groq-key" class="btn-secondary btn-danger">Remove key</button>` : ''}
      </div>
      <span id="groq-save-status" class="settings-hint"></span>
    </div>`;
}

function researchToolOverviewHtml(provider) {
  const isExpanded = settingsExpandedTool === provider.id;
  const percentage = Math.round(((Number(provider.used) || 0) / (Number(provider.ourCap) || 1)) * 100);
  return `
    <div class="research-tool-overview-row${isExpanded ? ' is-expanded' : ''}">
      <button type="button" class="research-tool-overview-button" data-research-tool="${escapeAttr(provider.id)}" aria-expanded="${isExpanded}" aria-controls="research-tool-${escapeAttr(provider.id)}">
        <span class="research-tool-overview-title">${escapeHtml(provider.name)}</span>
        <span class="research-tool-overview-percent">${escapeHtml(String(percentage))}% <span class="details-chevron">${icon('chevronDown')}</span></span>
        <span class="research-tool-overview-usage">${escapeHtml((Number(provider.used) || 0).toLocaleString())} / ${escapeHtml((Number(provider.ourCap) || 0).toLocaleString())} used</span>
        <span class="research-tool-overview-bar"><span style="width:${Math.max(0, Math.min(100, percentage))}%"></span></span>
      </button>
      <div id="research-tool-${escapeAttr(provider.id)}" class="research-tool-details${isExpanded ? ' is-open' : ''}">${isExpanded ? usageServiceCardHtml(provider) + (provider.id === 'groq' ? provider.groqSettingsHtml : '') : ''}</div>
    </div>`;
}

// Renders the Settings > Research view. Usage is read from apiUsage.json
// (written by scripts/research.js, never by this app); provider secrets remain
// masked static metadata because GitHub Actions secrets cannot be read back.
function researchPipelineSectionHtml({ expandedTool = null, groqSettingsHtml = '' } = {}) {
  const actionButtons = `
    <div class="show-buttons" style="margin-top:10px">
      <button id="recheck-btn" class="btn-secondary">Refresh now</button>
      <a id="view-pipeline-runs-btn" class="btn-secondary" href="${escapeAttr(RESEARCH_PIPELINE_ACTIONS_URL)}" target="_blank" rel="noopener">View pipeline runs</a>
    </div>
    <p class="settings-hint">Refresh re-fetches your data now. Research runs automatically once a week — view pipeline runs opens GitHub to check on or manually trigger one.</p>`;

  if (!apiUsage) {
    return `
      <p class="section-label">Research tools</p>
      <div class="settings-card">
        <p class="settings-hint" style="margin-top:0">Each provider has its own limit and run behavior.</p>
        <p class="settings-hint">No usage data yet — this fills in after the weekly GitHub Actions run has run at least once.</p>
      </div>
      <p class="section-label">Research pipeline</p>
      <div class="settings-card">
        <div class="settings-card-divider">${actionButtons}</div>
      </div>`;
  }

  const tm = apiUsage.ticketmaster || {};
  const tv = apiUsage.tavily || {};
  const gq = apiUsage.groq || {};
  const sl = apiUsage.setlistfm || {};
  const lastRun = apiUsage.lastRun || null;

  // Real free-tier ceiling and our own (lower) safety cap for each service —
  // both already synced into apiUsage.json on every pipeline run (see
  // usageTracker.js's "resync every cap/limit field from config" comment),
  // so these read the actual enforced numbers rather than duplicating
  // hard-coded constants here. Ticketmaster's own cap is the one exception:
  // it's enforced as "50% of the real daily limit" inline in code rather
  // than stored as a named field, so it's recomputed the same way here.
  const tmReal = tm.freeTierDailyLimit ?? 5000;
  const tmCap = Math.round(tmReal * 0.5);
  const tvReal = tv.freeTierMonthlyLimit ?? 1000;
  const tvCap = tv.monthlyCap ?? 900;
  const gqReal = gq.freeTierTpdLimit ?? 200000;
  const gqCap = gq.safeTpd ?? 150000;
  const slReal = sl.freeTierDailyLimit ?? 1440;
  const slCap = sl.dailyCap ?? 1200;
  const providers = [
    {
      id: 'ticketmaster',
      name: 'Ticketmaster',
      providerIcon: 'providerTicketmaster',
      keyMasked: RESEARCH_KEY_METADATA.ticketmaster.masked,
      addedAt: RESEARCH_KEY_METADATA.ticketmaster.addedAt,
      used: tm.callsToday, ourCap: tmCap, realLimit: tmReal,
      limitText: `${tmReal.toLocaleString()}/day`,
      capText: `${tmCap.toLocaleString()}/day · ${(tm.perRunCap ?? 300).toLocaleString()}/run`,
    },
    {
      id: 'tavily',
      name: 'Tavily',
      providerIcon: 'providerTavily',
      keyMasked: RESEARCH_KEY_METADATA.tavily.masked,
      addedAt: RESEARCH_KEY_METADATA.tavily.addedAt,
      used: tv.callsThisMonth, ourCap: tvCap, realLimit: tvReal,
      limitText: `${tvReal.toLocaleString()}/month`,
      capText: `${tvCap.toLocaleString()}/month · ${(tv.perRunCap ?? 180).toLocaleString()}/run`,
    },
    {
      id: 'groq',
      name: 'Groq (research pipeline)',
      providerIcon: 'providerGroq',
      keyMasked: RESEARCH_KEY_METADATA.groq.masked,
      addedAt: RESEARCH_KEY_METADATA.groq.addedAt,
      // Bar tracks tokens, not requests — TPD is the real binding constraint
      // for this pipeline (see config.js), requests are mentioned in text only.
      used: gq.tokensToday ?? 0, ourCap: gqCap, realLimit: gqReal,
      limitText: `${gqReal.toLocaleString()} tokens/day (${(gq.freeTierDailyRequestLimit ?? 1000).toLocaleString()} req/day)`,
      capText: `${gqCap.toLocaleString()} tokens/day (${(gq.dailyCap ?? 800).toLocaleString()} req · ${(gq.perRunCap ?? 250).toLocaleString()}/run)`,
      groqSettingsHtml,
    },
    {
      id: 'setlistfm',
      name: 'setlist.fm',
      providerIcon: 'providerSetlistfm',
      keyMasked: RESEARCH_KEY_METADATA.setlistfm.masked,
      addedAt: RESEARCH_KEY_METADATA.setlistfm.addedAt,
      used: sl.callsToday, ourCap: slCap, realLimit: slReal,
      limitText: `${slReal.toLocaleString()}/day`,
      capText: `${slCap.toLocaleString()}/day · ${(sl.perRunCap ?? 200).toLocaleString()}/run`,
    },
  ];
  settingsExpandedTool = expandedTool;

  const lastRunHtml = lastRun
    ? `<p class="settings-hint" style="margin-top:0">
         Last run ${escapeHtml(formatSettingsDate(lastRun.finishedAt))} · ${escapeHtml(lastRun.status || 'unknown')}
         · ${lastRun.bandsProcessed ?? 0} bands checked, ${lastRun.concertsAdded ?? 0} new concerts, ${lastRun.newsAdded ?? 0} new news items, ${lastRun.setlistsAdded ?? 0} new setlists, ${lastRun.spotifyLinksAdded ?? 0} new song links.
       </p>`
    : '';

  return `
    <p class="section-label">Research tools</p>
    <p class="settings-hint settings-section-intro">Each provider has its own limit and run behavior.</p>
    <div class="settings-card research-tools-overview">
      ${providers.map(researchToolOverviewHtml).join('')}
    </div>
    <p class="section-label">Research pipeline</p>
    <div class="settings-card">
      ${lastRunHtml}
      <div class="${lastRun ? 'settings-card-divider' : ''}">${actionButtons}</div>
    </div>
    <p class="settings-hint" style="font-style:italic;margin:8px 2px 4px">Updated automatically after each pipeline run.</p>`;
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
        // llama-3.1-8b-instant was deprecated by Groq on 2026-06-17 (same
        // wave as llama-3.3-70b-versatile, which the research pipeline in
        // scripts/lib/config.js hit and migrated away from — this
        // client-side call site uses a separate, personal Groq key and was
        // missed until this QA pass). openai/gpt-oss-20b is Groq's
        // recommended lightweight replacement.
        model: 'openai/gpt-oss-20b',
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
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    const s = d.toLocaleDateString('en-GB', opts);
    // Ticketmaster's localTime comes through as HH:mm:ss — trim any
    // seconds component so rows show "18:30" instead of "18:30:00".
    const shortTime = timeStr ? timeStr.slice(0, 5) : null;
    return shortTime ? `${s}, ${shortTime}` : s;
  } catch {
    return '';
  }
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
