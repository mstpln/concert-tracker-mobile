'use strict';

(function installDiscoverV170(root) {
  if (root.__LIVEVAULT_DISCOVER_V170__) return;
  root.__LIVEVAULT_DISCOVER_V170__ = true;

  const Model = root.LiveVaultDiscoverModelV170;
  const Provider = root.LiveVaultDiscoverProviderV170;
  if (!Model || !Provider) return;

  const FILE = 'discoverRecommendations.json';
  let state = Model.emptyState(null);
  let stateLoaded = false;
  let refreshPromise = null;
  let lastRenderedSubTab = null;
  let headerObserver = null;
  const baseRenderConcertsScreen = typeof renderConcertsScreen === 'function' ? renderConcertsScreen : null;
  const errorByMbid = new Map();

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function replaceHtml(node, html) {
    if (node && node.innerHTML !== html) node.innerHTML = html;
  }
  function currentRemote() {
    try { if (typeof remote !== 'undefined' && remote) return remote; } catch (_) {}
    return typeof rsGetConnection === 'function' ? rsGetConnection() : null;
  }
  function currentBands() {
    try { if (typeof bands !== 'undefined' && Array.isArray(bands)) return bands; } catch (_) {}
    return [];
  }
  function nowIso() { return new Date().toISOString(); }
  function qaMode() { return root.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ === true || root.__LIVEVAULT_QA_FAKE_BACKEND__ === true; }

  function setDiscoverHeader() {
    const suffix = concertsSubTab === 'venues' ? 'VENUES' : concertsSubTab === 'bands' ? 'BANDS' : 'CONCERTS';
    const title = root.document?.getElementById('header-title');
    if (title && currentTab === 'concerts' && currentScreen === 'main') replaceHtml(title, `<span class="brand-blue">DISCOVER</span>${suffix}`);
  }
  function standardizeHeader() {
    const title = root.document?.getElementById('header-title');
    if (!title) return;
    const normalized = String(title.textContent || '').replace(/\s+/g, '').toUpperCase();
    if (currentTab === 'concerts' && currentScreen === 'main') return setDiscoverHeader();
    if (normalized === 'LISTENINGSTATS') replaceHtml(title, `LISTENING<span class="brand-blue">STATS</span>`);
    else if (normalized === 'MYBANDS') replaceHtml(title, `MY<span class="brand-blue">BANDS</span>`);
  }
  function installHeaderRules() {
    try {
      TAB_NAV_ICONS.concerts = 'globe';
      TAB_HEADER_ICONS.concerts = 'globe';
      TAB_TITLES.concerts = 'Discover';
      TAB_BRAND_HTML.concerts = '<span class="brand-blue">DISCOVER</span>CONCERTS';
      TAB_BRAND_HTML.mybands = 'MY<span class="brand-blue">BANDS</span>';
    } catch (_) {}
    const tab = root.document?.querySelector('#tabbar [data-tab="concerts"]');
    if (tab) {
      const iconNode = tab.querySelector('.tab-icon');
      if (iconNode && typeof icon === 'function') replaceHtml(iconNode, icon('globe'));
      const textNode = [...tab.childNodes].find((node) => node.nodeType === 3);
      if (textNode && textNode.nodeValue !== 'Discover') textNode.nodeValue = 'Discover';
    }
    standardizeHeader();
    if (!headerObserver && root.MutationObserver) {
      const node = root.document?.getElementById('app-header');
      if (node) {
        headerObserver = new root.MutationObserver(() => standardizeHeader());
        headerObserver.observe(node, { childList: true, subtree: true, characterData: true });
      }
    }
  }

  function tabsHtml() {
    return `<div class="stats-subtabs discover-subtabs" role="tablist" aria-label="Discover sections">
      ${[['concerts', 'Concerts'], ['venues', 'Venues'], ['bands', 'Bands']].map(([key, label]) => `<button type="button" class="stats-subtab-btn${concertsSubTab === key ? ' active' : ''}" data-discover-tab="${key}" role="tab" aria-selected="${concertsSubTab === key}">${label}</button>`).join('')}
    </div>`;
  }
  function wireTabs(container) {
    container.querySelectorAll('[data-discover-tab]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.discoverTab === concertsSubTab) return;
      concertsSubTab = button.dataset.discoverTab;
      setDiscoverHeader();
      renderConcertsScreen();
    }));
  }
  function decorateBaseTabs(container) {
    const prior = container.querySelector('.news-subtab-switch');
    if (prior) prior.outerHTML = tabsHtml();
    else if (!container.querySelector('.discover-subtabs')) container.insertAdjacentHTML('afterbegin', tabsHtml());
    wireTabs(container);
    setDiscoverHeader();
  }
  function metadataHtml(candidate) {
    const parts = [];
    if (Array.isArray(candidate.tags) && candidate.tags.length) parts.push(candidate.tags.slice(0, 2).map(esc).join(' · '));
    if (candidate.area) parts.push(esc(candidate.area));
    if (candidate.beginYear) parts.push(`Formed ${esc(candidate.beginYear)}`);
    return parts.length ? `<div class="discover-meta">${parts.join('<span aria-hidden="true"> · </span>')}</div>` : '';
  }
  function cardHtml(candidate) {
    const mbid = esc(candidate.artistMbid);
    const error = errorByMbid.get(candidate.artistMbid);
    return `<article class="discover-card" data-discover-mbid="${mbid}">
      <div class="discover-card-copy"><div class="discover-artist-name">${esc(candidate.name)}</div>${metadataHtml(candidate)}${error ? `<div class="discover-error" role="status">${esc(error)}</div>` : ''}</div>
      <div class="discover-actions">
        <a class="discover-spotify" href="${esc(Model.spotifySearchUrl(candidate.name))}" target="_blank" rel="noopener noreferrer" aria-label="Listen to ${esc(candidate.name)} on Spotify">${typeof icon === 'function' ? icon('spotify') : ''}<span>Spotify</span></a>
        <button type="button" class="discover-dismiss" data-discover-dismiss="${mbid}">Dismiss</button>
        <button type="button" class="discover-add" data-discover-add="${mbid}">Add band</button>
      </div>
    </article>`;
  }
  function bandsHtml() {
    const groups = Model.visibleGroups(state, currentBands());
    if (!groups.length) return `<div class="discover-groups"><p class="screen-empty">No recommendations waiting right now.</p></div>`;
    return `<div class="discover-groups">${groups.map((group) => `<section class="discover-group" data-discover-seed="${esc(group.seedMbid)}"><h2>Similar to ${esc(group.seedName)}</h2><div class="discover-cards">${group.candidates.map(cardHtml).join('')}</div></section>`).join('')}</div>`;
  }
  function renderBands() {
    const container = el('screen-concerts');
    el('nearby-toggle-btn')?.classList.add('hidden');
    el('europe-toggle-btn')?.classList.add('hidden');
    el('sweden-toggle-btn')?.classList.add('hidden');
    container.innerHTML = tabsHtml() + bandsHtml();
    wireTabs(container);
    wireCards(container);
    setDiscoverHeader();
  }

  async function readState() {
    const connection = currentRemote();
    if (!connection || typeof dlReadJsonFile !== 'function') return state;
    const loaded = await dlReadJsonFile(connection, FILE, null);
    if (loaded == null) state = Model.emptyState(null);
    else if (!Model.validateState(loaded)) throw new Error('Stored Discover recommendations are invalid.');
    else state = loaded;
    stateLoaded = true;
    return state;
  }
  async function persistOperation(operation, attempts = 3) {
    const connection = currentRemote();
    if (!connection) throw new Error('Connect BANDMARKR storage first.');
    let latest = await dlReadJsonFile(connection, FILE, null);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const base = Model.validateState(latest) ? latest : Model.emptyState(null);
      const intended = operation(base);
      if (!Model.validateState(intended)) throw new Error('Discover update failed validation.');
      try {
        await dlWriteJsonFileIfCurrent(connection, FILE, intended);
        state = intended;
        stateLoaded = true;
        return intended;
      } catch (error) {
        if (!/changed/i.test(String(error?.message || '')) || attempt === attempts - 1) throw error;
        latest = await dlReadJsonFile(connection, FILE, null);
      }
    }
    throw new Error('Discover update could not be saved.');
  }
  function findCandidate(mbid) {
    for (const group of state.groups || []) for (const candidate of group.candidates || []) if (candidate.artistMbid === mbid) return candidate;
    return null;
  }
  function safeBandId() {
    if (root.crypto?.randomUUID) return `band-${root.crypto.randomUUID()}`;
    return `band-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function trustedBandByMbid(rows, mbid) {
    const normalized = Model.normalizeMbid(mbid);
    return (rows || []).find((band) => Model.trustedBandMbid(band) === normalized) || null;
  }
  function newBandFromCandidate(candidate, id, createdAt) {
    const band = {
      id,
      name: candidate.name,
      officialUrl: null,
      photoUrl: null,
      genre: null,
      origin: null,
      formedYear: null,
      bio: null,
      socials: {},
      addedAt: createdAt,
      enrichedAt: null,
      musicbrainz: {
        mbid: candidate.artistMbid,
        artistName: candidate.name,
        area: candidate.area || null,
        country: null,
        artistType: null,
        disambiguation: null,
        confidence: 'user_confirmed',
        status: 'manual_confirmed',
        matchMethod: 'discover_user_add',
        source: 'MusicBrainz',
        matchedAt: createdAt,
        reviewedAt: createdAt,
      },
      discoverRecommendation: {
        source: 'listenbrainz_similar_artists',
        artistMbid: candidate.artistMbid,
        discoveredAt: candidate.discoveredAt || createdAt,
      },
      _enriching: true,
    };
    root.LiveVaultSecurity?.preparePendingArtistEnrichment?.(band, createdAt);
    return band;
  }
  function reconcileBands(rows) {
    const list = currentBands();
    if (!Array.isArray(list)) return;
    list.splice(0, list.length, ...JSON.parse(JSON.stringify(rows)));
  }
  async function persistAddedBand(candidate, attempts = 3) {
    const connection = currentRemote();
    if (!connection) throw new Error('Connect BANDMARKR storage first.');
    const createdAt = nowIso();
    const created = newBandFromCandidate(candidate, safeBandId(), createdAt);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const latest = await dlReadJsonFile(connection, 'bands.json', []);
      if (!Array.isArray(latest)) throw new Error('Stored bands data is invalid.');
      const existing = trustedBandByMbid(latest, candidate.artistMbid);
      if (existing) {
        reconcileBands(latest);
        return existing;
      }
      const intended = [...latest, created];
      const persisted = typeof stripTransient === 'function' ? stripTransient(intended) : intended;
      try {
        await dlWriteJsonFileIfCurrent(connection, 'bands.json', persisted);
        reconcileBands(persisted);
        return persisted.find((band) => band.id === created.id) || created;
      } catch (error) {
        if (!/changed/i.test(String(error?.message || '')) || attempt === attempts - 1) throw error;
      }
    }
    throw new Error('Band update could not be saved.');
  }
  function showAddedState(button) {
    const card = button?.closest?.('.discover-card');
    if (!card) return;
    card.querySelector('[data-discover-dismiss]')?.remove();
    button.disabled = true;
    button.classList.add('is-added');
    button.textContent = 'Added ✓';
  }
  async function addBand(mbid, button) {
    const candidate = findCandidate(mbid);
    if (!candidate) return;
    errorByMbid.delete(mbid);
    button.disabled = true;
    const feedback = root.LiveVaultInteractionFeedbackV129;
    const handle = feedback?.begin?.({ key: `discover-add:${mbid}` });
    try {
      const band = await persistAddedBand(candidate);
      await persistOperation((latest) => Model.resolveCandidate(latest, mbid, 'added', { now: nowIso(), addedBandId: band.id }));
      showAddedState(button);
      root.setTimeout(() => { if (concertsSubTab === 'bands' && currentTab === 'concerts') renderBands(); }, 700);
    } catch (error) {
      errorByMbid.set(mbid, 'Could not add this band. Try again.');
      renderBands();
    } finally { feedback?.end?.(handle, { minVisibleMs: 180 }); }
  }
  async function dismiss(mbid, button) {
    if (!findCandidate(mbid)) return;
    errorByMbid.delete(mbid);
    button.disabled = true;
    const feedback = root.LiveVaultInteractionFeedbackV129;
    const handle = feedback?.begin?.({ key: `discover-dismiss:${mbid}` });
    try {
      await persistOperation((latest) => Model.resolveCandidate(latest, mbid, 'dismissed', { now: nowIso() }));
      renderBands();
    } catch (error) {
      errorByMbid.set(mbid, 'Could not dismiss this recommendation. Try again.');
      renderBands();
    } finally { feedback?.end?.(handle, { minVisibleMs: 180 }); }
  }
  function wireCards(container) {
    container.querySelectorAll('[data-discover-add]').forEach((button) => button.addEventListener('click', () => void addBand(button.dataset.discoverAdd, button)));
    container.querySelectorAll('[data-discover-dismiss]').forEach((button) => button.addEventListener('click', () => void dismiss(button.dataset.discoverDismiss, button)));
  }

  async function refreshIfDue({ force = false, provider = Provider } = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!stateLoaded) await readState();
      if (!force && !Model.isStale(state)) return { kind: 'fresh' };
      if (!force && qaMode()) return { kind: 'qa-skipped' };
      const connection = currentRemote();
      if (!connection) return { kind: 'unavailable' };
      const activity = await dlReadJsonFile(connection, 'listening/band-activity.json', null);
      const seeds = Model.selectSeeds(activity, currentBands());
      if (!seeds.length) return { kind: 'no-seeds' };
      const results = await provider.discoverForSeeds(seeds);
      await persistOperation((latest) => Model.admitRefresh(latest, results, currentBands(), nowIso()));
      if (concertsSubTab === 'bands' && currentTab === 'concerts' && currentScreen === 'main') renderBands();
      return { kind: 'updated', groups: results.length };
    })().catch((error) => ({ kind: 'failed', error })).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  if (baseRenderConcertsScreen) {
    renderConcertsScreen = function renderDiscoverV170() {
      installHeaderRules();
      if (concertsSubTab === 'bands') {
        lastRenderedSubTab = 'bands';
        renderBands();
        return;
      }
      if (lastRenderedSubTab === 'bands') root.LiveVaultVenueNavigationRenderPerformanceV166?.invalidate?.();
      lastRenderedSubTab = concertsSubTab;
      baseRenderConcertsScreen();
      const container = el('screen-concerts');
      decorateBaseTabs(container);
    };
  }

  async function bootstrap() {
    installHeaderRules();
    try { await readState(); } catch (_) { stateLoaded = true; }
    if (concertsSubTab === 'bands' && currentTab === 'concerts') renderBands();
    void refreshIfDue();
  }
  root.document?.addEventListener?.('visibilitychange', () => {
    if (root.document.visibilityState === 'visible') void refreshIfDue();
  });
  root.setTimeout(() => void bootstrap(), 0);

  root.LiveVaultDiscoverV170 = Object.freeze({ FILE, readState, refreshIfDue, renderBands, persistOperation, persistAddedBand, setDiscoverHeader, getState: () => state });
})(typeof globalThis !== 'undefined' ? globalThis : this);