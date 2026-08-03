// Cloudflare Worker — deploy manually after the matching app release is
// merged and explicitly approved. It serves four authenticated JSON files,
// private listening-vault objects and private authenticated ticket PDFs from
// the same private R2 bucket.

const ALLOWED_FILES = new Set(['bands.json', 'concerts.json', 'news.json', 'apiUsage.json']);
const JSON_ROOT_TYPES = {
  'bands.json': 'array',
  'concerts.json': 'array',
  'news.json': 'array',
  'apiUsage.json': 'object',
};
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_LISTENING_MANIFEST_BYTES = 1024 * 1024;
const MAX_LISTENING_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_TICKET_PDF_BYTES = 10 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LISTENING_MANIFEST_PATH = 'listening/manifest.json';
const LISTENING_ARCHIVE_PATTERN = /^listening\/spotify-history\/([a-f0-9]{64})\.json\.gz$/;

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

function authorizationRole(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  if (env.BROWSER_TOKEN && token === env.BROWSER_TOKEN) return 'browser';
  if (env.AUTOMATION_TOKEN && token === env.AUTOMATION_TOKEN) return 'automation';
  if (env.API_TOKEN && token === env.API_TOKEN) return 'legacy';
  return null;
}

function isReadOnlyAuthorized(request, env) {
  const token = bearerToken(request);
  return !!token && (
    !!authorizationRole(request, env) ||
    (!!env.READ_ONLY_TOKEN && token === env.READ_ONLY_TOKEN)
  );
}

function jsonRootIsValid(filename, value) {
  const expected = JSON_ROOT_TYPES[filename];
  if (expected === 'array') return Array.isArray(value);
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function listeningManifestIsValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.kind !== 'livevault-listening-vault' || value.schemaVersion !== 1) return false;
  const archive = value.archive;
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) return false;
  if (archive.source !== 'spotify_import') return false;
  if (!LISTENING_ARCHIVE_PATTERN.test(String(archive.path || ''))) return false;
  if (!/^[a-f0-9]{64}$/.test(String(archive.sha256 || ''))) return false;
  if (!Number.isInteger(archive.eventCount) || archive.eventCount < 0 || archive.eventCount > 10000000) return false;
  if (archive.contentEncoding !== 'gzip') return false;
  return true;
}

function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 && code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

async function readBoundedText(request, maxBytes) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { tooLarge: true };
  const text = await request.text();
  return utf8ByteLength(text) > maxBytes ? { tooLarge: true } : { text };
}

async function readBoundedBytes(request, maxBytes) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { tooLarge: true };
  const bytes = await request.arrayBuffer();
  return bytes.byteLength > maxBytes ? { tooLarge: true } : { bytes };
}

function objectEtag(object) {
  if (!object) return null;
  if (object.httpEtag) return object.httpEtag;
  return object.etag ? `"${String(object.etag).replace(/^"|"$/g, '')}"` : null;
}

function bareEtag(value) {
  return String(value || '').trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

function writeCondition(request) {
  const ifMatch = request.headers.get('If-Match');
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifMatch) return { etagMatches: bareEtag(ifMatch) };
  if (ifNoneMatch === '*') return { etagDoesNotMatch: '*' };
  return null;
}

async function requiredWriteCondition(request, env, key) {
  let condition = writeCondition(request);
  if (condition) return condition;
  const existing = typeof env.BUCKET.head === 'function'
    ? await env.BUCKET.head(key)
    : await env.BUCKET.get(key);
  return existing ? null : { etagDoesNotMatch: '*' };
}

async function qaSmoke(env) {
  const expected = { 'bands.json': 'array', 'concerts.json': 'array', 'news.json': 'array', 'apiUsage.json': 'object' };
  const files = {};
  let healthy = true;
  for (const [filename, type] of Object.entries(expected)) {
    try {
      const object = await env.BUCKET.get(filename);
      if (!object) { files[filename] = { ok: false, reason: 'missing' }; healthy = false; continue; }
      const value = JSON.parse(await object.text());
      const valid = type === 'array' ? Array.isArray(value) : !!value && typeof value === 'object' && !Array.isArray(value);
      files[filename] = { ok: valid, type, count: Array.isArray(value) ? value.length : null };
      if (!valid) healthy = false;
    } catch {
      files[filename] = { ok: false, reason: 'invalid' };
      healthy = false;
    }
  }
  return response(JSON.stringify({ ok: healthy, files }), {
    status: healthy ? 200 : 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function ticketRoute(pathname) {
  const match = pathname.match(/^\/ticket-files\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.pdf$/);
  return match && SAFE_ID.test(match[1]) && SAFE_ID.test(match[2]) ? { concertId: match[1], ticketId: match[2] } : null;
}

function listeningRoute(pathname) {
  const key = pathname.replace(/^\//, '');
  if (key === LISTENING_MANIFEST_PATH) return { kind: 'manifest', key };
  if (LISTENING_ARCHIVE_PATTERN.test(key)) return { kind: 'archive', key };
  return null;
}

async function handleTicketFile(request, env, route) {
  const key = `ticket-files/${route.concertId}/${route.ticketId}.pdf`;
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(key);
    if (!object) return response('Not found', { status: 404 });
    return response(object.body, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline' },
    });
  }
  if (request.method === 'DELETE') {
    await env.BUCKET.delete(key);
    return response('OK');
  }
  if (request.method !== 'PUT') return response('Method not allowed', { status: 405 });
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    return response('PDF content required', { status: 400 });
  }
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TICKET_PDF_BYTES) {
    return response('PDF exceeds 10 MB', { status: 413 });
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return response('PDF cannot be empty', { status: 400 });
  if (bytes.byteLength > MAX_TICKET_PDF_BYTES) return response('PDF exceeds 10 MB', { status: 413 });
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== '%PDF-') return response('Invalid PDF', { status: 400 });
  await env.BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf', contentDisposition: 'inline', cacheControl: 'private, no-store' },
  });
  return response('OK');
}

