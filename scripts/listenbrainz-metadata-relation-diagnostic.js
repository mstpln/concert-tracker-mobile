'use strict';

const fs = require('node:fs');
const { createListeningMaintenanceUsageGate } = require('./lib/listeningMaintenanceUsage');

const TEST_MBIDS = [
  'ada7a83c-e3e1-40f1-93f9-3e73dbc9298a',
  '63011a8d-0117-4f7e-9991-1ef1f337ff70',
];

function relationHosts(rels) {
  const hosts = {};
  if (!rels || typeof rels !== 'object' || Array.isArray(rels)) return hosts;
  for (const value of Object.values(rels)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== 'string') continue;
      try {
        const url = new URL(item);
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        hosts[url.hostname] = (hosts[url.hostname] || 0) + 1;
      } catch {}
    }
  }
  return hosts;
}

function hasSpotifyArtistUrl(rels) {
  if (!rels || typeof rels !== 'object') return false;
  return Object.values(rels).flatMap((value) => Array.isArray(value) ? value : [value]).some((value) => {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && /^\/artist\/[A-Za-z0-9]+\/?$/.test(url.pathname);
    } catch { return false; }
  });
}

async function main() {
  const gate = createListeningMaintenanceUsageGate({ state: {} });
  if (!await gate.reserve('listenbrainz')) throw new Error('ListenBrainz diagnostic call blocked.');
  const url = new URL('https://api.listenbrainz.org/1/metadata/artist/');
  url.searchParams.set('artist_mbids', TEST_MBIDS.join(','));
  url.searchParams.set('inc', 'artist tag');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ListenBrainz diagnostic returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('ListenBrainz diagnostic returned an unexpected shape.');
  const rows = payload.map((artist, index) => ({
    testOrdinal: index + 1,
    hasRels: !!artist?.rels && typeof artist.rels === 'object' && Object.keys(artist.rels).length > 0,
    hasSpotifyArtistUrl: hasSpotifyArtistUrl(artist?.rels),
    relationHosts: relationHosts(artist?.rels),
  }));
  const output = {
    kind: 'livevault-listenbrainz-metadata-relation-diagnostic',
    schemaVersion: 1,
    testedArtists: TEST_MBIDS.length,
    listenbrainzCalls: gate.state.listenbrainzCallsThisRun,
    spotifyApiCalls: 0,
    rows,
  };
  fs.mkdirSync('.audit', { recursive: true });
  fs.writeFileSync('.audit/listenbrainz-metadata-relation-diagnostic.json', `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
}

main().catch((error) => { console.error(`Diagnostic failed safely: ${error.message}`); process.exitCode = 1; });
