'use strict';

// v80's Start and Band Detail renderers are also wrapped by legacy visual
// adjustment scripts. Keep the v81 output authoritative after those renders.
(() => {
  let detailList = 'tracks';
  const openProfileBeforeBootFix = openProfile;
  openProfile = function openProfileWithOneYearListeningDefault(bandId, options = {}) {
    const listeningEntry = options.selectedTab === 'listening';
    if (listeningEntry) detailList = 'tracks';
    const result = openProfileBeforeBootFix(bandId, options);
    if (listeningEntry) {
      profileListeningTimeframe = 'oneYear';
      renderProfileScreen(bandId);
    }
    return result;
  };

  function durationText(item) {
    return item.durationMs > 0 ? ListeningStats.formatDuration(item.durationMs) : 'time unavailable';
  }
  function countText(value) {
    const count = Number(value || 0);
    return `${count.toLocaleString()} listen${count === 1 ? '' : 's'}`;
  }
  function placeholder() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>';
  }
  function artwork(item, album) {
    if (!item.artworkPath) return `<span class="track-artwork is-placeholder">${placeholder()}</span>`;
    return `<span class="track-artwork"><span>${album ? placeholder() : icon('music')}</span><img src="${escapeAttr(item.artworkPath)}" alt="" data-listening-image /></span>`;
  }
  function rankedItems() {
    const selected = globalListeningStats(profileListeningTimeframe).listens.filter((listen) => listen.localBandId === activeProfileBandId);
    return { selected, items: detailList === 'albums' ? ListeningStats.topAlbums(selected, 10) : ListeningStats.topTracks(selected, 10) };
  }
  function applyRankedTabs() {
    const card = document.querySelector('#screen-profile .band-listening-panel .top-tracks-card');
    if (!card) return;
    const { selected, items } = rankedItems();
    const albums = detailList === 'albums';
    const signature = `${activeProfileBandId}|${profileListeningTimeframe}|${detailList}|${items.map((item) => `${item.rank}:${item.recordingKey || item.releaseKey || item.releaseTitle || item.recordingTitle}:${item.listenCount}:${item.durationMs}:${item.artworkPath || ''}`).join('|')}|${ListeningStats.hasUnknownDuration(selected)}`;
    if (card.dataset.v81RankSignature === signature && card.querySelector('.ranked-list-tabs')) return;
    card.dataset.v81RankSignature = signature;

    let tabs = card.querySelector('.ranked-list-tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'ranked-list-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Band listening rankings');
      card.prepend(tabs);
    }
    tabs.innerHTML = `<button type="button" role="tab" data-v81-ranked="tracks" aria-selected="${!albums}" class="ranked-list-tab${!albums ? ' active' : ''}">Top Tracks</button><button type="button" role="tab" data-v81-ranked="albums" aria-selected="${albums}" class="ranked-list-tab${albums ? ' active' : ''}">Top Albums</button>`;
    const rows = items.length
      ? items.map((item) => `<div class="top-track-row"><span class="top-track-rank">#${item.rank}</span>${artwork(item, albums)}<span class="top-track-copy"><strong>${escapeHtml(albums ? item.releaseTitle : item.recordingTitle)}</strong><small>${countText(item.listenCount)} · ${durationText(item)}</small></span></div>`).join('')
      : `<p class="listening-empty">${albums ? 'No album data available for this period.' : 'No tracks in this period.'}</p>`;
    const title = card.querySelector('.listening-section-title');
    if (title) title.textContent = `${albums ? 'TOP ALBUMS' : 'TOP TRACKS'} · ${globalListeningStats(profileListeningTimeframe).label.toUpperCase()}`;
    const list = card.querySelector('.top-tracks-list');
    if (list) list.innerHTML = rows;
    let knownNote = card.querySelector('.listening-known-time-note');
    if (ListeningStats.hasUnknownDuration(selected) && !knownNote) {
      knownNote = document.createElement('p');
      knownNote.className = 'listening-known-time-note';
      knownNote.textContent = 'Listening time is based on listens with known duration.';
      card.append(knownNote);
    } else if (!ListeningStats.hasUnknownDuration(selected) && knownNote) {
      knownNote.remove();
    }
    wireListeningImages(card);
  }

  function applyTwoWeekStartCard() {
    const card = document.querySelector('.start-top-bands-card');
    if (!card || card.textContent.includes('YOUR TOP BANDS · 2 WEEKS')) return;
    const stats = globalListeningStats('twoWeeks');
    card.outerHTML = `<section class="listening-card start-top-bands-card" aria-labelledby="start-top-bands-title"><div class="listening-card-heading"><p id="start-top-bands-title">YOUR TOP BANDS · 2 WEEKS</p><button type="button" id="start-top-bands-view-all" class="listening-link">View all</button></div><div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 3), { compact: true, timeframe: 'twoWeeks' })}</div>${ListeningStats.hasUnknownDuration(stats.listens) ? '<p class="listening-known-time-note">Listening time is based on listens with known duration.</p>' : ''}<button type="button" id="start-listening-stats" class="listening-card-footer">See your listening stats${icon('chevronRight')}</button></section>`;
    const replacement = document.querySelector('.start-top-bands-card');
    replacement?.querySelector('#start-top-bands-view-all')?.addEventListener('click', () => openTopBandsScreen());
    replacement?.querySelector('#start-listening-stats')?.addEventListener('click', () => openStatsScreen({ subTab: 'listening' }));
    wireListeningBandRows(replacement);
    wireListeningImages(replacement);
  }

  document.addEventListener('click', (event) => {
    const ranked = event.target.closest('[data-v81-ranked]');
    if (!ranked) return;
    detailList = ranked.dataset.v81Ranked === 'albums' ? 'albums' : 'tracks';
    applyRankedTabs();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const startScreen = document.getElementById('screen-myconcerts');
    const profileScreen = document.getElementById('screen-profile');
    if (startScreen) {
      new MutationObserver(applyTwoWeekStartCard).observe(startScreen, { childList: true, subtree: true });
      applyTwoWeekStartCard();
    }
    if (profileScreen) {
      new MutationObserver(() => {
        const card = profileScreen.querySelector('.band-listening-panel .top-tracks-card');
        if (card && !card.querySelector('.ranked-list-tabs')) applyRankedTabs();
      }).observe(profileScreen, { childList: true, subtree: true });
      applyRankedTabs();
    }
  });
})();