async function handleJsonFile(request, env, filename) {
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(filename);
    if (!object) return response('Not found', { status: 404 });
    const etag = objectEtag(object);
    return response(object.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(etag ? { ETag: etag } : {}),
      },
    });
  }
  if (request.method !== 'PUT') return response('Method not allowed', { status: 405 });

  const condition = await requiredWriteCondition(request, env, filename);
  if (!condition) return response('Precondition required', { status: 428 });

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return response('JSON content required', { status: 415 });

  const body = await readBoundedText(request, MAX_JSON_BYTES);
  if (body.tooLarge) return response('JSON exceeds 10 MB', { status: 413 });

  let parsed;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return response('Invalid JSON', { status: 400 });
  }
  if (!jsonRootIsValid(filename, parsed)) return response('Invalid JSON document type', { status: 400 });

  const stored = await env.BUCKET.put(filename, body.text, {
    onlyIf: condition,
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' },
  });
  if (stored === null) return response('Document changed; reread and retry', { status: 412 });
  const etag = objectEtag(stored);
  return response('OK', { headers: etag ? { ETag: etag } : {} });
}

async function handleListeningObject(request, env, route) {
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(route.key);
    if (!object) return response('Not found', { status: 404 });
    const etag = objectEtag(object);
    return response(object.body, {
      headers: {
        'Content-Type': route.kind === 'manifest' ? 'application/json; charset=utf-8' : 'application/gzip',
        ...(etag ? { ETag: etag } : {}),
      },
    });
  }
  if (request.method !== 'PUT') return response('Method not allowed', { status: 405 });

  const condition = await requiredWriteCondition(request, env, route.key);
  if (!condition) return response('Precondition required', { status: 428 });
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();

  if (route.kind === 'manifest') {
    if (contentType !== 'application/json') return response('JSON content required', { status: 415 });
    const body = await readBoundedText(request, MAX_LISTENING_MANIFEST_BYTES);
    if (body.tooLarge) return response('Listening manifest exceeds 1 MB', { status: 413 });
    let parsed;
    try { parsed = JSON.parse(body.text); }
    catch { return response('Invalid JSON', { status: 400 }); }
    if (!listeningManifestIsValid(parsed)) return response('Invalid listening manifest', { status: 400 });
    const stored = await env.BUCKET.put(route.key, body.text, {
      onlyIf: condition,
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' },
    });
    if (stored === null) return response('Document changed; reread and retry', { status: 412 });
    const etag = objectEtag(stored);
    return response('OK', { headers: etag ? { ETag: etag } : {} });
  }

  if (contentType !== 'application/gzip' && contentType !== 'application/octet-stream') {
    return response('Gzip content required', { status: 415 });
  }
  const body = await readBoundedBytes(request, MAX_LISTENING_ARCHIVE_BYTES);
  if (body.tooLarge) return response('Listening archive exceeds 100 MB', { status: 413 });
  const bytes = new Uint8Array(body.bytes);
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return response('Invalid gzip archive', { status: 400 });
  const stored = await env.BUCKET.put(route.key, body.bytes, {
    onlyIf: condition,
    httpMetadata: { contentType: 'application/gzip', cacheControl: 'private, no-store' },
  });
  if (stored === null) return response('Archive already exists or changed', { status: 412 });
  const etag = objectEtag(stored);
  return response('OK', { headers: etag ? { ETag: etag } : {} });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: response(null).headers });

    const url = new URL(request.url);
    if (url.pathname === '/qa-smoke') {
      if (request.method !== 'GET') return response('Method not allowed', { status: 405 });
      if (!isReadOnlyAuthorized(request, env)) return response('Unauthorized', { status: 401 });
      return qaSmoke(env);
    }

    const ticket = ticketRoute(url.pathname);
    const listening = listeningRoute(url.pathname);
    const filename = url.pathname.replace(/^\//, '');
    if (!ticket && !listening && !ALLOWED_FILES.has(filename)) return response('Not found', { status: 404 });

    const role = authorizationRole(request, env);
    if (!role) return response('Unauthorized', { status: 401 });
    if (ticket && role === 'automation') return response('Forbidden', { status: 403 });
    if (listening && role !== 'browser' && role !== 'legacy') return response('Forbidden', { status: 403 });
    if (ticket) return handleTicketFile(request, env, ticket);
    if (listening) return handleListeningObject(request, env, listening);
    return handleJsonFile(request, env, filename);
  },
};