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
  let groups = dlVenueGroups(liveConcerts);

  if (venuesEuropeOnly) groups = groups.filter((g) => g.concerts.some((c) => dlIsEuropeCountry(c.country)));
  else if (venuesNearbyOnly) groups = groups.filter((g) => g.concerts.some(dlIsNearby));
  // "Past Concerts" is scoped to shows the user personally attended, per the
  // user's explicit clarification — not just any already-happened date.
  if (venuesPastOnly) groups = groups.filter((g) => g.concerts.some((c) => c.attending && !dlIsUpcoming(c)));

  const filterRow = `
    <div class="section-label-filters" style="margin-bottom:14px">
      <button id="venues-nearby-toggle-btn" class="icon-btn${venuesNearbyOnly ? ' active' : ''}" aria-label="Show nearby only" title="Show nearby only">${icon('nearbyPin')}</button>
      <button id="venues-europe-toggle-btn" class="icon-btn${venuesEuropeOnly ? ' active' : ''}" aria-label="Show Europe only" title="Show Europe only">EU</button>
      <button id="venues-past-toggle-btn" class="icon-btn${venuesPastOnly ? ' active' : ''}" aria-label="Show only venues I've been to" title="Show only venues I've been to">Past Concerts</button>
    </div>`;

  if (groups.length === 0) {
    return filterRow + `<p class="screen-empty">No venues match these filters yet.</p>`;
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

  return filterRow + rows;
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
      ${ticketCostBlockHtml(c)}
      <div class="row-divider"></div>
      ${mcLinksRowHtml(c, isPast)}
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
    ? { field: 'playlistUrl', iconName: 'music', label: 'Playlist', formFn: playlistFormHtml }
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
  const songCount = c.setlist.songs.length;
  return `<button type="button" class="link-trigger setlist-trigger" data-toggle-panel="setlist" data-concert-id="${escapeAttr(c.id)}">${icon('setlistOrdered')}<span class="link-trigger-label">Setlist (${songCount} song${songCount === 1 ? '' : 's'})</span><span class="details-chevron">${icon('chevronDown')}</span></button>`;
}

