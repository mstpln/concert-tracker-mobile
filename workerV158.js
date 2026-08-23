import baseWorker from './worker.js';

const VENUE_FILE = 'venues.json';
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const SAFE_VENUE_ID = /^venue-[a-f0-9]{8}$/;
const VENUE_RESEARCH_STATUSES = new Set(['complete', 'partial', 'unresolved', 'temporary_error', 'review_needed']);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
  };
}

function response(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      ...corsHeaders(),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...(init.headers || {}),
    },
  });
}

function bearerToken(request) {
  return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
}

function credentialRole(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const entries = [
    ['browser', env.BROWSER_TOKEN],
    ['automation', env.AUTOMATION_TOKEN],
    ['data-maintenance', env.DATA_MAINTENANCE_TOKEN],
    ['legacy', env.API_TOKEN],
    ['read-only', env.READ_ONLY_TOKEN],
  ].filter(([, value]) => value && token === value);
  return entries.length === 1 ? entries[0][0] : null;
}

function safeHttpsUrl(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function addressIsValid(address) {
  if (address == null) return true;
  if (typeof address === 'string') return !!address.trim() && address.length <= 1000;
  if (!address || typeof address !== 'object' || Array.isArray(address)) return false;
  const values = Object.values(address);
  return values.length <= 16 && values.every((value) => value == null || typeof value === 'string');
}

function venueRecordIsValid(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (!SAFE_VENUE_ID.test(String(record.venueId || ''))) return false;
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 300) return false;
  if (typeof record.city !== 'string' || !record.city.trim() || record.city.length > 300) return false;
  if (record.country != null && (typeof record.country !== 'string' || record.country.length > 200)) return false;
  if (!addressIsValid(record.address)) return false;
  if (record.maxCapacity != null && (!Number.isSafeInteger(record.maxCapacity) || record.maxCapacity <= 0 || record.maxCapacity > 10000000)) return false;
  if (!safeHttpsUrl(record.officialUrl)) return false;
  if (record.description != null && (typeof record.description !== 'string' || !record.description.trim() || record.description.length > 900)) return false;
  if (record.researchStatus != null && !VENUE_RESEARCH_STATUSES.has(record.researchStatus)) return false;
  if (record.researchedAt != null && (typeof record.researchedAt !== 'string' || !Number.isFinite(Date.parse(record.researchedAt)))) return false;
  if (record.sources != null && (!Array.isArray(record.sources) || record.sources.length > 16 || record.sources.some((url) => !safeHttpsUrl(url)))) return false;
  if (record.schemaVersion != null && record.schemaVersion !== 1) return false;
  return true;
}

function venueDocumentIsValid(value) {
  if (!Array.isArray(value) || value.length > 10000) return false;
  const ids = new Set();
  for (const record of value) {
    if (!venueRecordIsValid(record) || ids.has(record.venueId)) return false;
    ids.add(record.venueId);
  }
  return true;
}

function objectEtag(object) {
  if (!object) return null;
  if (object.httpEtag) return object.httpEtag;
  return object.etag ? `"${String(object.etag).replace(/^"|"$/g, '')}"` : null;
}

function bareEtag(value) {
  return String(value || '').trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

async function bodyTextWithinLimit(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).byteLength <= MAX_JSON_BYTES ? text : null;
}

async function requiredWriteCondition(request, env) {
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch) return { etagMatches: bareEtag(ifMatch) };
  if (request.headers.get('If-None-Match') === '*') return { etagDoesNotMatch: '*' };
  const existing = typeof env.BUCKET.head === 'function' ? await env.BUCKET.head(VENUE_FILE) : await env.BUCKET.get(VENUE_FILE);
  return existing ? null : { etagDoesNotMatch: '*' };
}

async function handleVenueFile(request, env, role) {
  if (!role) return response('Unauthorized', { status: 401 });
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(VENUE_FILE);
    if (!object) return response('Not found', { status: 404 });
    const etag = objectEtag(object);
    return response(object.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...(etag ? { ETag: etag } : {}) } });
  }
  // v158 deliberately keeps scheduled automation read-only for venue metadata.
  // The first population is a separately authorized data-maintenance backfill.
  if (request.method !== 'PUT') return response('Method not allowed', { status: 405 });
  if (role !== 'data-maintenance') return response('Forbidden', { status: 403 });

  const condition = await requiredWriteCondition(request, env);
  if (!condition) return response('Precondition required', { status: 428 });
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return response('JSON content required', { status: 415 });
  const text = await bodyTextWithinLimit(request);
  if (text == null) return response('JSON exceeds 10 MB', { status: 413 });
  let parsed;
  try { parsed = JSON.parse(text); } catch { return response('Invalid JSON', { status: 400 }); }
  if (!venueDocumentIsValid(parsed)) return response('Invalid venue metadata document', { status: 400 });
  const stored = await env.BUCKET.put(VENUE_FILE, text, {
    onlyIf: condition,
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' },
  });
  if (stored === null) return response('Document changed; reread and retry', { status: 412 });
  const etag = objectEtag(stored);
  return response('OK', { headers: etag ? { ETag: etag } : {} });
}

export { venueRecordIsValid, venueDocumentIsValid };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== `/${VENUE_FILE}`) return baseWorker.fetch(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: response(null).headers });
    return handleVenueFile(request, env, credentialRole(request, env));
  },
};
