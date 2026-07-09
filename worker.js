// Cloudflare Worker — paste this into your Worker's editor (Cloudflare
// dashboard > Workers & Pages > your worker > Edit code) and deploy.
//
// It needs two things configured on the Worker, both explained in SETUP.md:
//   1. An R2 bucket binding named BUCKET (Settings > Bindings > R2 Bucket).
//   2. A secret environment variable named API_TOKEN (Settings > Variables
//      and Secrets > Add > Secret) — this is the token you'll also paste
//      into the app itself when connecting.
//
// It only ever serves two fixed files — bands.json and concerts.json — and
// refuses everything else. GET reads a file; PUT overwrites it. Both
// require the Authorization: Bearer <API_TOKEN> header.

const ALLOWED_FILES = new Set(['bands.json', 'concerts.json']);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const filename = url.pathname.replace(/^\//, '');

    if (!ALLOWED_FILES.has(filename)) {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!env.API_TOKEN || token !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders() });
    }

    if (request.method === 'GET') {
      const object = await env.BUCKET.get(filename);
      if (!object) {
        return new Response('Not found', { status: 404, headers: corsHeaders() });
      }
      return new Response(object.body, {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      try {
        JSON.parse(text); // reject anything that isn't valid JSON before it overwrites your data
      } catch {
        return new Response('Invalid JSON', { status: 400, headers: corsHeaders() });
      }
      await env.BUCKET.put(filename, text, {
        httpMetadata: { contentType: 'application/json' },
      });
      return new Response('OK', { headers: corsHeaders() });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
  },
};
