'use strict';

const DAY = 86400000;
const STAGES = Object.freeze({ ALBUM_ANNOUNCED: 'album_announced', NEW_SINGLE: 'new_single', UPCOMING_RELEASE: 'upcoming_release', OUT_TODAY: 'out_today' });
const labels = Object.freeze({ album_announced: 'ALBUM ANNOUNCED', new_single: 'NEW SINGLE', upcoming_release: 'UPCOMING RELEASE', out_today: 'OUT TODAY' });
const excluded = /\b(deluxe|expanded|anniversary|remaster(?:ed)?|reissue|compilation|greatest hits|remix|live|tribute|karaoke|bootleg)\b/i;
const safe = (value) => String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function canonicalReleaseId(release) { const type = safe(release.type); return release.musicbrainzReleaseGroupMbid ? `mbid:${release.musicbrainzReleaseGroupMbid}:${type}` : release.spotifyReleaseId ? `spotify:${release.spotifyReleaseId}:${type}` : `${safe(release.title)}:${release.releaseDate || ''}:${type}`; }
function lifecycleAlertId(bandId, release, stage) { return `release-${safe(bandId)}-${safe(stage)}-${safe(canonicalReleaseId(release))}`; }
function eligibleStages(release, now = new Date().toISOString(), prior = {}) {
  if (!release || excluded.test(release.title || '') || !['Album','EP','Single'].includes(release.type)) return [];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate || '') ? Date.parse(`${release.releaseDate}T00:00:00Z`) : null;
  const today = new Date(now).toISOString().slice(0,10); const out = [];
  if ((release.type === 'Album' || release.type === 'EP') && !prior.album_announced) out.push(STAGES.ALBUM_ANNOUNCED);
  if (release.type === 'Single' && release.spotifyReleaseId && release.spotifyUrl && !prior.new_single) out.push(STAGES.NEW_SINGLE);
  const announcementAt = prior.album_announced?.generatedAt || prior.album_announcedAt;
  if (date && release.type !== 'Single' && Math.round((date - Date.parse(now)) / DAY) === 7 && !prior.upcoming_release && !(announcementAt && Date.parse(now) - Date.parse(announcementAt) < 14 * DAY)) out.push(STAGES.UPCOMING_RELEASE);
  if (release.releaseDate === today && release.type !== 'Single' && !prior.out_today) out.push(STAGES.OUT_TODAY);
  return out;
}
module.exports = { STAGES, labels, canonicalReleaseId, lifecycleAlertId, eligibleStages };