function mcSetlistPanelContentHtml(c) {
  const songsHtml = c.setlist.songs
    .map((s) => {
      const encoreLabel = s.isEncore ? `<span class="setlist-encore-divider">Encore</span>` : '';
      const coverTag = s.isCover ? `<span class="setlist-cover-tag">cover</span>` : '';
      return `${encoreLabel}<li class="setlist-song${s.isCover ? ' setlist-cover' : ''}">${escapeHtml(s.name)}${coverTag}</li>`;
    })
    .join('');
  return `
    <ol class="setlist-song-list">${songsHtml}</ol>
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
        ${hasSetlist ? mcSetlistTriggerCellHtml(c) : ''}
      </div>
      <div class="row-edit-row">
        ${mcLinkEditCellHtml('playlist', c)}
        ${isPast ? mcLinkEditCellHtml('photo', c) : ''}
        ${hasSetlist ? '<span class="row-edit-spacer"></span>' : ''}
      </div>
      <div class="expand-panel" data-panel="playlist" hidden>${playlistFormHtml(c)}</div>
      ${isPast ? `<div class="expand-panel" data-panel="photo" hidden>${photoFormHtml(c)}</div>` : ''}
      ${hasSetlist ? `<div class="expand-panel" data-panel="setlist" hidden>${mcSetlistPanelContentHtml(c)}</div>` : ''}
    </div>`;
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

// Ticket cost — its own standalone block, entirely separate from the
// rating/notes review below it, and shown on BOTH upcoming and past cards
// (rating/notes stays past-only, since you can't review a show you haven't
// been to yet, but money spent on a ticket is just as real before the show
// as after it). Same collapsed-"Add"/visible-plus-"Edit" shape as the
// Playlist block above.
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

function ticketCostFormHtml(c) {
  const isFree = c.ticketPrice === 0;
  const hasPrice = typeof c.ticketPrice === 'number' && !Number.isNaN(c.ticketPrice);
  return `
    <div class="ticket-cost-form">
      <div class="ticket-cost-free-row">
        <span class="review-cost-label">Ticket cost</span>
        <button type="button" class="toggle-pill ticket-cost-free-toggle${isFree ? ' active' : ''}">${isFree ? icon('check') + ' Free' : 'Free'}</button>
      </div>
      <div class="review-cost-row">
        <label class="review-cost-field">
          <span class="review-cost-label">Price</span>
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
        ev.target.closest('.row-links-group')
      ) return;
      openProfile(row.dataset.bandId);
    });
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
      const c = concerts.find((x) => x.id === concertId);
      if (!c) return;
      const form = btn.closest('.ticket-cost-form');
      const priceRaw = form.querySelector('.ticket-price-input').value;
      const qtyRaw = form.querySelector('.ticket-qty-input').value;
      // Read as a plain Number() + isNaN check, not `Number(x) || null` — the
      // old `||` version silently turned a genuine 0 price into null, which
      // would have broken the new Free toggle (0 kr) the same way.
      const parsedPrice = priceRaw !== '' ? Number(priceRaw) : null;
      const ticketPrice = parsedPrice === null || Number.isNaN(parsedPrice) ? null : parsedPrice;
      c.ticketPrice = ticketPrice;
      c.ticketQuantity = ticketPrice !== null ? (Number(qtyRaw) || 1) : null;
      await dlWriteJsonFile(remote, 'concerts.json', concerts);
      refresh();
    });
  });

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

function renderStatsScreen() {
  const container = el('screen-stats');
  const liveConcerts = concerts.filter((c) => bands.some((b) => b.id === c.bandId));
  const { past, upcoming } = dlMyConcerts(liveConcerts);

  if (past.length === 0) {
    container.innerHTML = `<p class="screen-empty">No past concerts logged yet — your stats will show up here once you've attended a few shows.</p>`;
    return;
  }

  const stats = dlConcertStats(past, bands, upcoming);
  const kmCaveat = stats.knownDistanceCount < stats.totalShows
    ? `<br><span class="stats-kpi-caveat">from ${stats.knownDistanceCount} of ${stats.totalShows} shows</span>`
    : '';

  const tiles = [
    { value: stats.totalShows.toLocaleString(), label: 'shows attended' },
    { value: stats.countries.toLocaleString(), label: 'countries' },
    { value: stats.kmTraveled.toLocaleString(), label: `km traveled${kmCaveat}` },
    { value: stats.totalUniqueArtists.toLocaleString(), label: 'different artists seen' },
  ];
  if (stats.busiestYear) tiles.push({ value: escapeHtml(stats.busiestYear.year), label: `busiest year, ${stats.busiestYear.count} shows` });
  if (stats.busiestMonth) tiles.push({ value: MONTH_NAMES[stats.busiestMonth.month - 1], label: `busiest month, ${stats.busiestMonth.count} shows` });
  if (stats.longestGap) tiles.push({ value: formatGapLabel(stats.longestGap.days), label: 'longest gap' });
  if (stats.firstShow) tiles.push({ value: escapeHtml((stats.firstShow.date || '').slice(0, 4)), label: `first show, ${escapeHtml(stats.firstShow.bandName)}` });
  if (stats.farthestShow) tiles.push({ value: formatKm(stats.farthestShow.distanceKm), label: `farthest show, ${escapeHtml(stats.farthestShow.bandName)}` });
  if (stats.closestShow) tiles.push({ value: formatKm(stats.closestShow.distanceKm), label: `closest show, ${escapeHtml(stats.closestShow.bandName)}` });
  if (stats.mostVisitedCity) tiles.push({ value: stats.mostVisitedCity.count.toLocaleString(), label: `most-visited city, ${escapeHtml(stats.mostVisitedCity.city)}` });
  if (stats.festivalsAttended > 0) tiles.push({ value: stats.festivalsAttended.toLocaleString(), label: 'festivals attended' });
  if (stats.knownSpendCount > 0) {
    const spendCaveat = stats.knownSpendCountPast < stats.totalShows
      ? `<br><span class="stats-kpi-caveat">from ${stats.knownSpendCountPast} of ${stats.totalShows} past shows</span>`
      : '';
    tiles.push({ value: `${stats.totalSpend.toLocaleString()} kr`, label: `spent on tickets, all time${spendCaveat}` });
    tiles.push({ value: `${stats.averageTicketPrice.toLocaleString()} kr`, label: 'average ticket price' });
  }
  const tilesHtml = tiles.map((t) => `<div class="stats-kpi-tile"><span class="stats-kpi-value">${t.value}</span><span class="stats-kpi-label">${t.label}</span></div>`).join('');

  const TOP_RATED_DISPLAY_CAP = 8;

  container.innerHTML = `
    <div class="stats-kpi-grid">${tilesHtml}</div>
    ${stats.topRatedShows.length > 0 ? `
      <p class="section-label">Top-rated shows</p>
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

function exportDataAsCsv() {
  downloadTextFile(`bands-${todayStamp()}.csv`, arrayToCsv(bands), 'text/csv');
  downloadTextFile(`concerts-${todayStamp()}.csv`, arrayToCsv(concerts), 'text/csv');
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(concerts), 'Concerts');
  XLSX.writeFile(wb, `concert-tracker-export-${todayStamp()}.xlsx`);
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
    ? `<p class="muted" style="font-size:11.5px;margin:0 0 8px">
         <strong>${escapeHtml(maskApiKey(groqApiKey))}</strong>
         ${groqApiKeyAddedAt ? ` · added ${escapeHtml(formatSettingsDate(groqApiKeyAddedAt))}` : ''}
       </p>`
    : '';
  container.innerHTML = `
    <p class="section-label">Connection</p>
    <div class="settings-card">
      <p class="muted" style="font-size:11.5px;margin:0 0 8px">${escapeHtml(remote?.endpoint || 'Not connected')}${remote?.token ? ` · ${escapeHtml(maskApiKey(remote.token))}` : ''}</p>
      <button id="change-connection-btn" class="btn-secondary">Change connection</button>
    </div>

    <p class="section-label">Band info lookups</p>
    <div class="settings-card">
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
    </div>

    <p class="section-label">Display</p>
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

    ${researchPipelineSectionHtml()}

    <p class="settings-version">ConcertDates ${escapeHtml(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?')}</p>
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

  const groqKeyToggleBtn = el('groq-key-toggle-visibility');
  groqKeyToggleBtn.innerHTML = icon('eye');
  let groqKeyVisible = false;
  groqKeyToggleBtn.addEventListener('click', () => {
    groqKeyVisible = !groqKeyVisible;
    el('groq-key-input').type = groqKeyVisible ? 'text' : 'password';
    groqKeyToggleBtn.innerHTML = icon(groqKeyVisible ? 'eyeOff' : 'eye');
    groqKeyToggleBtn.setAttribute('aria-label', groqKeyVisible ? 'Hide key' : 'Show key');
    groqKeyToggleBtn.setAttribute('title', groqKeyVisible ? 'Hide key' : 'Show key');
  });

  el('export-csv-btn').addEventListener('click', () => {
    exportDataAsCsv();
    el('export-status').textContent = 'CSV files downloading…';
    setTimeout(() => (el('export-status').textContent = ''), 2000);
  });

  el('export-excel-btn').addEventListener('click', async () => {
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

// Where the GitHub Actions workflow lives — used only for an external
// "View pipeline runs" link. There's deliberately no way to trigger a run
// from inside the app: doing that would require a GitHub token with
// write access embedded in this public, client-side static site, which
// would be readable by anyone. Opening the Actions tab (gated by your own
// GitHub login) is the safe equivalent of a "run now" button.
const RESEARCH_PIPELINE_ACTIONS_URL = 'https://github.com/mstpln/concert-tracker-mobile/actions/workflows/research.yml';

function usageBarRowHtml(label, used, cap) {
  const u = Number(used) || 0;
  const c = Number(cap) || 1;
  const pct = Math.min(100, Math.max(0, (u / c) * 100));
  return `
    <div class="usage-bar-row">
      <div class="usage-bar-label-row">
        <span>${escapeHtml(label)}</span>
        <span>${u.toLocaleString()} / ${c.toLocaleString()}</span>
      </div>
      <div class="usage-bar-track"><div class="usage-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
}

