'use strict';

let topListMode = 'bands';

function topListTimeframeControlHtml(selected) {
  const options = [
    ['twoWeeks', '2 weeks'],
    ['threeMonths', '3 months'],
    ['oneYear', '1 year'],
    ['allTime', 'All time'],
  ];
  return `<div class="listening-timeframe" role="group" aria-label="Toplist timeframe">
    ${options.map(([key, label]) => `<button type="button" class="listening-timeframe-btn${selected === key ? ' active' : ''}" data-listening-timeframe="${key}" aria-pressed="${selected === key}">${label}</button>`).join('')}
  </div>`;
}

function topListTabsHtml() {
  return `<div class="toplist-tabs" role="tablist" aria-label="Toplist ranking">
    ${[['bands', 'Top Bands'], ['tracks', 'Top Tracks']].map(([key, label]) => `<button type="button" class="toplist-tab${topListMode === key ? ' active' : ''}" data-toplist-mode="${key}" role="tab" aria-selected="${topListMode === key}"${topListMode === key ? '' : ' tabindex="-1"'}>${label}</button>`).join('')}
  </div>`;
}

function topListTrackMovement(current, previous, timeframe) {
  const previousRanks = new Map((previous || []).map((track, index) => [track.recordingKey, track.rank || index + 1]));
  return (current || []).map((track, index) => {
    if (timeframe === 'allTime') return { ...track, movement: null };
    const rank = track.rank || index + 1;
    const previousRank = previousRanks.get(track.recordingKey);
    if (!previousRank) return { ...track, movement: { kind: 'new', delta: null, label: 'New' } };
    const delta = previousRank - rank;
    if (delta > 0) return { ...track, movement: { kind: 'up', delta, label: `Up ${delta}` } };
    if (delta < 0) return { ...track, movement: { kind: 'down', delta: Math.abs(delta), label: `Down ${Math.abs(delta)}` } };
    return { ...track, movement: null };
  });
}

function topListTrackRowsHtml(stats) {
  const current = ListeningStats.topTracks(stats.listens, 100);
  const previous = ListeningStats.topTracks(stats.previousListens || [], 100);
  const tracks = topListTrackMovement(current, previous, topBandsTimeframe);
  if (!tracks.length) return '<p class="listening-empty">No tracks are available for this period.</p>';
  return tracks.map((track) => {
    const band = track.localBandId ? bands.find((candidate) => candidate.id === track.localBandId) : null;
    const artist = band?.name || track.artistCreditName || 'Unknown artist';
    const content = `<span class="top-track-rank">#${track.rank}</span>${trackArtworkHtml(track)}<span class="top-track-copy"><strong>${escapeHtml(track.recordingTitle)}</strong><span class="top-track-artist">${escapeHtml(artist)}</span><small>${track.listenCount.toLocaleString()} listens · ${ListeningStats.formatDuration(track.durationMs)}</small></span>${movementHtml(track.movement)}`;
    if (!band) return `<div class="toplist-track-row">${content}</div>`;
    return `<button type="button" class="toplist-track-row" data-listening-band-id="${escapeAttr(band.id)}" data-listening-source-timeframe="${escapeAttr(topBandsTimeframe)}">${content}</button>`;
  }).join('');
}

function topListModeForKey(mode, key) {
  if (key === 'ArrowRight' || key === 'ArrowLeft') return mode === 'bands' ? 'tracks' : 'bands';
  if (key === 'Home') return 'bands';
  if (key === 'End') return 'tracks';
  return null;
}

openTopBandsScreen = function openToplistScreen({ fromHistory = false, timeframe = 'threeMonths', mode = 'bands' } = {}) {
  const allowedTimeframes = ['twoWeeks', 'threeMonths', 'oneYear', 'allTime'];
  topBandsTimeframe = allowedTimeframes.includes(timeframe) ? timeframe : 'threeMonths';
  topListMode = mode === 'tracks' ? 'tracks' : 'bands';
  currentScreen = 'top-bands';
  setHeaderChrome({ showBack: true, title: 'Toplist' });
  el('europe-toggle-btn').classList.add('hidden');
  el('nearby-toggle-btn').classList.add('hidden');
  setActiveBottomTab('stats');
  showScreen('screen-top-bands');
  renderTopBandsScreen();
  if (!fromHistory) history.pushState({ tab: currentTab, screen: 'top-bands', timeframe: topBandsTimeframe, mode: topListMode }, '');
};

renderTopBandsScreen = function renderToplistScreen() {
  const container = el('screen-top-bands');
  const stats = globalListeningStats(topBandsTimeframe);
  const list = topListMode === 'tracks'
    ? `<div class="toplist-track-list">${topListTrackRowsHtml(stats)}</div>`
    : `<div class="top-bands-list">${topBandRowsHtml(stats.topBands, { timeframe: topBandsTimeframe })}</div>`;
  container.innerHTML = `${topListTimeframeControlHtml(topBandsTimeframe)}${topListTabsHtml()}<section class="listening-card full-top-bands-card">${list}</section>`;

  wireListeningTimeframe(container, (timeframe) => {
    topBandsTimeframe = timeframe;
    if (history.state?.screen === 'top-bands') history.replaceState({ ...history.state, timeframe, mode: topListMode }, '');
    renderTopBandsScreen();
  });

  container.querySelectorAll('[data-toplist-mode]').forEach((button) => {
    const activate = (mode, focus = false) => {
      topListMode = mode === 'tracks' ? 'tracks' : 'bands';
      if (history.state?.screen === 'top-bands') history.replaceState({ ...history.state, timeframe: topBandsTimeframe, mode: topListMode }, '');
      renderTopBandsScreen();
      if (focus) container.querySelector(`[data-toplist-mode="${topListMode}"]`)?.focus();
    };
    button.addEventListener('click', () => activate(button.dataset.toplistMode));
    button.addEventListener('keydown', (event) => {
      const next = topListModeForKey(button.dataset.toplistMode, event.key);
      if (!next) return;
      event.preventDefault();
      activate(next, true);
    });
  });

  wireListeningBandRows(container);
  wireListeningImages(container);
};
