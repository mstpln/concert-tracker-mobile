'use strict';

// v143 aligned UI refinements. The Sweden filters are presentation-only
// views over the existing concert data; they never mutate concerts.json.
let swedenOnly = false;
let profileSwedenOnly = false;

const v143GeoStateReady = Promise.resolve(window.LiveVaultV143GeoStateReady).then((state) => {
  swedenOnly = state?.swedenOnly === true;
  return state;
});

function v143IsSwedenCountry(country) {
  return String(country || '').trim().toLowerCase() === 'sweden';
}

function v143SyncMainGeoFilterState() {
  const nearby = el('nearby-toggle-btn');
  const sweden = el('sweden-toggle-btn');
  const europe = el('europe-toggle-btn');
  if (!nearby || !sweden || !europe) return;

  const tabbarVisible = !el('tabbar')?.classList.contains('hidden');
  const showSweden = tabbarVisible && currentTab === 'concerts' && currentScreen === 'main' && concertsSubTab === 'concerts';
  sweden.classList.toggle('hidden', !showSweden);
  nearby.classList.toggle('active', nearbyOnly);
  sweden.classList.toggle('active', swedenOnly);
  europe.classList.toggle('active', europeOnly);
  nearby.setAttribute('aria-pressed', String(nearbyOnly));
  sweden.setAttribute('aria-pressed', String(swedenOnly));
  europe.setAttribute('aria-pressed', String(europeOnly));
}

async function v143ToggleSwedenOnly() {
  swedenOnly = !swedenOnly;
  if (swedenOnly) {
    nearbyOnly = false;
    europeOnly = false;
  }
  v143SyncMainGeoFilterState();
  await chrome.storage.local.set({ swedenOnly, nearbyOnly, europeOnly });
  if (currentTab === 'concerts' && currentScreen === 'main') renderConcertsScreen();
}

// Alerts uses the same two-tone naming convention as ConcertDates.
TAB_BRAND_HTML.news = '<span class="brand-blue">CONCERT</span>ALERTS';

// Keep the third root-header filter aligned with the existing screen chrome.
const v143BaseSetHeaderChrome = setHeaderChrome;
setHeaderChrome = function v143SetHeaderChrome(...args) {
  const result = v143BaseSetHeaderChrome.apply(this, args);
  v143SyncMainGeoFilterState();
  return result;
};

// My Concerts keeps its existing renderer; add only a styling hook to the
// existing Upcoming label so it can mirror the established Past divider.
function v143AlignMyConcertsSeparator() {
  const labels = el('screen-myconcerts')?.querySelectorAll(':scope > .section-label');
  for (const label of labels || []) {
    if (label.textContent.trim().toLowerCase() === 'upcoming concerts') {
      label.classList.add('section-label-v143-upcoming');
      break;
    }
  }
}

const v143BaseRenderMyConcertsScreen = renderMyConcertsScreen;
renderMyConcertsScreen = function v143RenderMyConcertsScreen(...args) {
  const result = v143BaseRenderMyConcertsScreen.apply(this, args);
  v143AlignMyConcertsSeparator();
  return result;
};

// The header button exists in the static shell, so it can be wired before
// DOMContentLoaded. Existing EU/Nearby handlers remain the owners of those
// filters; capture-phase handling only clears the third mutually-exclusive
// Sweden state before their normal click logic runs.
const v143SwedenToggle = el('sweden-toggle-btn');
if (v143SwedenToggle) {
  v143SwedenToggle.textContent = 'SE';
  v143SwedenToggle.addEventListener('click', v143ToggleSwedenOnly);
}

el('app-header')?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !swedenOnly) return;
  if (button.id !== 'nearby-toggle-btn' && button.id !== 'europe-toggle-btn') return;
  swedenOnly = false;
  v143SyncMainGeoFilterState();
  void chrome.storage.local.set({ swedenOnly: false });
}, true);

document.addEventListener('DOMContentLoaded', () => {
  void v143GeoStateReady.then(() => {
    v143SyncMainGeoFilterState();
    if (swedenOnly && currentTab === 'concerts' && currentScreen === 'main') renderConcertsScreen();
  });
});

