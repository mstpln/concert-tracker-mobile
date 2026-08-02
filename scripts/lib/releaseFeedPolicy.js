'use strict';

// The visible Releases feed is intentionally narrower than the legacy
// news.json container. A retained item must point to an actual Spotify
// release. Concert alerts are derived from concerts.json and therefore do
// not belong in this file, while general articles and advance web
// announcements are deliberately discarded by the one-time cleanup.
function trustedSpotifyReleaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const parts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && url.hostname === 'open.spotify.com'
      && parts.length === 2
      && parts[0] === 'album'
      && /^[A-Za-z0-9]+$/.test(parts[1])
      ? url.href
      : null;
  } catch (_) {
    return null;
  }
}

function isSpotifyReleaseItem(item) {
  if (!item || item.category !== 'album') return false;
  if (!/^[A-Za-z0-9]+$/.test(String(item.spotifyReleaseId || ''))) return false;
  if (!trustedSpotifyReleaseUrl(item.spotifyUrl || item.sourceUrl)) return false;
  const type = item.releaseType || item.type || null;
  return !type || type === 'Album' || type === 'Single';
}

function cleanupReleaseFeed(items) {
  const source = Array.isArray(items) ? items : [];
  const kept = [];
  const removed = [];
  for (const item of source) {
    (isSpotifyReleaseItem(item) ? kept : removed).push(item);
  }
  const removedByCategory = {};
  const removedByStage = {};
  for (const item of removed) {
    const category = item?.category || 'unknown';
    const stage = item?.lifecycleStage || 'none';
    removedByCategory[category] = (removedByCategory[category] || 0) + 1;
    removedByStage[stage] = (removedByStage[stage] || 0) + 1;
  }
  return {
    kept,
    removed,
    summary: {
      before: source.length,
      after: kept.length,
      removed: removed.length,
      removedByCategory,
      removedByStage,
    },
  };
}

module.exports = { trustedSpotifyReleaseUrl, isSpotifyReleaseItem, cleanupReleaseFeed };
