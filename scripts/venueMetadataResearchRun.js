'use strict';

const browserWorker = require('./lib/workerClient');
const { createWorkerClient } = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const tavily = require('./lib/tavily');
const groq = require('./lib/groq');
const VenueMetadata = require('../venueMetadataModelV158');

const MAX_VENUES_PER_RUN = 10;
const GROQ_ESTIMATED_TOKENS = 1200;
const MAINTENANCE_TOKEN_ENV = 'DATA_MAINTENANCE_TOKEN';

function createVenueMaintenanceClient(options = {}) {
  return createWorkerClient({ tokenEnv: MAINTENANCE_TOKEN_ENV, ...options });
}

function isUpcoming(concert, today) {
  return !!(concert?.attending && typeof concert.date === 'string' && concert.date >= today);
}

function matchingConcerts(seed, concerts) {
  return (concerts || []).filter((concert) => concert?.attending && VenueMetadata.findVenueRecord(concert, [seed]));
}

function researchPriority(seed, concerts, existing, today) {
  const matches = matchingConcerts(seed, concerts);
  const upcoming = matches.some((concert) => isUpcoming(concert, today));
  const status = existing?.researchStatus || 'missing';
  const statusRank = status === 'missing' ? 0
    : status === 'temporary_error' ? 1
      : status === 'unresolved' ? 2
        : status === 'partial' ? 3
          : status === 'review_needed' ? 4 : 5;
  return [upcoming ? 0 : 1, statusRank, String(seed.name || ''), String(seed.city || '')];
}