const v143BaseRenderConcertsScreen = renderConcertsScreen;
renderConcertsScreen = function v143RenderConcertsScreen(...args) {
  if (!swedenOnly || concertsSubTab !== 'concerts') {
    const result = v143BaseRenderConcertsScreen.apply(this, args);
    v143SyncMainGeoFilterState();
    return result;
  }

  const previousEuropeOnly = europeOnly;
  const previousNearbyOnly = nearbyOnly;
  const previousEuropePredicate = dlIsEuropeCountry;
  let result;
  europeOnly = true;
  nearbyOnly = false;
  dlIsEuropeCountry = v143IsSwedenCountry;
  try {
    result = v143BaseRenderConcertsScreen.apply(this, args);
  } finally {
    dlIsEuropeCountry = previousEuropePredicate;
    europeOnly = previousEuropeOnly;
    nearbyOnly = previousNearbyOnly;
  }

  const empty = el('screen-concerts')?.querySelector('.screen-empty');
  if (empty?.textContent.trim() === 'No upcoming European concerts right now.') {
    empty.textContent = 'No upcoming concerts in Sweden right now.';
  }
  v143SyncMainGeoFilterState();
  return result;
};

const v143BaseOpenProfile = openProfile;
openProfile = function v143OpenProfile(...args) {
  profileSwedenOnly = false;
  return v143BaseOpenProfile.apply(this, args);
};

function v143SyncProfileGeoFilterState(container) {
  const nearby = container.querySelector('#profile-nearby-toggle-btn');
  const sweden = container.querySelector('#profile-sweden-toggle-btn');
  const europe = container.querySelector('#profile-europe-toggle-btn');
  nearby?.classList.toggle('active', profileNearbyOnly);
  sweden?.classList.toggle('active', profileSwedenOnly);
  europe?.classList.toggle('active', profileEuropeOnly);
  nearby?.setAttribute('aria-pressed', String(profileNearbyOnly));
  sweden?.setAttribute('aria-pressed', String(profileSwedenOnly));
  europe?.setAttribute('aria-pressed', String(profileEuropeOnly));
}

function v143EnhanceProfileGeoFilters(bandId) {
  const container = el('screen-profile');
  const europe = container?.querySelector('#profile-europe-toggle-btn');
  if (!container || !europe) return;

  const sweden = document.createElement('button');
  sweden.id = 'profile-sweden-toggle-btn';
  sweden.className = 'icon-btn';
  sweden.type = 'button';
  sweden.textContent = 'SE';
  sweden.setAttribute('aria-label', 'Show Sweden only');
  sweden.setAttribute('title', 'Show Sweden only');
  europe.before(sweden);

  sweden.addEventListener('click', (event) => {
    event.stopPropagation();
    profileSwedenOnly = !profileSwedenOnly;
    if (profileSwedenOnly) {
      profileNearbyOnly = false;
      profileEuropeOnly = false;
    }
    renderProfileScreen(bandId);
  });

  v143SyncProfileGeoFilterState(container);
}

// Clear Sweden before the existing profile EU/Nearby handlers run, so all
// three geographic filters remain mutually exclusive without forking those
// established handlers.
el('screen-profile')?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !profileSwedenOnly) return;
  if (button.id === 'profile-europe-toggle-btn' || button.id === 'profile-nearby-toggle-btn') {
    profileSwedenOnly = false;
  }
}, true);

const v143BaseRenderProfileScreen = renderProfileScreen;
renderProfileScreen = function v143RenderProfileScreen(bandId, ...rest) {
  let result;
  if (profileSwedenOnly && profileTab === 'concerts') {
    const previousEuropeOnly = profileEuropeOnly;
    const previousNearbyOnly = profileNearbyOnly;
    const previousEuropePredicate = dlIsEuropeCountry;
    profileEuropeOnly = true;
    profileNearbyOnly = false;
    dlIsEuropeCountry = v143IsSwedenCountry;
    try {
      result = v143BaseRenderProfileScreen.call(this, bandId, ...rest);
    } finally {
      dlIsEuropeCountry = previousEuropePredicate;
      profileEuropeOnly = previousEuropeOnly;
      profileNearbyOnly = previousNearbyOnly;
    }

    const empty = el('screen-profile')?.querySelector('.profile-tab-panel .screen-empty');
    if (empty?.textContent.trim() === 'No upcoming European shows for this band right now.') {
      empty.textContent = 'No upcoming shows in Sweden for this band right now.';
    }
  } else {
    result = v143BaseRenderProfileScreen.call(this, bandId, ...rest);
  }

  v143EnhanceProfileGeoFilters(bandId);
  return result;
};
