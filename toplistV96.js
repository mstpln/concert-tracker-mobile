'use strict';

let topListMode = 'bands';
let statsTopListMode = 'bands';

function topListTimeframeControlHtml(selected) {
  const options = [['twoWeeks', '2 weeks'], ['threeMonths', '3 months'], ['oneYear', '1 year'], ['allTime', 'All time']];
  return `<div class="listening-timeframe" role="group" aria-label="Toplist timeframe">${options.map(([key, label]) => `<button type="button" class="listening-timeframe-btn${selected === key ? ' active' : ''}" data-listening-timeframe="${key}" aria-pressed="${selected === key}">${label}</button>`).join('')}</div>`;
}

function topListTabsHtml(mode = topListMode, scope = 'toplist') {
  return `<div class="toplist-tabs" role="tablist" aria-label="Toplist ranking">${[['bands', 'Top Bands'], ['tracks', 'Top Tracks']].map(([key, label]) => `<button type="button" class="toplist-tab${mode === key ? ' active' : ''}" data-${scope}-mode="${key}" role="tab" aria-selected="${mode === key}"${mode === key ? '' : ' tabindex="-1"'}>${label}</button>`).join('')}</div>`;
}

function topListHeading(mode, label) {
  return `${mode === 'tracks' ? 'TOP TRACKS' : 'TOP BANDS'} · ${String(label || '').toUpperCase()}`;
}

function topListTrackRowsHtml(stats, { limit = 100, timeframe = topBandsTimeframe } = {}) {
  const current = ToplistStatsV96.rankTracks(stats.listens, limit);
  const previous = ToplistStatsV96.rankTracks(stats.previousListens || [], limit);
  const tracks = ToplistStatsV96.withMovement(current, previous, timeframe);
  if (!tracks.length) return '<p class="listening-empty">No tracks are available for this period.</p>';
  return tracks.map((track) => {
    const band = track.localBandId ? bands.find((candidate) => candidate.id === track.localBandId) : null;
    const artist = band?.name || track.artistCreditName || 'Unknown artist';
    const content = `<span class="top-track-rank">#${track.rank}</span>${trackArtworkHtml(track)}<span class="top-track-copy"><strong>${escapeHtml(track.recordingTitle)}</strong><span class="top-track-artist">${escapeHtml(artist)}</span><small>${track.listenCount.toLocaleString()} listens · ${ListeningStats.formatDuration(track.durationMs)}</small></span>${movementHtml(track.movement)}`;
    return band ? `<button type="button" class="toplist-track-row" data-listening-band-id="${escapeAttr(band.id)}" data-listening-source-timeframe="${escapeAttr(timeframe)}">${content}</button>` : `<div class="toplist-track-row">${content}</div>`;
  }).join('');
}

function topListModeForKey(mode, key) {
  if (key === 'ArrowRight' || key === 'ArrowLeft') return mode === 'bands' ? 'tracks' : 'bands';
  if (key === 'Home') return 'bands';
  if (key === 'End') return 'tracks';
  return null;
}

function topListCardHtml(stats, mode, { preview = false } = {}) {
  const heading = topListHeading(mode, stats.label);
  const list = mode === 'tracks'
    ? `<div class="toplist-track-list">${topListTrackRowsHtml(stats, { limit: preview ? 5 : 100, timeframe: stats.timeframe })}</div>`
    : `<div class="top-bands-list">${topBandRowsHtml(preview ? stats.topBands.slice(0, 5) : stats.topBands, { timeframe: stats.timeframe })}</div>`;
  const viewAll = preview ? '<button type="button" class="listening-link" data-open-top-bands>View all</button>' : '';
  const footer = preview ? `<button type="button" class="listening-card-footer" data-open-top-bands>View full top 100${icon('chevronRight')}</button>` : '';
  return `<section class="listening-card ${preview ? 'top-bands-card' : 'full-top-bands-card'} toplist-card" aria-labelledby="${preview ? 'stats-toplist-title' : 'toplist-title'}">
    ${topListTabsHtml(mode, preview ? 'stats-toplist' : 'toplist')}
    <div class="listening-card-heading"><p id="${preview ? 'stats-toplist-title' : 'toplist-title'}">${escapeHtml(heading)}</p>${viewAll}</div>
    ${list}${footer}
  </section>`;
}

topBandsPreviewHtml = function topListPreviewHtml(stats) {
  return topListCardHtml(stats, statsTopListMode, { preview: true });
};

const renderStatsScreenBeforeToplistLayout = renderStatsScreen;
renderStatsScreen = function renderStatsScreenWithToplistCard() {
  renderStatsScreenBeforeToplistLayout();
  const container = el('screen-stats');
  container.querySelectorAll('[data-stats-toplist-mode]').forEach((button) => {
    const activate = (mode, focus = false) => {
      statsTopListMode = mode === 'tracks' ? 'tracks' : 'bands';
      renderStatsScreen();
      if (focus) container.querySelector(`[data-stats-toplist-mode="${statsTopListMode}"]`)?.focus();
    };
    button.addEventListener('click', () => activate(button.dataset.statsToplistMode));
    button.addEventListener('keydown', (event) => {
      const next = topListModeForKey(button.dataset.statsToplistMode, event.key);
      if (!next) return;
      event.preventDefault();
      activate(next, true);
    });
  });
};

openTopBandsScreen = function openToplistScreen({ fromHistory = false, timeframe = 'threeMonths', mode = 'bands' } = {}) {
  topBandsTimeframe = ['twoWeeks', 'threeMonths', 'oneYear', 'allTime'].includes(timeframe) ? timeframe : 'threeMonths';
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
  container.innerHTML = `${topListTimeframeControlHtml(topBandsTimeframe)}${topListCardHtml(stats, topListMode)}`;
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

window.addEventListener('popstate', (event) => {
  if (event.state?.screen !== 'top-bands') return;
  setTimeout(() => {
    topListMode = event.state.mode === 'tracks' ? 'tracks' : 'bands';
    if (currentScreen === 'top-bands') renderTopBandsScreen();
  }, 0);
});
