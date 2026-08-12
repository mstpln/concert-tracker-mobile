'use strict';

const { planMusicbrainzResearch, confirmedMbid } = require('./musicbrainzResearchSchedule');

function createMusicbrainzScheduledGate({ musicbrainz, worker, config, now = () => new Date().toISOString() }) {
  const originalMetadata = musicbrainz.fetchArtistMetadata;
  const originalReleases = musicbrainz.fetchReleaseGroups;
  let schedulePromise = null;

  async function scheduleFor(usage) {
    if (!schedulePromise) {
      schedulePromise = (async () => {
        const bands = await worker.readJson('bands.json', []);
        const plan = planMusicbrainzResearch(bands, {
          now: now(),
          perRunCap: config.MUSICBRAINZ.perRunCap,
          callsAlreadyUsed: Number(usage?.state?.musicbrainz?.callsThisRun || 0),
          metadataRefreshDays: config.STRUCTURED_RESEARCH.artistMetadataRefreshDays,
          releaseRefreshDays: config.STRUCTURED_RESEARCH.musicbrainzReleaseRefreshDays,
          releaseMonitoringEnabled: config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled,
        });

        const confirmedById = new Map();
        const countByMbid = new Map();
        for (const band of bands || []) {
          if (!confirmedMbid(band)) continue;
          const mbid = band.musicbrainz.mbid;
          confirmedById.set(band.id, mbid);
          countByMbid.set(mbid, (countByMbid.get(mbid) || 0) + 1);
        }

        const selected = new Set();
        let duplicateIdentitySkips = 0;
        for (const task of plan.selected) {
          const mbid = confirmedById.get(task.bandId);
          if (!mbid || countByMbid.get(mbid) !== 1) {
            duplicateIdentitySkips += 1;
            continue;
          }
          selected.add(`${mbid}:${task.kind}`);
        }
        usage?.note?.(`MusicBrainz scheduler: ${plan.dueCount} due task(s), ${selected.size} selected, ${duplicateIdentitySkips} duplicate-identity task(s) skipped.`);
        return { ...plan, selectedProviderKeys: selected, duplicateIdentitySkips };
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
