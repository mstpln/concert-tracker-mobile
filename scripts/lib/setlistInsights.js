'use strict';

const config = require('./config');
const { normalizeTitle } = require('./predictedSetlist');

function hash(value) { let h = 2166136261; for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return `si-${(h >>> 0).toString(16)}`; }
function iso(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null; }
function fingerprint(setlist) { return hash(JSON.stringify([setlist?.tourName || null, (setlist?.songs || []).map((song) => [normalizeTitle(song?.name), !!song?.isEncore, !!song?.isCover])])); }

function usefulEarlierSetlists(raw, beforeDate, limit = config.SETLIST_INSIGHTS.comparisonSetlistLimit) {
  const before = Date.parse(beforeDate || ''); const seen = new Set();
  return (raw || []).map((set) => {
    const date = iso(set?.eventDate || set?.date); const id = set?.id || `${date || ''}|${set?.venue?.id || set?.venue?.name || ''}`;
    if (!date || !id || seen.has(id) || !Number.isFinite(before) || Date.parse(date) >= before) return null;
    seen.add(id);
    const songs = (set?.songs || []).filter((song) => song?.name && !song.isCover).map((song) => ({ name: song.name, normalizedName: normalizeTitle(song.name) })).filter((song) => song.normalizedName);
    return songs.length ? { id, date, tourName: set?.tourName || null, songs } : null;
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, limit);
}

function positionTags(songs) {
  const valid = (songs || []).map((song, index) => ({ song, index })).filter(({ song }) => song?.name);
  if (!valid.length) return new Map();
  const firstEncore = valid.find(({ song }) => song.isEncore)?.index;
  const closer = firstEncore === undefined ? valid.at(-1).index : valid.filter(({ index }) => index < firstEncore).at(-1)?.index;
  const tags = new Map([[valid[0].index, ['Opener']]]);
  if (closer !== undefined && closer !== valid[0].index) tags.set(closer, ['Main-set closer']);
  else if (closer !== undefined) tags.get(closer).push('Main-set closer');
  return tags;
}

function analyzeSetlistInsights(concert, history, { settings = config.SETLIST_INSIGHTS, now = new Date() } = {}) {
  const setlist = concert?.setlist; const sourceSetlistFingerprint = fingerprint(setlist); const targetDate = iso(concert?.date);
  const base = { algorithmVersion: settings.algorithmVersion, lastAttemptedAt: now.toISOString(), sourceSetlistFingerprint, sourceArtistMbid: null, insights: [] };
  if (!targetDate || !Array.isArray(setlist?.songs) || !setlist.songs.length) return { ...base, status: 'insufficient_data' };
  const prior = usefulEarlierSetlists(history, targetDate, settings.comparisonSetlistLimit);
  if (prior.length < settings.minimumUsefulPriorSetlists) return { ...base, status: 'insufficient_data', comparisonWindow: { setlistCount: prior.length, earliestDate: prior.at(-1)?.date || null, latestDate: prior[0]?.date || null, beforeDate: targetDate } };
  const candidates = [];
  for (const song of setlist.songs) {
    if (!song?.name || song.isCover) continue;
    const normalizedName = normalizeTitle(song.name); if (!normalizedName) continue;
    const appearances = prior.filter((entry) => entry.songs.some((item) => item.normalizedName === normalizedName));
    const rate = appearances.length / prior.length;
    if (rate <= settings.rareMaximumPerformanceRate) candidates.push({ type: 'rare', priority: 3, score: rate, normalizedName, songName: song.name, label: 'Rare', explanation: `Played at ${appearances.length} of the previous ${prior.length} recorded shows`, occurrenceCount: appearances.length, sampleSize: prior.length });
    const sameTour = setlist.tourName ? prior.filter((entry) => entry.tourName === setlist.tourName) : [];
    if (sameTour.length >= settings.minimumSameTourPriorSetlists && !sameTour.some((entry) => entry.songs.some((item) => item.normalizedName === normalizedName))) candidates.push({ type: 'tour_debut', priority: 2, score: -sameTour.length, normalizedName, songName: song.name, label: 'Tour debut', explanation: `Not found in the previous ${sameTour.length} recorded shows from this tour`, occurrenceCount: 0, sampleSize: sameTour.length });
    if (appearances.length) {
      const last = appearances[0]; const years = Math.floor((Date.parse(targetDate) - Date.parse(last.date)) / (365.25 * 86400000));
      if (years >= settings.longGapMinimumYears) candidates.push({ type: 'long_gap', priority: 1, score: -years, normalizedName, songName: song.name, label: `First in ${years} years`, explanation: `First recorded performance in ${years} years`, occurrenceCount: appearances.length, sampleSize: prior.length });
    }
  }
  const insights = [...new Map(candidates.sort((a, b) => a.priority - b.priority || a.score - b.score || a.normalizedName.localeCompare(b.normalizedName)).map((item) => [`${item.normalizedName}|${item.type}`, item])).values()].slice(0, settings.maximumInsightsPerConcert);
  return { ...base, status: 'ready', generatedAt: now.toISOString(), comparisonWindow: { setlistCount: prior.length, earliestDate: prior.at(-1)?.date || null, latestDate: prior[0]?.date || null, beforeDate: targetDate }, insights };
}

function insightsDue(concert, mbid, { force = false, settings = config.SETLIST_INSIGHTS } = {}) {
  if (!concert?.setlist || !mbid) return false; const prior = concert.setlistInsights;
  return force || !prior || prior.algorithmVersion !== settings.algorithmVersion || prior.sourceSetlistFingerprint !== fingerprint(concert.setlist) || prior.sourceArtistMbid !== mbid;
}

module.exports = { fingerprint, usefulEarlierSetlists, positionTags, analyzeSetlistInsights, insightsDue };
