'use strict';

const { planMusicbrainzResearch, confirmedMbid } = require('./musicbrainzResearchSchedule');

function createMusicbrainzScheduledGate({ musicbrainz, worker, config, now = () => new Date().toISOString() }) {
  const originalMetadata = musicbrainz.fetchArtistMetadata;
  const originalReleases = musicbrainz.fetchReleaseGroups;
  let schedulePromise = null;

  async function scheduleFor(usage) {
    if (!schedulePromise) {
      schedulePromise = (async () => {
        let bands;
        try {
          bands = await worker.readJson('bands.json', []);
        } catch (error) {
          usage?.note?.(`MusicBrainz scheduler state read failed — skipping MusicBrainz this run: ${error.message}`);
          return { selected: [], selectedKeys: new Set(), selectedProviderKeys: new Set(), dueCount: 0, remainingCapacity: 0, duplicateIdentitySkips: 0, planError: 'state_read_failed' };
        }
        const confirmed = (bands || []).filter(confirmedMbid);
        const countByMbid = new Map();
        for (const band of confirmed) {
          const mbid = band.musicbrainz.mbid;
          countByMbid.set(mbid, (countByMbid.get(mbid) || 0) + 1);
        }
        const duplicateMbids = new Set([...countByMbid].filter(([, count]) => count > 1).map(([mbid]) => mbid));
        const schedulableBands = confirmed.filter((band) => !duplicateMbids.has(band.musicbrainz.mbid));

        const plan = planMusicbrainzResearch(schedulableBands, {
          now: now(),
          perRunCap: config.MUSICBRAINZ.perRunCap,
          callsAlreadyUsed: Number(usage?.state?.musicbrainz?.callsThisRun || 0),
          metadataRefreshDays: config.STRUCTURED_RESEARCH.artistMetadataRefreshDays,
          releaseRefreshDays: config.STRUCTURED_RESEARCH.musicbrainzReleaseRefreshDays,
          releaseMonitoringEnabled: config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled,
        });

        const mbidById = new Map(schedulableBands.map((band) => [band.id, band.musicbrainz.mbid]));
        const selected = new Set(plan.selected.map((task) => `${mbidById.get(task.bandId)}:${task.kind}`));
        usage?.note?.(`MusicBrainz scheduler: ${plan.dueCount} safe due task(s), ${selected.size} selected, ${duplicateMbids.size} duplicate trusted MBID(s) excluded.`);
        return { ...plan, selectedProviderKeys: selected, duplicateIdentitySkips: duplicateMbids.size };
      })();
    }
    return schedulePromise;
  }

  async function fetchArtistMetadata(mbid, usage, fetchImpl) {
    const schedule = await scheduleFor(usage);
    if (!schedule.selectedProviderKeys.has(`${mbid}:metadata`)) return { kind: 'skipped', reason: 'dab5_not_scheduled' };
    return originalMetadata(mbid, usage, fetchImpl);
  }

  async function fetchReleaseGroups(mbid, usage, options = {}) {
    const schedule = await scheduleFor(usage);
    if (!schedule.selectedProviderKeys.has(`${mbid}:release`)) return { kind: 'skipped', reason: 'dab5_not_scheduled' };
    return originalReleases(mbid, usage, options);
  }

  return { fetchArtistMetadata, fetchReleaseGroups, scheduleFor };
}

function installMusicbrainzScheduledGate(options) {
  const gate = createMusicbrainzScheduledGate(options);
  options.musicbrainz.fetchArtistMetadata = gate.fetchArtistMetadata;
  options.musicbrainz.fetchReleaseGroups = gate.fetchReleaseGroups;
  return gate;
}

module.exports = { createMusicbrainzScheduledGate, installMusicbrainzScheduledGate };
