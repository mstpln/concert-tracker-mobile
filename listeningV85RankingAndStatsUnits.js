'use strict';

(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  if (!api) return;

  const normalize = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');

  function listenRankSort(titleKey) {
    return (a, b) => b.listenCount - a.listenCount
      || b.durationMs - a.durationMs
      || b.lastListenedMs - a.lastListenedMs
      || normalize(a[titleKey]).localeCompare(normalize(b[titleKey]));
  }

  function aggregateByListens(listens, kind, limit = 10) {
    const grouped = new Map();
    for (const listen of listens || []) {
      if (!api.isValidListen(listen)) continue;
      const title = kind === 'album'
        ? String(listen?.releaseTitle || '').trim().replace(/\s+/g, ' ')
        : String(listen?.recordingTitle || '').trim();
      if (!title) continue;
      const stable = kind === 'track' && (listen.musicbrainzRecordingId || listen.stableRecordingId);
      const key = stable
        ? `stable:${stable}`
        : `${normalize(listen.artistCreditName)}|${normalize(title)}${kind === 'track' ? `|${normalize(listen.releaseTitle)}` : ''}`;
      const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
      const item = grouped.get(key) || {
        [titleKey]: title,
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        localBandId: listen.localBandId || null,
        durationMs: 0,
        listenCount: 0,
        lastListenedMs: 0,
        artworkPath: null,
      };
      const durationMs = api.validDurationMs(listen);
      const listenedAtMs = api.listenTimeMs(listen);
      item.durationMs += Number.isFinite(durationMs) ? durationMs : 0;
      item.listenCount += 1;
      if (Number.isFinite(listenedAtMs)) item.lastListenedMs = Math.max(item.lastListenedMs, listenedAtMs);
      if (kind === 'track' && !item.artworkPath && listen.artworkPath) item.artworkPath = listen.artworkPath;
      if (kind === 'album' && !item.artworkPath && listen.artworkPath && (
        listen.spotifyAlbumId || listen.spotifyTrackId || listen.musicbrainzReleaseId
        || listen.musicbrainzReleaseGroupId || listen.stableReleaseId
      )) item.artworkPath = listen.artworkPath;
      grouped.set(key, item);
    }
    const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
    return [...grouped.values()]
      .sort(listenRankSort(titleKey))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  api.topTracks = (listens, limit = 10) => aggregateByListens(listens, 'track', limit);
  api.topAlbums = (listens, limit = 10) => aggregateByListens(listens, 'album', limit);

  function updateConcertStatUnits(root = document) {
    const items = root.querySelectorAll?.('.stats-teaser-item') || [];
    items.forEach((item) => {
      const value = item.querySelector('.stats-teaser-value');
      const label = item.querySelector('.stats-teaser-label');
      if (!value || !label) return;
      const labelText = label.textContent.trim().toLowerCase();
      if (labelText === 'traveled' || labelText === 'traveled (km)') {
        value.textContent = value.textContent.replace(/\s*km\s*$/i, '').trim();
        label.textContent = 'traveled (km)';
      } else if (labelText === 'spent' || labelText === 'spent (kr)') {
        value.textContent = value.textContent.replace(/\s*kr\s*$/i, '').trim();
        label.textContent = 'spent (kr)';
      }
    });
  }

  if (typeof document !== 'undefined') {
    const apply = () => updateConcertStatUnits(document);
    apply();
    document.addEventListener('DOMContentLoaded', apply);
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.ListeningV85RankingAndStatsUnits = { aggregateByListens, updateConcertStatUnits };
})();

if (typeof module === 'object' && module.exports) {
  module.exports = globalThis.ListeningV85RankingAndStatsUnits;
}
