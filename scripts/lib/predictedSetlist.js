'use strict';

const config = require('./config');

const normalizeTitle = (value) => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const median = (values) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return 0; const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2); };
const stableHash = (value) => { let hash = 2166136261; for (const ch of value) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `ps-${(hash >>> 0).toString(16)}`; };

function usefulSetlists(rawSetlists, now = new Date()) {
  const cutoff = now.getTime() - config.PREDICTED_SETLIST.historyWindowDays * 86400000;
  const seen = new Set();
  return (rawSetlists || []).map((setlist) => {
    const date = Date.parse(setlist?.eventDate || setlist?.date || '');
    const id = setlist?.id || `${setlist?.eventDate || ''}|${setlist?.venue?.id || setlist?.venue?.name || ''}`;
    if (!id || seen.has(id) || !Number.isFinite(date) || date < cutoff || date > now.getTime()) return null;
    seen.add(id);
    const songs = (setlist?.songs || []).filter((song) => song && song.name && !song.isCover).map((song, index) => ({ name: song.name, normalizedName: normalizeTitle(song.name), isEncore: !!song.isEncore, index }));
    return songs.length ? { id, date: new Date(date).toISOString().slice(0, 10), songs } : null;
  }).filter(Boolean).slice(0, config.PREDICTED_SETLIST.historyMaxSetlists);
}

function generatePrediction(rawSetlists, { now = new Date() } = {}) {
  const setlists = usefulSetlists(rawSetlists, now);
  if (!setlists.length) return { status: 'unavailable', sourceSetlistCount: 0, songs: [] };
  if (setlists.length < config.PREDICTED_SETLIST.minimumUsefulSetlists) return { status: 'insufficient_data', sourceSetlistCount: setlists.length, songs: [] };
  const total = setlists.length;
  const lengths = setlists.map((set) => set.songs.length);
  const bySong = new Map();
  const recentBoundary = Math.ceil(total / 2);
  setlists.forEach((set, setIndex) => set.songs.forEach((song) => {
    const item = bySong.get(song.normalizedName) || { name: song.name, normalizedName: song.normalizedName, shows: [], opener: 0, closer: 0, encore: 0, recent: 0, older: 0 };
    const position = set.songs.length > 1 ? song.index / (set.songs.length - 1) : 0;
    item.shows.push({ position, date: set.date });
    if (song.index === 0) item.opener++;
    if (song.index === set.songs.length - 1) item.closer++;
    if (song.isEncore) item.encore++;
    if (setIndex < recentBoundary) item.recent++; else item.older++;
    bySong.set(song.normalizedName, item);
  }));
  const targetLength = Math.max(1, median(lengths));
  const songs = [...bySong.values()].map((item) => {
    const rate = Math.round(item.shows.length / total * 100);
    const recency = item.shows.reduce((sum, show) => sum + Math.max(0, 1 - ((now.getTime() - Date.parse(show.date)) / (config.PREDICTED_SETLIST.historyWindowDays * 86400000))), 0) / item.shows.length;
    const openerRate = item.opener / total; const closerRate = item.closer / total; const encoreRate = item.encore / total;
    const recentlyAdded = item.recent / recentBoundary >= 0.6 && (!item.older || item.older / Math.max(1, total - recentBoundary) <= 0.2);
    const evidenceLabel = openerRate >= 0.5 ? 'Likely opener' : closerRate >= 0.5 ? 'Common closer' : encoreRate >= 0.4 ? 'Common encore' : recentlyAdded ? 'Recently added' : null;
    return { ...item, performanceRate: rate, position: median(item.shows.map((show) => Math.round(show.position * 1000))) / 1000, score: (rate / 100) * 0.8 + recency * 0.2, evidenceLabel, openerRate, closerRate, encoreRate };
  }).sort((a, b) => b.score - a.score || a.normalizedName.localeCompare(b.normalizedName)).slice(0, targetLength)
    .sort((a, b) => a.position - b.position || b.openerRate - a.openerRate || a.normalizedName.localeCompare(b.normalizedName));
  const averageRate = songs.reduce((sum, song) => sum + song.performanceRate, 0) / songs.length;
  const lengthSpread = Math.max(...lengths) - Math.min(...lengths);
  const confidence = total >= 8 && lengthSpread <= 2 && averageRate >= 65 ? 'high' : total >= 5 && averageRate >= 45 ? 'medium' : 'low';
  const fingerprint = stableHash(JSON.stringify(setlists.map((set) => [set.id, set.date, set.songs.map((song) => [song.normalizedName, song.isEncore])] )));
  return { status: 'ready', sourceSetlistCount: total, sourceWindowStart: setlists.at(-1).date, sourceWindowEnd: setlists[0].date, confidence, predictedSongCount: songs.length, fingerprint, songs: songs.map((song, index) => ({ name: song.name, normalizedName: song.normalizedName, predictedPosition: index + 1, performanceRate: song.performanceRate, evidenceLabel: song.evidenceLabel, spotifyTrackId: null, spotifyUri: null, spotifyUrl: null, spotifyMatched: false })) };
}

module.exports = { normalizeTitle, usefulSetlists, generatePrediction };