function comparePriority(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function dueVenueTargets(concerts, venues, { today = new Date().toISOString().slice(0, 10), limit = MAX_VENUES_PER_RUN } = {}) {
  const normalized = VenueMetadata.normalizeDocument(venues);
  const seeds = VenueMetadata.uniqueVenueSeeds(concerts, { attendedOnly: true });
  return seeds
    .map((seed) => ({ seed, existing: VenueMetadata.findVenueRecord(seed, normalized) }))
    .filter(({ existing }) => !VenueMetadata.isComplete(existing))
    .sort((a, b) => comparePriority(
      researchPriority(a.seed, concerts, a.existing, today),
      researchPriority(b.seed, concerts, b.existing, today),
    ))
    .slice(0, Math.max(0, limit));
}

function venueSearchQuery(seed) {
  return [
    `"${seed.name}"`,
    `"${seed.city}"`,
    seed.country ? `"${seed.country}"` : '',
    'venue maximum concert capacity official website address',
  ].filter(Boolean).join(' ');
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function safeSearchResults(payload) {
  return (payload?.results || [])
    .map((row) => ({
      title: String(row?.title || '').trim().slice(0, 220),
      url: httpsUrl(row?.url),
      content: String(row?.content || '').trim().slice(0, 3500),
    }))
    .filter((row) => row.url && row.content)
    .slice(0, 6);
}

function extractionPrompts(seed, searchResults) {
  const system = [
    'You extract factual venue metadata from supplied search evidence only.',
    'Return one JSON object with keys: maxCapacity, officialUrl, address, description, sourceUrls, identityConflict.',
    'maxCapacity must be a positive integer for the maximum normal concert/event configuration, or null.',
    'officialUrl must be the venue official HTTPS site, or null.',
    'address must be a factual full venue address string, or null.',
    'description must be a neutral factual description of at most 900 characters, or null.',
    'sourceUrls must contain only exact URLs from the supplied evidence that support the fields.',
    'identityConflict must be true if the evidence may refer to a different venue/location or materially conflicts.',
    'Do not guess. Missing or conflicting evidence must stay null or set identityConflict true.',
  ].join(' ');
  const user = JSON.stringify({
    target: { name: seed.name, city: seed.city, country: seed.country || '', address: seed.address || null },
    evidence: searchResults,
  });
  return { system, user };
}

function sourceUrlsFromExtraction(extracted, searchResults) {
  const allowed = new Map(searchResults.map((row) => [row.url, row.url]));
  const out = [];
  for (const raw of Array.isArray(extracted?.sourceUrls) ? extracted.sourceUrls : []) {
    const url = httpsUrl(raw);
    if (url && allowed.has(url) && !out.includes(url)) out.push(url);
  }
  return out.slice(0, 16);
}

function officialUrlFromExtraction(value, searchResults) {
  const url = httpsUrl(value);
  if (!url) return null;
  const origin = new URL(url).origin;
  return searchResults.some((row) => {
    try { return new URL(row.url).origin === origin; } catch { return false; }
  }) ? url : null;
}

function positiveCapacity(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function buildResearchedRecord({ seed, existing, extracted, searchResults, researchedAt }) {
  const base = { ...(existing || seed) };
  const sources = sourceUrlsFromExtraction(extracted, searchResults);
  const identityConflict = extracted?.identityConflict === true;
  const candidate = {
    ...base,
    venueId: existing?.venueId || seed.venueId,
    name: existing?.name || seed.name,
    city: existing?.city || seed.city,
    country: existing?.country || seed.country || '',
    schemaVersion: 1,
    researchedAt,
    sources,
  };

  const capacity = positiveCapacity(extracted?.maxCapacity);
  const officialUrl = officialUrlFromExtraction(extracted?.officialUrl, searchResults);
  const address = typeof extracted?.address === 'string' && extracted.address.trim() ? extracted.address.trim() : null;
  const description = typeof extracted?.description === 'string' && extracted.description.trim()
    ? extracted.description.trim().slice(0, 900) : null;

  if (capacity) candidate.maxCapacity = capacity;
  if (officialUrl) candidate.officialUrl = officialUrl;
  if (address) candidate.address = address;
  if (description) candidate.description = description;

  candidate.researchStatus = identityConflict ? 'review_needed' : 'partial';
  const normalized = VenueMetadata.normalizeRecord(candidate);
  if (!normalized) return { ...base, researchStatus: 'review_needed', researchedAt, sources };
  if (!identityConflict && VenueMetadata.isComplete({ ...normalized, researchStatus: 'complete' })) {
    normalized.researchStatus = 'complete';
  }
  return normalized;
}

function temporaryFailureRecord(seed, existing, researchedAt, status = 'temporary_error') {
  return VenueMetadata.normalizeRecord({
    ...(existing || seed),
    venueId: existing?.venueId || seed.venueId,
    researchStatus: status,
    researchedAt,
    sources: Array.isArray(existing?.sources) ? existing.sources : [],
    schemaVersion: 1,
  }) || { ...(existing || seed), researchStatus: status, researchedAt, schemaVersion: 1 };
}

function sameIdentity(a, b) {
  const left = VenueMetadata.normalizeIdentityText;
  return left(a?.name) === left(b?.name)
    && left(a?.city) === left(b?.city)
    && (!a?.country || !b?.country || left(a.country) === left(b.country));
}

function applyVenueUpdates(latestVenues, updates) {
  const out = VenueMetadata.normalizeDocument(latestVenues);
  for (const update of updates) {
    const byId = out.findIndex((record) => record.venueId === update.venueId);
    if (byId >= 0) {
      if (VenueMetadata.isComplete(out[byId]) || !sameIdentity(out[byId], update)) continue;
      out[byId] = VenueMetadata.normalizeRecord({ ...out[byId], ...update, venueId: out[byId].venueId }) || out[byId];
      continue;
    }
    const match = VenueMetadata.findVenueRecord(update, out);
    if (match) {
      const index = out.indexOf(match);
      if (VenueMetadata.isComplete(match) || !sameIdentity(match, update)) continue;
      out[index] = VenueMetadata.normalizeRecord({ ...match, ...update, venueId: match.venueId }) || match;
      continue;
    }
    const normalized = VenueMetadata.normalizeRecord(update);
    if (normalized && !out.some((record) => record.venueId === normalized.venueId)) out.push(normalized);
  }
  return out;
}

async function processTargets({ targets, usage, search = tavily.search, chatJson = groq.chatJson, now = () => new Date().toISOString() }) {
  const updates = [];
  let attempted = 0;
  let completed = 0;
  for (const { seed, existing } of targets) {
    if (!usage.canCallTavily() || !usage.canCallGroq(GROQ_ESTIMATED_TOKENS)) break;
    attempted += 1;
    usage.recordStructured('tavilyByReason', 'venue_metadata');
    const researchedAt = now();
    const searchPayload = await search(venueSearchQuery(seed), usage, { maxResults: 6, topic: 'general' });
    const results = safeSearchResults(searchPayload);
    if (!results.length) {
      updates.push(temporaryFailureRecord(seed, existing, researchedAt));
      continue;
    }
    usage.recordStructured('groqByCategory', 'venue_metadata');
    const prompts = extractionPrompts(seed, results);
    const extracted = await chatJson(prompts.system, prompts.user, usage, { estimatedTokens: GROQ_ESTIMATED_TOKENS });
    if (!extracted || typeof extracted !== 'object') {
      updates.push(temporaryFailureRecord(seed, existing, researchedAt));
      continue;
    }
    const record = buildResearchedRecord({ seed, existing, extracted, searchResults: results, researchedAt });
    if (record) {
      updates.push(record);
      if (VenueMetadata.isComplete(record)) completed += 1;
    }
  }
  return { updates, attempted, completed };
}

async function writeWithOneConflictRetry(client, updates) {
  if (!updates.length) return { changed: 0, venues: await client.readJson('venues.json', []) };
  let latest = await client.readJson('venues.json', []);
  let merged = applyVenueUpdates(latest, updates);
  if (JSON.stringify(merged) === JSON.stringify(VenueMetadata.normalizeDocument(latest))) return { changed: 0, venues: latest };
  try {
    await client.writeJsonStrict('venues.json', merged);
  } catch (error) {
    if (error?.code !== 'ETAG_CONFLICT') throw error;
    latest = await client.readJson('venues.json', []);
    merged = applyVenueUpdates(latest, updates);
    await client.writeJsonStrict('venues.json', merged);
  }
  return { changed: updates.length, venues: merged };
}

async function main() {
  const maintenance = createVenueMaintenanceClient();
  const [concerts, venues, usage] = await Promise.all([
    browserWorker.readJson('concerts.json', []),
    maintenance.readJson('venues.json', []),
    UsageTracker.load(),
  ]);
  const targets = dueVenueTargets(concerts, venues);
  const result = await processTargets({ targets, usage });
  const write = await writeWithOneConflictRetry(maintenance, result.updates);
  usage.finishRun({
    mode: 'venue-metadata-only',
    venuesDue: targets.length,
    venuesAttempted: result.attempted,
    venuesCompleted: result.completed,
    venueRecordsChanged: write.changed,
    status: 'ok',
  });
  await usage.save();
  console.log(`Venue metadata run complete. Due ${targets.length}; attempted ${result.attempted}; completed ${result.completed}; changed ${write.changed}.`);
}

if (require.main === module) main().catch(async (error) => {
  console.error('Venue metadata research failed:', error.message);
  process.exitCode = 1;
});

module.exports = {
  MAX_VENUES_PER_RUN,
  GROQ_ESTIMATED_TOKENS,
  MAINTENANCE_TOKEN_ENV,
  createVenueMaintenanceClient,
  dueVenueTargets,
  venueSearchQuery,
  safeSearchResults,
  extractionPrompts,
  buildResearchedRecord,
  temporaryFailureRecord,
  applyVenueUpdates,
  processTargets,
  writeWithOneConflictRetry,
  main,
};
