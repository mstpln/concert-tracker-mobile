'use strict';

const config = require('./config');
const { normalize } = require('./nonPlaylistTrackLinks');

function spotifyUrlFromRelations(relations) {
  const urls = [...new Set((relations || []).map((r) => r?.url?.resource || r?.target || '').filter((url) => /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+\/?$/i.test(url)))];
  return urls.length === 1 ? urls[0].replace(/\/$/, '') : null;
}

async function request(path, params, usage, fetchImpl = fetch) {
  if (!usage?.canCallMusicbrainz?.()) return { kind: 'skipped' };
  await usage.recordMusicbrainzAttempt();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.MUSICBRAINZ.timeoutMs);
  try {
    const url = new URL(`${config.MUSICBRAINZ.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params || {})) if (value != null) url.searchParams.set(key, String(value));
    url.searchParams.set('fmt', 'json');
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': config.MUSICBRAINZ.userAgent }, signal: controller.signal });
    if (!res.ok) return { kind: 'error', status: res.status };
    return { kind: 'ok', data: await res.json() };
  } catch (error) { return { kind: 'error', error: error?.name === 'AbortError' ? 'timeout' : 'request_failed' }; }
  finally { clearTimeout(timer); }
}

async function resolveTrackUrl({ artistMbid, recordingTitle, recordingMbid = null, usage, fetchImpl = fetch } = {}) {
  let mbid = recordingMbid;
  if (!mbid) {
    const title = String(recordingTitle || '').trim(); if (!artistMbid || !title) return { kind: 'no_match' };
    const escaped = title.replace(/([+\-!(){}\[\]^"~*?:\\/&|])/g, '\\$1');
    const found = await request('/recording', { query: `arid:${artistMbid} AND recording:"${escaped}"`, limit: 5 }, usage, fetchImpl);
    if (found.kind !== 'ok') return found;
    const exact = (found.data?.recordings || []).filter((row) => row?.id && normalize(row.title) === normalize(title));
    const ids = [...new Set(exact.map((row) => row.id))];
    if (ids.length !== 1) return { kind: 'no_match' };
    mbid = ids[0];
  }
  const detail = await request(`/recording/${encodeURIComponent(mbid)}`, { inc: 'url-rels' }, usage, fetchImpl);
  if (detail.kind !== 'ok') return detail;
  const url = spotifyUrlFromRelations(detail.data?.relations);
  return url ? { kind: 'ok', url, source: 'musicbrainz_recording_relation' } : { kind: 'no_match' };
}

module.exports = { spotifyUrlFromRelations, resolveTrackUrl };
