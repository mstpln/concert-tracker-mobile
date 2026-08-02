// Cloudflare Worker — deploy manually after the matching app release is
// merged and explicitly approved. It serves four authenticated JSON files
// plus private authenticated ticket PDFs from the same private R2 bucket.

const ALLOWED_FILES = new Set(['bands.json', 'concerts.json', 'news.json', 'apiUsage.json']);
const JSON_ROOT_TYPES = {
  'bands.json': 'array',
  'concerts.json': 'array',
  'news.json': 'array',
  'apiUsage.json': 'object',
};
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_TICKET_PDF_BYTES = 10 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

function objectEtag(object) {
  if (!object) return null;
  if (object.httpEtag) return object.httpEtag;
  return object.etag ? `"${String(object.etag).replace(/^"|"$/g, '')}"` : null;
}

function emptyHeaders() {
  return new Request('https://livevault.invalid').headers;
}

function writeCondition(request) {
  const ifMatch = request.headers.get('If-Match');
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (!ifMatch && !ifNoneMatch) return null;
  const headers = emptyHeaders();
  if (ifMatch) headers.set('If-Match', ifMatch);
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch);
  return headers;
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

  let condition = writeCondition(request);
  if (!condition) {
    const existing = typeof env.BUCKET.head === 'function'
      ? await env.BUCKET.head(filename)
      : await env.BUCKET.get(filename);
    if (existing) return response('Precondition required', { status: 428 });
    condition = emptyHeaders();
    condition.set('If-None-Match', '*');
  }

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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: response(null).headers });

    const url = new URL(request.url);
    if (url.pathname === '/qa-smoke') {
      if (request.method !== 'GET') return response('Method not allowed', { status: 405 });
      if (!isReadOnlyAuthorized(request, env)) return response('Unauthorized', { status: 401 });
      return qaSmoke(env);
    }

    const route = ticketRoute(url.pathname);
    const filename = url.pathname.replace(/^\//, '');
    if (!route && !ALLOWED_FILES.has(filename)) return response('Not found', { status: 404 });

    const role = authorizationRole(request, env);
    if (!role) return response('Unauthorized', { status: 401 });
    if (route && role === 'automation') return response('Forbidden', { status: 403 });
    if (route) return handleTicketFile(request, env, route);
    return handleJsonFile(request, env, filename);
  },
};
