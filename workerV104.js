import baseWorker from './worker.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE = '/musicbrainz/release-context';
const MUSICBRAINZ_ROOT = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'BANDMARKR/104 (https://github.com/mstpln/concert-tracker-mobile)';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function reply(body, init = {}) {
  return new Response(body, { ...init, headers: { ...corsHeaders(), ...(init.headers || {}) } });
}

function browserAuthorized(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(token && env.BROWSER_TOKEN && token === env.BROWSER_TOKEN);
}

function safeUuid(value) {
  const text = String(value || '').trim().toLowerCase();
  return UUID.test(text) ? text : null;
}

async function releaseContext(request, env, fetchImpl = fetch) {
  if (request.method === 'OPTIONS') return reply(null, { status: 204 });
  if (request.method !== 'GET') return reply('Method not allowed', { status: 405 });
  if (!browserAuthorized(request, env)) return reply('Unauthorized', { status: 401 });

  const requestUrl = new URL(request.url);
  const releaseMbid = safeUuid(requestUrl.searchParams.get('release_mbid'));
  if (!releaseMbid) return reply('Invalid release MBID', { status: 400 });

  const upstream = new URL(`${MUSICBRAINZ_ROOT}/release/${encodeURIComponent(releaseMbid)}`);
  upstream.searchParams.set('inc', 'release-groups');
  upstream.searchParams.set('fmt', 'json');

  let response;
  try {
    response = await fetchImpl(upstream, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
  } catch (_) {
    return reply('MusicBrainz request failed', { status: 502 });
  }

  if (response.status === 404) return reply('Not found', { status: 404 });
  if (response.status === 503 || response.status === 429) return reply('MusicBrainz rate limited', { status: 503 });
  if (!response.ok) return reply('MusicBrainz request failed', { status: 502 });

  let payload;
  try { payload = await response.json(); } catch (_) { return reply('Invalid MusicBrainz response', { status: 502 }); }
  const returnedReleaseMbid = safeUuid(payload?.id);
  const releaseGroupMbid = safeUuid(payload?.['release-group']?.id || payload?.release_group?.id);
  if (returnedReleaseMbid !== releaseMbid || !releaseGroupMbid) return reply('Invalid MusicBrainz response', { status: 502 });

  return reply(JSON.stringify({
    releaseMbid,
    releaseTitle: typeof payload?.title === 'string' ? payload.title : null,
    releaseGroupMbid,
  }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === ROUTE) return releaseContext(request, env);
    return baseWorker.fetch(request, env, ctx);
  },
};

export { ROUTE, USER_AGENT, safeUuid, browserAuthorized, releaseContext };