// Renders the read-only "Research pipeline" block in Settings: which
// provider keys are configured (masked — GitHub Actions secrets can't be
// read back, so this is a static record, see RESEARCH_KEY_METADATA above)
// and how much of each free tier this week's run has used, sourced from
// apiUsage.json (written by scripts/research.js, never by this app).
function researchPipelineSectionHtml() {
  const keyRows = Object.values(RESEARCH_KEY_METADATA)
    .map(
      (k) => `
        <p class="muted" style="font-size:11px;margin:0 0 3px">
          ${escapeHtml(k.label)}: <strong>${escapeHtml(k.masked)}</strong>
        </p>`
    )
    .join('');

  const actionButtons = `
    <div class="show-buttons" style="margin-top:10px">
      <button id="recheck-btn" class="btn-secondary">Refresh now</button>
      <a id="view-pipeline-runs-btn" class="btn-secondary" href="${escapeAttr(RESEARCH_PIPELINE_ACTIONS_URL)}" target="_blank" rel="noopener">View pipeline runs</a>
    </div>
    <p class="settings-hint">Refresh re-fetches your data now. Research runs automatically once a week — view pipeline runs opens GitHub to check on or manually trigger one.</p>`;

  if (!apiUsage) {
    return `
      <p class="section-label">Research pipeline</p>
      <div class="settings-card">
        ${keyRows}
        <p class="settings-hint" style="margin-top:6px">No usage data yet — this fills in after the weekly GitHub Actions run has run at least once.</p>
        <div class="settings-card-divider">${actionButtons}</div>
      </div>`;
  }

  const tm = apiUsage.ticketmaster || {};
  const tv = apiUsage.tavily || {};
  const gq = apiUsage.groq || {};
  const sl = apiUsage.setlistfm || {};
  const lastRun = apiUsage.lastRun || null;

  const bars =
    usageBarRowHtml('Ticketmaster (today)', tm.callsToday, tm.freeTierDailyLimit ?? 5000) +
    usageBarRowHtml('Tavily (this month)', tv.callsThisMonth, tv.freeTierMonthlyLimit ?? 1000) +
    usageBarRowHtml('Groq requests (today)', gq.callsToday, gq.freeTierDailyRequestLimit ?? 1000) +
    usageBarRowHtml('Groq tokens (today)', gq.tokensToday ?? 0, gq.freeTierTpdLimit ?? 200000) +
    usageBarRowHtml('setlist.fm (today)', sl.callsToday, sl.freeTierDailyLimit ?? 1440);

  const lastRunHtml = lastRun
    ? `<p class="settings-hint" style="margin-top:8px">
         Last run ${escapeHtml(formatSettingsDate(lastRun.finishedAt))} · ${escapeHtml(lastRun.status || 'unknown')}
         · ${lastRun.bandsProcessed ?? 0} bands checked, ${lastRun.concertsAdded ?? 0} new concerts, ${lastRun.newsAdded ?? 0} new news items, ${lastRun.setlistsAdded ?? 0} new setlists.
       </p>`
    : '';

  return `
    <p class="section-label">Research pipeline</p>
    <div class="settings-card">
      ${keyRows}
      <div class="settings-card-divider">
        ${bars}
        ${lastRunHtml}
        <p class="settings-hint" style="margin-top:8px">All three services have hard-coded usage caps set well below their free tier, so this can never incur a charge.</p>
      </div>
      <div class="settings-card-divider">${actionButtons}</div>
    </div>`;
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
