'use strict';

// Conservative, single-request MusicBrainz artist matching. It deliberately
// stores only a short, reviewable candidate summary and never uses AI.
const config = require('./config');

const IMPERSONATOR = /\b(tribute|cover|parody|experience|impersonat|ultimate|revival|homage|salute|remembering|celebrating)\b/i;
const COUNTRY_ALIASES = {
  se: 'SE', sweden: 'SE', sverige: 'SE',
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
  gb: 'GB', uk: 'GB', 'united kingdom': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
};

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').trim()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/^the\s+/, '').replace(/\s+/g, ' ');
}
function countryFrom(value) {
  const normalized = normalize(value);
  if (COUNTRY_ALIASES[normalized]) return COUNTRY_ALIASES[normalized];
  const words = normalized.split(' ');
  for (let size = Math.min(4, words.length); size > 0; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const found = COUNTRY_ALIASES[words.slice(start, start + size).join(' ')];
      if (found) return found;
    }
  }
  return null;
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
  const originCountry = countryFrom(band.origin);
  const mbCountry = countryFrom(country) || countryFrom(area);
  const hasSavedOrigin = Boolean(String(band.origin || '').trim());
  const contradictory = !!(originCountry && mbCountry && originCountry !== mbCountry);
  const originAgreement = !!(originCountry && mbCountry && originCountry === mbCountry);
  // A saved origin is evidence only when both sides can be deterministically
  // normalized. Unknown values remain reviewable but can never auto-confirm.
  const originUnverified = hasSavedOrigin && (!originCountry || !mbCountry);
  const bad = IMPERSONATOR.test(`${name} ${raw?.disambiguation || ''}`);
  let score = exact ? 75 : aliasExact ? 65 : 0;
  if (type === 'Group' || type === 'Orchestra') score += 10;
  if (originAgreement) score += 5;
  if (Number(raw?.score) >= 95) score += 10;
  if (contradictory) score -= 30;
  if (bad) score = 0;
  const reasons = [];
  if (exact) reasons.push('Exact artist-name match');
  if (aliasExact) reasons.push('Exact alias match');
  if (type) reasons.push(`Artist type: ${type}`);
  if (originAgreement) reasons.push('Origin agreement');
  if (contradictory) reasons.push('Origin conflict');
  return { mbid: raw?.id || '', artistName: name, area, country, artistType: type,
    disambiguation: raw?.disambiguation || null, score: Math.max(0, Math.min(100, score)), matchReasons: reasons,
    _exact: exact || aliasExact, _bad: bad, _contradictory: contradictory, _originUnverified: originUnverified };
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
      if (candidate.mbid && candidate._exact && !candidate._bad && !rejected.has(candidate.mbid) && !unique.has(candidate.mbid)) unique.set(candidate.mbid, candidate);
    }
    const candidates = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, config.MUSICBRAINZ.maxCandidates);
    const clean = candidates.map(({ _exact, _bad, _contradictory, _originUnverified, ...c }) => c);
    const top = candidates[0], second = candidates[1];
    const automatic = top && top._exact && !top._contradictory && !top._originUnverified && top.score >= config.MUSICBRAINZ.autoConfirmThreshold &&
      (!second || top.score - second.score >= config.MUSICBRAINZ.clearLeadThreshold);
    return { kind: 'ok', candidates: clean, automatic: automatic ? clean[0] : null };
  } catch (e) {
    return { kind: 'fatal', error: e?.name === 'AbortError' ? 'MusicBrainz timeout' : `MusicBrainz request failed: ${e.message}` };
  } finally { clearTimeout(timer); }
}

function identityResult(band, result, now = new Date().toISOString()) {
  // A skipped lookup made no MusicBrainz request and carries no match result.
  if (result.kind === 'skipped') return null;
  const prior = band.musicbrainz || {};
  if (['manual_confirmed', 'auto_confirmed'].includes(prior.status)) return null;
  if (result.kind === 'fatal') return { ...prior, status: 'error', lastAttemptedAt: now, source: 'MusicBrainz' };
  const rejectedCandidateMbids = [...new Set(prior.rejectedCandidateMbids || [])];
  if (result.automatic) return {
    mbid: result.automatic.mbid, artistName: result.automatic.artistName, area: result.automatic.area || null,
    country: result.automatic.country || null, artistType: result.automatic.artistType || null,
    disambiguation: result.automatic.disambiguation || null, confidence: result.automatic.score,
    status: 'auto_confirmed', matchMethod: 'automatic', source: 'MusicBrainz', matchedAt: now,
    reviewedAt: prior.reviewedAt || null, lastAttemptedAt: now, rejectedCandidateMbids, reviewCandidates: [],
  };
  const unresolved = (status, reviewCandidates) => ({
    mbid: null, artistName: null, area: null, country: null, artistType: null, disambiguation: null,
    confidence: null, status, matchMethod: null, source: prior.source || 'MusicBrainz', matchedAt: null,
    reviewedAt: prior.reviewedAt || null, lastAttemptedAt: now, rejectedCandidateMbids, reviewCandidates,
  });
  if (!result.candidates?.length) return unresolved('no_match', []);
  return unresolved('needs_review', result.candidates);
}

module.exports = { normalize, countryFrom, candidateFrom, searchArtist, identityResult };
