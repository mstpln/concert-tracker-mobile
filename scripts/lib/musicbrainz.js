'use strict';

// Conservative, single-request MusicBrainz artist matching. It deliberately
// stores only a short, reviewable candidate summary and never uses AI.
const config = require('./config');

const IMPERSONATOR = /\b(tribute|cover|parody|experience|impersonat|ultimate|revival|homage|salute|remembering|celebrating)\b/i;

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').trim()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/^the\s+/, '').replace(/\s+/g, ' ');
}
function candidateFrom(raw, band) {
  const name = String(raw?.name || '');
  const aliases = Array.isArray(raw?.aliases) ? raw.aliases.map((a) => a?.name).filter(Boolean) : [];
  const target = normalize(band.name), candidate = normalize(name);
  const aliasExact = aliases.some((a) => normalize(a) === target);
  const exact = candidate === target;
  const area = raw?.area?.name || null;
  const country = raw?.country || raw?.['country-code'] || null;
  const type = raw?.type || null;
  const contradictory = !!(band.origin && (area || country) && !normalize(`${area} ${country}`).includes(normalize(band.origin)));
  const bad = IMPERSONATOR.test(`${name} ${raw?.disambiguation || ''}`);
  let score = exact ? 70 : aliasExact ? 65 : 0;
  if (type === 'Group' || type === 'Orchestra') score += 10;
  if (band.origin && !contradictory) score += 10;
  if (Number(raw?.score) >= 95) score += 10;
  if (contradictory) score -= 30;
  if (bad) score = 0;
  const reasons = [];
  if (exact) reasons.push('Exact artist-name match');
  if (aliasExact) reasons.push('Exact alias match');
  if (type) reasons.push(`Artist type: ${type}`);
  if (band.origin && !contradictory) reasons.push('No origin conflict');
  if (contradictory) reasons.push('Origin conflict');
  return { mbid: raw?.id || '', artistName: name, area, country, artistType: type,
    disambiguation: raw?.disambiguation || null, score: Math.max(0, Math.min(100, score)), matchReasons: reasons,
    _exact: exact || aliasExact, _bad: bad, _contradictory: contradictory };
}

async function searchArtist(band, usage, fetchImpl = fetch) {
  if (!usage.canCallMusicbrainz()) return { kind: 'skipped' };
  await usage.recordMusicbrainzAttempt(); // must precede the network request
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.MUSICBRAINZ.timeoutMs);
  try {
    const url = new URL(`${config.MUSICBRAINZ.baseUrl}/artist`);
    url.searchParams.set('query', `artist:"${band.name.replace(/"/g, '')}"`);
    url.searchParams.set('fmt', 'json'); url.searchParams.set('limit', String(config.MUSICBRAINZ.maxCandidates));
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': config.MUSICBRAINZ.userAgent }, signal: controller.signal });
    if (!res.ok) return { kind: 'fatal', error: `MusicBrainz HTTP ${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data?.artists)) return { kind: 'fatal', error: 'Invalid MusicBrainz response' };
    const rejected = new Set(band.musicbrainz?.rejectedCandidateMbids || []);
    const unique = new Map();
    for (const candidate of data.artists.map((raw) => candidateFrom(raw, band))) {
      if (candidate.mbid && !candidate._bad && !rejected.has(candidate.mbid) && !unique.has(candidate.mbid)) unique.set(candidate.mbid, candidate);
    }
    const candidates = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, config.MUSICBRAINZ.maxCandidates);
    const clean = candidates.map(({ _exact, _bad, _contradictory, ...c }) => c);
    const top = candidates[0], second = candidates[1];
    const automatic = top && top._exact && !top._contradictory && top.score >= config.MUSICBRAINZ.autoConfirmThreshold &&
      (!second || top.score - second.score >= config.MUSICBRAINZ.clearLeadThreshold);
    return { kind: 'ok', candidates: clean, automatic: automatic ? clean[0] : null };
  } catch (e) {
    return { kind: 'fatal', error: e?.name === 'AbortError' ? 'MusicBrainz timeout' : `MusicBrainz request failed: ${e.message}` };
  } finally { clearTimeout(timer); }
}

function identityResult(band, result, now = new Date().toISOString()) {
  const prior = band.musicbrainz || {};
  if (['manual_confirmed', 'auto_confirmed'].includes(prior.status)) return null;
  if (result.kind === 'fatal') return { ...prior, status: 'error', lastAttemptedAt: now, source: 'MusicBrainz' };
  if (result.automatic) return { ...prior, ...result.automatic, confidence: result.automatic.score, status: 'auto_confirmed', matchMethod: 'automatic', source: 'MusicBrainz', matchedAt: now, lastAttemptedAt: now, reviewCandidates: [] };
  if (!result.candidates?.length) return { ...prior, mbid: null, status: 'no_match', lastAttemptedAt: now, reviewCandidates: [], source: 'MusicBrainz' };
  return { ...prior, mbid: null, status: 'needs_review', lastAttemptedAt: now, reviewCandidates: result.candidates, source: 'MusicBrainz' };
}

module.exports = { normalize, candidateFrom, searchArtist, identityResult };
