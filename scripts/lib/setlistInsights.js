'use strict';

const config = require('./config');
const { normalizeTitle } = require('./predictedSetlist');

function hash(value) { let h = 2166136261; for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return `si-${(h >>> 0).toString(16)}`; }
function iso(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null; }
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
  const allPrior = usefulEarlierSetlists(history, targetDate, Number.MAX_SAFE_INTEGER); const prior = allPrior.slice(0, settings.comparisonSetlistLimit);
  const candidates = []; const targetTour = String(setlist.tourName || '').trim();
  for (const song of setlist.songs) {
    if (!song?.name || song.isCover) continue;
    const normalizedName = normalizeTitle(song.name); if (!normalizedName) continue;
    const allAppearances = allPrior.filter((entry) => entry.songs.some((item) => item.normalizedName === normalizedName)); const priorAppearances = prior.filter((entry) => entry.songs.some((item) => item.normalizedName === normalizedName));
    const rate = prior.length ? priorAppearances.length / prior.length : 1;
    if (prior.length >= settings.minimumUsefulPriorSetlists && rate <= settings.rareMaximumPerformanceRate) candidates.push({ type: 'rare', priority: 3, score: rate, normalizedName, songName: song.name, label: 'Rare', explanation: `Played at ${priorAppearances.length} of the previous ${prior.length} recorded shows`, occurrenceCount: priorAppearances.length, sampleSize: prior.length });
    const sameTour = targetTour ? allPrior.filter((entry) => String(entry.tourName || '').trim() === targetTour) : [];
    if (sameTour.length >= settings.minimumSameTourPriorSetlists && !sameTour.some((entry) => entry.songs.some((item) => item.normalizedName === normalizedName))) candidates.push({ type: 'tour_debut', priority: 2, score: -sameTour.length, normalizedName, songName: song.name, label: 'Tour debut', explanation: `Not found in the previous ${sameTour.length} recorded shows from this tour`, occurrenceCount: 0, sampleSize: sameTour.length });
    if (allAppearances.length) {
      const last = allAppearances[0]; const years = Math.floor((Date.parse(targetDate) - Date.parse(last.date)) / (365.25 * 86400000));
      if (years >= settings.longGapMinimumYears) candidates.push({ type: 'long_gap', priority: 1, score: -years, normalizedName, songName: song.name, label: `First in ${years} years`, explanation: `First recorded performance in ${years} years`, occurrenceCount: allAppearances.length, sampleSize: prior.length });
    }
  }
  const strongestPerSong = new Map(); for (const item of candidates.sort((a, b) => a.priority - b.priority || a.score - b.score || a.normalizedName.localeCompare(b.normalizedName))) if (!strongestPerSong.has(item.normalizedName)) strongestPerSong.set(item.normalizedName, item);
  const insights = [...strongestPerSong.values()].sort((a, b) => a.priority - b.priority || a.score - b.score || a.normalizedName.localeCompare(b.normalizedName)).slice(0, settings.maximumInsightsPerConcert);
  const enoughEvidence = insights.length > 0 || prior.length >= settings.minimumUsefulPriorSetlists || sameTourCount(allPrior, targetDate, targetTour) >= settings.minimumSameTourPriorSetlists;
  return { ...base, status: enoughEvidence ? 'ready' : 'insufficient_data', generatedAt: enoughEvidence ? now.toISOString() : null, comparisonWindow: { setlistCount: prior.length, earliestDate: prior.at(-1)?.date || null, latestDate: prior[0]?.date || null, beforeDate: targetDate }, insights: enoughEvidence ? insights : [] };
}

function sameTourCount(history, targetDate, tourName) { return tourName ? history.filter((entry) => entry.date < targetDate && String(entry.tourName || '').trim() === tourName).length : 0; }
function needsInsightCompletion(concert, mbid, settings = config.SETLIST_INSIGHTS, now = new Date()) { if (!concert?.attending || !concert?.date || concert.date >= now.toISOString().slice(0, 10) || !concert?.setlist || !mbid) return false; const item = concert.setlistInsights; if (!item) return true; if (item.algorithmVersion !== settings.algorithmVersion || item.sourceSetlistFingerprint !== fingerprint(concert.setlist) || item.sourceArtistMbid !== mbid) return true; return !['ready', 'insufficient_data'].includes(item.status); }

function insightsDue(concert, mbid, { force = false, settings = config.SETLIST_INSIGHTS, now = new Date() } = {}) {
  if (!concert?.setlist || !mbid) return false; const prior = concert.setlistInsights;
  if (force || !prior || prior.algorithmVersion !== settings.algorithmVersion || prior.sourceSetlistFingerprint !== fingerprint(concert.setlist) || prior.sourceArtistMbid !== mbid) return true;
  if (!['error', 'quota_blocked', 'history_incomplete'].includes(prior.status)) return false;
  return Date.parse(prior.nextEligibleCheckAt || '') <= now.getTime();
}

module.exports = { fingerprint, usefulEarlierSetlists, positionTags, analyzeSetlistInsights, insightsDue, needsInsightCompletion };
