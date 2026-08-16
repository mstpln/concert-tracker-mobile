'use strict';
const { STAGES, labels, lifecycleAlertId, eligibleStages } = require('./releaseLifecycle');
function planLifecycleAlerts({ band, releases = [], alerts = [], today }) {
  const creates = [], enrich = [], lifecycleUpdates = [], skipped = [];
  for (const release of releases) {
    if (!release.lifecycleEligible || release.historical || release.baselineIncomplete) { skipped.push({ release, reason: 'baseline' }); continue; }
    for (const stage of eligibleStages(release, today, release.lifecycle || {})) {
      const id = lifecycleAlertId(band.id, release, stage);
      const existing = alerts.find((a) => a.id === id || (stage === STAGES.ALBUM_ANNOUNCED && ((release.musicbrainzReleaseGroupMbid && a.musicbrainzReleaseGroupMbid === release.musicbrainzReleaseGroupMbid) || (release.spotifyReleaseId && a.spotifyReleaseId === release.spotifyReleaseId) || (release.releaseDeduplicationKey && a.releaseDeduplicationKey === release.releaseDeduplicationKey))));
      lifecycleUpdates.push({ bandId: band.id, canonicalReleaseId: release.canonicalReleaseId, stage, alertId: existing?.id || id });
      if (existing) { enrich.push({ id: existing.id, lifecycleStage: stage }); continue; }
      creates.push({ id, bandId: band.id, bandName: band.name, category: 'album', headline: `${labels[stage]} · ${release.title}`, foundAt: today, structured: true, lifecycleStage: stage, canonicalReleaseId: release.canonicalReleaseId, releaseTitle: release.title, releaseType: release.type, releaseDate: release.releaseDate || null, spotifyUrl: stage === STAGES.NEW_SINGLE ? release.spotifyUrl : null });
    }
  }
  return { alertsToCreate: creates, alertsToEnrich: enrich, lifecycleUpdates, skipped };
}
module.exports = { planLifecycleAlerts };
