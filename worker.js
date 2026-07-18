// Cloudflare Worker — paste this into your Worker's editor (Cloudflare
// dashboard > Workers & Pages > your worker > Edit code) and deploy.
//
// It serves the fixed private JSON files below plus private, authenticated
// ticket PDFs. Ticket PDFs are stored in the same private R2 bucket; they are
// never public R2 URLs and every operation requires the same Bearer token.
// PDFs only: maximum 10 MB, application/pdf MIME type, and a real %PDF-
// signature. After merging this repository change, deploy this Worker code
// manually in Cloudflare before PDF upload/open/delete can work in production.

const ALLOWED_FILES = new Set(['bands.json', 'concerts.json', 'news.json', 'apiUsage.json']);
const MAX_TICKET_PDF_BYTES = 10 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

function response(body, init = {}) {
  return new Response(body, { ...init, headers: { ...corsHeaders(), ...(init.headers || {}) } });
}

function isAuthorized(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!env.API_TOKEN && token === env.API_TOKEN;
}

function isReadOnlyAuthorized(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!token && ((!!env.API_TOKEN && token === env.API_TOKEN) || (!!env.READ_ONLY_TOKEN && token === env.READ_ONLY_TOKEN));
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
    } catch { files[filename] = { ok: false, reason: 'invalid' }; healthy = false; }
  }
  return response(JSON.stringify({ ok: healthy, files }), { status: healthy ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
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
    return response(object.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store' } });
  }
  if (request.method === 'DELETE') {
    await env.BUCKET.delete(key);
    return response('OK', { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (request.method !== 'PUT') return response('Method not allowed', { status: 405 });
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    return response('PDF content required', { status: 400 });
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return response('PDF cannot be empty', { status: 400 });
  if (bytes.byteLength > MAX_TICKET_PDF_BYTES) return response('PDF exceeds 10 MB', { status: 413 });
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== '%PDF-') return response('Invalid PDF', { status: 400 });
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'application/pdf', contentDisposition: 'inline', cacheControl: 'private, no-store' } });
  return response('OK', { headers: { 'Cache-Control': 'private, no-store' } });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    if (url.pathname === '/qa-smoke') {
      if (request.method !== 'GET') return response('Method not allowed', { status: 405 });
      if (!isReadOnlyAuthorized(request, env)) return response('Unauthorized', { status: 401 });
      return qaSmoke(env);
    }
    const route = ticketRoute(url.pathname);
    const filename = url.pathname.replace(/^\//, '');
    if (!route && !ALLOWED_FILES.has(filename)) return response('Not found', { status: 404 });
    if (!isAuthorized(request, env)) return response('Unauthorized', { status: 401 });
    if (route) return handleTicketFile(request, env, route);

    if (request.method === 'GET') {
      const object = await env.BUCKET.get(filename);
      if (!object) return response('Not found', { status: 404 });
      return response(object.body, { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method === 'PUT') {
      const text = await request.text();
      try { JSON.parse(text); } catch { return response('Invalid JSON', { status: 400 }); }
      await env.BUCKET.put(filename, text, { httpMetadata: { contentType: 'application/json' } });
      return response('OK');
    }
    return response('Method not allowed', { status: 405 });
  },
};
