'use strict';

(function attachToplistStats(root, factory) {
  const api = factory(root?.ListeningStats);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ToplistStatsV96 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (ListeningStatsApi) => {
  const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const timeMs = (listen) => ListeningStatsApi?.listenTimeMs ? ListeningStatsApi.listenTimeMs(listen) : new Date(listen?.listenedAt).getTime();
  const durationMs = (listen) => ListeningStatsApi?.validDurationMs ? ListeningStatsApi.validDurationMs(listen) : Math.max(0, Number(listen?.listenedDurationMs) || 0);
  const valid = (listen) => ListeningStatsApi?.isValidListen ? ListeningStatsApi.isValidListen(listen) : Number.isFinite(timeMs(listen));

  function trustedRecordingIdentity(listen) {
    if (listen?.musicbrainzRecordingId) return `mbid:${listen.musicbrainzRecordingId}`;
    if (listen?.stableRecordingId) return `recording:${listen.stableRecordingId}`;
    if (listen?.spotifyTrackId) return `spotify:${listen.spotifyTrackId}`;
    return null;
  }

  function eventIdentity(listen, index) {
    const stableEvent = listen?.id || listen?.eventId || listen?.listenId;
    if (stableEvent) return `event:${stableEvent}`;
    return `event:${timeMs(listen)}:${index}`;
  }

  function rankTracks(listens, limit = 100) {
    const grouped = new Map();
    (listens || []).forEach((listen, index) => {
      if (!valid(listen) || !String(listen?.recordingTitle || '').trim()) return;
      const trustedKey = trustedRecordingIdentity(listen);
      const recordingKey = trustedKey || eventIdentity(listen, index);
      const item = grouped.get(recordingKey) || {
        recordingKey,
        trustedIdentity: !!trustedKey,
        recordingTitle: String(listen.recordingTitle).trim(),
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        releaseTitle: listen.releaseTitle || null,
        localBandId: listen.localBandId || null,
        artworkPath: listen.artworkPath || null,
        listenCount: 0,
        durationMs: 0,
        lastListenedMs: 0,
      };
      item.listenCount += 1;
      item.durationMs += durationMs(listen);
      item.lastListenedMs = Math.max(item.lastListenedMs, timeMs(listen));
      if (!item.artworkPath && listen.artworkPath) item.artworkPath = listen.artworkPath;
      grouped.set(recordingKey, item);
    });
    return [...grouped.values()]
      .sort((a, b) => b.listenCount - a.listenCount || b.durationMs - a.durationMs || b.lastListenedMs - a.lastListenedMs || normalize(a.recordingTitle).localeCompare(normalize(b.recordingTitle)))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function withMovement(current, previous, timeframe) {
    const previousRanks = new Map((previous || []).filter((item) => item.trustedIdentity).map((item, index) => [item.recordingKey, item.rank || index + 1]));
    return (current || []).map((item, index) => {
      if (timeframe === 'allTime' || !item.trustedIdentity) return { ...item, movement: null };
      const rank = item.rank || index + 1;
      const previousRank = previousRanks.get(item.recordingKey);
      if (!previousRank) return { ...item, movement: { kind: 'new', delta: null, label: 'New' } };
      const delta = previousRank - rank;
      if (delta > 0) return { ...item, movement: { kind: 'up', delta, label: `Up ${delta}` } };
      if (delta < 0) return { ...item, movement: { kind: 'down', delta: Math.abs(delta), label: `Down ${Math.abs(delta)}` } };
      return { ...item, movement: null };
    });
  }

  return { trustedRecordingIdentity, rankTracks, withMovement };
});
