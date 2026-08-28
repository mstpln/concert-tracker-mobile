'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { createListeningMaintenanceUsageGate } = require('./lib/listeningMaintenanceUsage');

const TOP_SEED_COUNT = 10;
const RAW_CANDIDATE_LIMIT = 50;
const METADATA_BATCH_SIZE = 40;
const REQUEST_TIMEOUT_MS = 20_000;
const SIMILAR_ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPOTIFY_ARTIST_PATH_RE = /^\/artist\/[A-Za-z0-9]+\/?$/;

// Audit-only fallback identities for the two currently unresolved Top-10 seeds.
// Keys are SHA-256 prefixes of stable BANDMARKR band IDs; no names are logged or persisted.
// These identities were verified independently against official MusicBrainz pages before this audit.
const AUDIT_FALLBACK_MBIDS = new Map([
  ['ddfbb31e865c', '63011a8d-0117-4f7e-9991-1ef1f337ff70'],
  ['c536faf6d0c7', 'abbf7d85-9a7f-4a6c-80bd-bf71f2c7d520'],
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lowerMbid(value) {
  const text = clean(value).toLowerCase();
  return MBID_RE.test(text) ? text : null;
}
function normalizeName(value) {
  return clean(value).toLocaleLowerCase('en').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the\s+/u, '').replace(/\s+/g, ' ');
}
function bandHash(bandId) { return crypto.createHash('sha256').update(clean(bandId)).digest('hex').slice(0, 12); }
function trustedBandMbid(band) {
  const root = band?.musicbrainz;
  if (!root || !['auto_confirmed', 'manual_confirmed'].includes(root.status)) return null;
  return lowerMbid(root.mbid);
}
function seedMbid(band) {
  const trusted = trustedBandMbid(band);
  if (trusted) return { mbid: trusted, source: 'trusted' };
  const fallback = AUDIT_FALLBACK_MBIDS.get(bandHash(band?.id));
  return fallback ? { mbid: fallback, source: 'audit_fallback' } : { mbid: null, source: 'unresolved' };
}

function validateActivity(activity) {
  if (!activity || activity.kind !== 'livevault-listening-band-activity' || activity.schemaVersion !== 1 || !activity.records || typeof activity.records !== 'object' || Array.isArray(activity.records)) {
    throw new Error('Stored listening band activity is not a valid v1 aggregate.');
  }
  if (!Number.isFinite(Date.parse(activity.generatedAt || ''))) throw new Error('Stored listening band activity has an invalid generatedAt value.');
  return activity;
}

function selectTopSeeds(activity, bands) {
  validateActivity(activity);
  const byId = new Map((Array.isArray(bands) ? bands : []).filter((band) => clean(band?.id)).map((band) => [clean(band.id), band]));
  return Object.entries(activity.records)
    .map(([bandId, record]) => ({
      bandId,
      listenCount: Number(record?.buckets?.fourteenDays?.listenCount) || 0,
      recencyRank: Number.isInteger(record?.buckets?.fourteenDays?.recencyRank) ? record.buckets.fourteenDays.recencyRank : null,
      band: byId.get(bandId) || null,
    }))
    .filter((row) => row.listenCount > 0 && row.band)
    .sort((a, b) => (b.listenCount - a.listenCount) || ((a.recencyRank ?? Number.MAX_SAFE_INTEGER) - (b.recencyRank ?? Number.MAX_SAFE_INTEGER)) || a.bandId.localeCompare(b.bandId))
    .slice(0, TOP_SEED_COUNT)
    .map((row, index) => ({ ...row, ordinal: index + 1, ...seedMbid(row.band) }));
}

function followedIdentitySets(bands) {
  const mbids = new Set();
  const names = new Set();
  for (const band of Array.isArray(bands) ? bands : []) {
    const mbid = trustedBandMbid(band);
    if (mbid) mbids.add(mbid);
    const name = normalizeName(band?.name);
    if (name) names.add(name);
  }
  return { mbids, names };
}

function collectSimilarRows(value, output = [], order = { value: 0 }) {
  if (Array.isArray(value)) {
    for (const item of value) collectSimilarRows(item, output, order);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  const artistMbid = lowerMbid(value.artist_mbid ?? value.artistMbid);
  const referenceMbid = lowerMbid(value.reference_mbid ?? value.referenceMbid);
  const score = Number(value.score);
  if (artistMbid && Number.isFinite(score)) output.push({ artistMbid, referenceMbid, score, name: clean(value.name), order: order.value++ });
  for (const child of Object.values(value)) collectSimilarRows(child, output, order);
  return output;
}

function rankedSimilarRows(payload, seed) {
  const seedId = lowerMbid(seed);
  const seen = new Set();
  return collectSimilarRows(payload)
    .filter((row) => !row.referenceMbid || row.referenceMbid === seedId)
    .sort((a, b) => (b.score - a.score) || (a.order - b.order))
    .filter((row) => {
      if (seen.has(row.artistMbid)) return false;
      seen.add(row.artistMbid);
      return true;
    })
    .slice(0, RAW_CANDIDATE_LIMIT)
    .map((row, index) => ({ ...row, rawRank: index + 1 }));
}

function isSpotifyArtistUrl(value) {
  if (typeof value !== 'string' || !value.includes('open.spotify.com')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && SPOTIFY_ARTIST_PATH_RE.test(url.pathname);
  } catch { return false; }
}
function hasSpotifyArtistUrl(value) {
  if (isSpotifyArtistUrl(value)) return true;
  if (Array.isArray(value)) return value.some(hasSpotifyArtistUrl);
  if (value && typeof value === 'object') return Object.values(value).some(hasSpotifyArtistUrl);
  return false;
}
function collectArtistMetadata(value, output = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectArtistMetadata(item, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  const mbid = lowerMbid(value.artist_mbid ?? value.artistMbid ?? value.mbid);
  if (mbid && !output.has(mbid)) output.set(mbid, value);
  for (const child of Object.values(value)) collectArtistMetadata(child, output);
  return output;
}

function chunk(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function boundedFetch(url, { headers = {}, provider, gate, fetchImpl = fetch, attempt = 0 } = {}) {
  if (provider !== 'listenbrainz') throw new Error('Audit provider policy rejected a non-ListenBrainz request.');
  const parsed = new URL(url);
  if (!['api.listenbrainz.org', 'labs.api.listenbrainz.org'].includes(parsed.hostname) || parsed.protocol !== 'https:') {
    throw new Error('Audit provider policy rejected an unexpected host.');
  }
  if (!await gate.reserve('listenbrainz')) throw new Error(`ListenBrainz audit call cap reached (${gate.blockReason('listenbrainz') || 'blocked'}).`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
  } catch (error) {
    if (attempt < 1) {
      await sleep(2_000);
      return boundedFetch(url, { headers, provider, gate, fetchImpl, attempt: attempt + 1 });
    }
    throw new Error(error?.name === 'AbortError' ? 'ListenBrainz request timed out.' : 'ListenBrainz request failed.');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 429 && attempt < 1) {
    const waitRaw = Number(response.headers?.get?.('X-RateLimit-Reset-In') ?? response.headers?.get?.('Retry-After'));
    const waitSeconds = Number.isFinite(waitRaw) && waitRaw >= 0 ? Math.min(30, waitRaw) : 2;
    await sleep((waitSeconds + 1) * 1000);
    return boundedFetch(url, { headers, provider, gate, fetchImpl, attempt: attempt + 1 });
  }
  if (response.status >= 500 && attempt < 1) {
    await sleep(2_000);
    return boundedFetch(url, { headers, provider, gate, fetchImpl, attempt: attempt + 1 });
  }
  if (!response.ok) throw new Error(`ListenBrainz returned HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error('ListenBrainz returned invalid JSON.'); }
}

async function readWorkerJson(path, env = process.env, fetchImpl = fetch) {
  const endpoint = clean(env.CF_WORKER_ENDPOINT).replace(/\/+$/, '');
  const token = clean(env.CF_WORKER_TOKEN);
  if (!endpoint || !token) throw new Error('Audit requires the existing read-capable Worker endpoint and automation token.');
  const url = new URL(`${endpoint}/${path}`);
  const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Read-only Worker GET ${path} failed with HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error(`Read-only Worker GET ${path} returned invalid JSON.`); }
}

function seedMetrics(seed, candidates, spotifyByMbid, status = 'ok') {
  const linkedRanks = candidates.filter((candidate) => spotifyByMbid.get(candidate.artistMbid) === true).map((candidate) => candidate.rawRank);
  const within = (rank) => linkedRanks.filter((value) => value <= rank).length;
  return {
    seedOrdinal: seed.ordinal,
    fourteenDayListenCount: seed.listenCount,
    recencyRank: seed.recencyRank,
    identitySource: seed.source,
    status,
    rawCandidateCount: candidates.length,
    eligibleCandidateCount: candidates.length,
    spotifyLinkedWithin5: within(5),
    spotifyLinkedWithin10: within(10),
    spotifyLinkedWithin25: within(25),
    spotifyLinkedWithin50: within(50),
    fifthSpotifyRank: linkedRanks.length >= 5 ? linkedRanks[4] : null,
  };
}

async function runAudit({ env = process.env, fetchImpl = fetch, outputPath = null } = {}) {
  const [activity, bands] = await Promise.all([
    readWorkerJson('listening/band-activity.json', env, fetchImpl),
    readWorkerJson('bands.json', env, fetchImpl),
  ]);
  const seeds = selectTopSeeds(activity, bands);
  if (seeds.length !== TOP_SEED_COUNT) throw new Error(`Audit requires ${TOP_SEED_COUNT} current 14-day seed artists; found ${seeds.length}.`);
  const followed = followedIdentitySets(bands);
  const gate = createListeningMaintenanceUsageGate({ state: {} });
  const bySeed = new Map();
  const allCandidateMbids = new Set();

  for (const seed of seeds) {
    if (!seed.mbid) {
      bySeed.set(seed.ordinal, { status: 'unresolved_seed_identity', candidates: [] });
      continue;
    }
    const url = new URL('https://labs.api.listenbrainz.org/similar-artists/json');
    url.searchParams.set('algorithm', SIMILAR_ALGORITHM);
    url.searchParams.set('artist_mbids', seed.mbid);
    try {
      const payload = await boundedFetch(url.toString(), { provider: 'listenbrainz', gate, fetchImpl });
      const ranked = rankedSimilarRows(payload, seed.mbid);
      const eligible = ranked.filter((candidate) => candidate.artistMbid !== seed.mbid && !followed.mbids.has(candidate.artistMbid) && !followed.names.has(normalizeName(candidate.name)));
      bySeed.set(seed.ordinal, { status: 'ok', candidates: eligible });
      for (const candidate of eligible) allCandidateMbids.add(candidate.artistMbid);
    } catch (error) {
      bySeed.set(seed.ordinal, { status: `similar_error:${error.message}`, candidates: [] });
    }
  }

  const metadataByMbid = new Map();
  for (const batch of chunk([...allCandidateMbids], METADATA_BATCH_SIZE)) {
    if (!batch.length) continue;
    const url = new URL('https://api.listenbrainz.org/1/metadata/artist/');
    url.searchParams.set('artist_mbids', batch.join(','));
    const payload = await boundedFetch(url.toString(), { provider: 'listenbrainz', gate, fetchImpl });
    for (const [mbid, metadata] of collectArtistMetadata(payload)) metadataByMbid.set(mbid, metadata);
  }
  const spotifyByMbid = new Map([...allCandidateMbids].map((mbid) => [mbid, hasSpotifyArtistUrl(metadataByMbid.get(mbid))]));
  const uniqueSpotifyLinked = [...spotifyByMbid.values()].filter(Boolean).length;
  const seedReports = seeds.map((seed) => {
    const row = bySeed.get(seed.ordinal) || { status: 'missing', candidates: [] };
    return seedMetrics(seed, row.candidates, spotifyByMbid, row.status);
  });
  const successfulSeeds = seedReports.filter((seed) => seed.fifthSpotifyRank != null).length;
  const result = {
    kind: 'livevault-listenbrainz-discovery-audit',
    schemaVersion: 1,
    activityGeneratedAt: activity.generatedAt,
    auditedAt: new Date().toISOString(),
    seedCount: seeds.length,
    trustedSeedIdentities: seeds.filter((seed) => seed.source === 'trusted').length,
    auditFallbackSeedIdentities: seeds.filter((seed) => seed.source === 'audit_fallback').length,
    unresolvedSeedIdentities: seeds.filter((seed) => !seed.mbid).length,
    rawCandidateLimitPerSeed: RAW_CANDIDATE_LIMIT,
    uniqueEligibleCandidates: allCandidateMbids.size,
    metadataReturnedCandidates: metadataByMbid.size,
    uniqueCandidatesWithSpotifyArtistUrl: uniqueSpotifyLinked,
    uniqueSpotifyCoveragePercent: allCandidateMbids.size ? Number((100 * uniqueSpotifyLinked / allCandidateMbids.size).toFixed(1)) : 0,
    seedsWithFiveSpotifyLinkedRecommendations: successfulSeeds,
    spotifyApiCalls: 0,
    listenbrainzCalls: gate.state.listenbrainzCallsThisRun,
    seeds: seedReports,
  };
  gate.finish({ kind: 'read_only_discovery_audit', spotifyApiCalls: 0 });
  if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

async function selfTest() {
  const bands = [
    { id: 'alpha', name: 'Alpha', musicbrainz: { status: 'manual_confirmed', mbid: '11111111-1111-4111-8111-111111111111' } },
    { id: 'beta', name: 'Beta', musicbrainz: { status: 'auto_confirmed', mbid: '22222222-2222-4222-8222-222222222222' } },
  ];
  const activity = { kind: 'livevault-listening-band-activity', schemaVersion: 1, generatedAt: new Date().toISOString(), records: {
    alpha: { buckets: { fourteenDays: { listenCount: 7, recencyRank: 2 } } },
    beta: { buckets: { fourteenDays: { listenCount: 7, recencyRank: 1 } } },
  } };
  const selected = selectTopSeeds(activity, bands);
  if (selected[0].bandId !== 'beta' || selected[1].bandId !== 'alpha') throw new Error('Top-seed ordering self-test failed.');
  const payload = [{ artist_mbid: '33333333-3333-4333-8333-333333333333', reference_mbid: selected[0].mbid, name: 'Gamma', score: 10 }];
  const rows = rankedSimilarRows(payload, selected[0].mbid);
  if (rows.length !== 1 || rows[0].rawRank !== 1) throw new Error('Similarity parser self-test failed.');
  if (!hasSpotifyArtistUrl({ rels: { streaming: 'https://open.spotify.com/artist/AbC123' } })) throw new Error('Spotify URL detector self-test failed.');
  if (hasSpotifyArtistUrl({ rels: { streaming: 'https://open.spotify.com/track/AbC123' } })) throw new Error('Spotify track URL false-positive self-test failed.');
  const gate = createListeningMaintenanceUsageGate({ state: {} }, { listenbrainzMinDelayMs: 0 });
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), headers: { get: () => null } });
  await boundedFetch('https://api.listenbrainz.org/example', { provider: 'listenbrainz', gate, fetchImpl: fakeFetch });
  if (gate.state.listenbrainzCallsThisRun !== 1) throw new Error('ListenBrainz usage gate self-test failed.');
  let blocked = false;
  try { await boundedFetch('https://api.spotify.com/v1/search', { provider: 'listenbrainz', gate, fetchImpl: fakeFetch }); } catch { blocked = true; }
  if (!blocked) throw new Error('Host allowlist self-test failed.');
  console.log('ListenBrainz discovery audit self-test passed.');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((error) => { console.error(error.message); process.exitCode = 1; });
  } else {
    const outputIndex = process.argv.indexOf('--output');
    const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
    runAudit({ outputPath }).then((result) => {
      console.log(`Audit complete: ${result.seedCount} seeds, ${result.uniqueEligibleCandidates} unique candidates, ${result.uniqueCandidatesWithSpotifyArtistUrl} with Spotify artist URLs, ${result.seedsWithFiveSpotifyLinkedRecommendations}/${result.seedCount} seeds with five usable recommendations, ${result.listenbrainzCalls} ListenBrainz calls, 0 Spotify API calls.`);
    }).catch((error) => { console.error(`Audit failed safely: ${error.message}`); process.exitCode = 1; });
  }
}

module.exports = { selectTopSeeds, followedIdentitySets, rankedSimilarRows, hasSpotifyArtistUrl, collectArtistMetadata, seedMetrics, runAudit };
