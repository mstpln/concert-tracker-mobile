'use strict';

(function attachListeningFixtures(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ListeningFixtures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SOURCE = 'synthetic-listenbrainz';
  const ARTWORK = [
    'assets/listening/album-blue.svg',
    'assets/listening/album-purple.svg',
    'assets/listening/album-cyan.svg',
    'assets/listening/album-gold.svg',
  ];
  const GENRES = ['alternative rock', 'pop', 'hip-hop', 'electronic', 'heavy metal', 'punk', 'folk', 'unknown'];
  const TRACK_TITLES = [
    'Midnight Signal',
    'Electric Avenue',
    'The Long Way Home',
    'Static Hearts',
    'Northern Lights',
    'No One Is Listening',
    'A Recording Title Intentionally Long Enough To Exercise Narrow Mobile Wrapping',
    'Second Chances',
    'After the Encore',
    'City in Blue',
    'Borrowed Time',
    'Final Transmission',
  ];
  const CURRENT_COUNTS = [44, 36, 32, 26, 20, 15, 11, 8];
  const PREVIOUS_COUNTS = [30, 48, 16, 34, 0, 22, 14, 9];

  function safeNow(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date('2026-08-01T12:00:00.000Z');
  }

  function listenDate(now, daysAgo, minuteOffset = 0) {
    return new Date(now.getTime() - daysAgo * 86400000 - minuteOffset * 60000);
  }

  function syntheticMbid(prefix, bandIndex, trackIndex = null) {
    const tail = String(trackIndex == null ? bandIndex + 1 : (bandIndex + 1) * 100 + trackIndex + 1).padStart(12, '0');
    return `${prefix}-0000-4000-8000-${tail}`;
  }

  function normalizedListen({ id, date, band, bandIndex, trackIndex, durationMs, artworkPath }) {
    const recordingTitle = TRACK_TITLES[trackIndex % TRACK_TITLES.length];
    const releaseIndex = trackIndex % 4;
    return {
      id,
      listenedAt: date.toISOString(),
      listenedAtMs: date.getTime(),
      listenedDurationMs: durationMs,
      recordingTitle,
      releaseTitle: `Synthetic Release ${releaseIndex + 1}`,
      artistCreditName: band.name,
      localBandId: band.id,
      musicbrainzArtistId: band.musicbrainz?.mbid || syntheticMbid('10000000', bandIndex),
      musicbrainzRecordingId: trackIndex === 5 ? null : syntheticMbid('20000000', bandIndex, trackIndex),
      musicbrainzReleaseId: syntheticMbid('30000000', bandIndex, releaseIndex),
      spotifyTrackId: band.musicbrainz?.spotify?.id ? `synthetic-${bandIndex}-${trackIndex}` : null,
      artworkPath,
      genre: GENRES[bandIndex % GENRES.length],
      source: SOURCE,
    };
  }

  function appendPeriod(output, { now, band, bandIndex, count, startDay, spanDays, periodKey }) {
    for (let index = 0; index < count; index += 1) {
      const trackIndex = (index * 5 + bandIndex * 3) % TRACK_TITLES.length;
      const daysAgo = startDay + ((index * 11 + bandIndex * 7) % Math.max(1, spanDays));
      const durationMs = (160 + ((trackIndex * 17 + bandIndex * 13 + index * 7) % 181)) * 1000;
      const artworkPath = bandIndex === 4 && trackIndex === 5 ? null : ARTWORK[(trackIndex + bandIndex) % ARTWORK.length];
      output.push(normalizedListen({
        id: `synthetic-listen-${band.id}-${periodKey}-${index}`,
        date: listenDate(now, daysAgo, index + bandIndex),
        band,
        bandIndex,
        trackIndex,
        durationMs,
        artworkPath,
      }));
    }
  }

  function appendHistoricalYears(output, now, band, bandIndex) {
    const currentYear = now.getUTCFullYear();
    for (let yearsAgo = 2; yearsAgo <= 7; yearsAgo += 1) {
      const year = currentYear - yearsAgo;
      const count = Math.max(1, 5 - Math.floor(bandIndex / 3));
      for (let index = 0; index < count; index += 1) {
        const month = (bandIndex + index * 3) % 12;
        const date = new Date(Date.UTC(year, month, 4 + ((index * 5 + bandIndex) % 22), 18, index));
        output.push(normalizedListen({
          id: `synthetic-listen-${band.id}-year-${year}-${index}`,
          date,
          band,
          bandIndex,
          trackIndex: (index + yearsAgo + bandIndex) % TRACK_TITLES.length,
          durationMs: (175 + ((index + bandIndex + yearsAgo) % 9) * 19) * 1000,
          artworkPath: ARTWORK[(index + yearsAgo) % ARTWORK.length],
        }));
      }
    }
  }

  function appendProductionShapeRegressionRecords(output, now, band) {
    if (!band) return;
    const recentIso = listenDate(now, 2, 3);
    const recentSeconds = listenDate(now, 5, 7);
    const previousSeconds = listenDate(now, 19, 11);
    const historical = new Date(Date.UTC(2010, 0, 16, 12, 0, 0));
    const base = {
      artistCreditName: band.name,
      localBandId: band.id,
      releaseTitle: 'Production Shape Regression Album',
      genre: 'alternative rock',
      artworkPath: null,
    };
    output.push(
      {
        ...base,
        id: 'synthetic-production-shape-iso-only',
        stableListenId: 'spotify-import:synthetic-production-shape-iso-only',
        listenedAt: recentIso.toISOString(),
        listenedDurationMs: 241000,
        recordingTitle: 'ISO Timestamp Track',
        spotifyTrackId: 'synthetic-production-shape-iso-only',
        source: 'spotify_import',
      },
      {
        ...base,
        id: 'synthetic-production-shape-unix-seconds',
        stableListenId: 'listenbrainz:synthetic-production-shape-unix-seconds',
        listenedAt: null,
        timestamp: Math.floor(recentSeconds.getTime() / 1000),
        listenedDurationMs: null,
        recordingTitle: 'Unix Seconds Unknown Duration Track',
        source: 'listenbrainz',
      },
      {
        ...base,
        id: 'synthetic-production-shape-previous-window',
        stableListenId: 'listenbrainz:synthetic-production-shape-previous-window',
        listenedAtSeconds: Math.floor(previousSeconds.getTime() / 1000),
        listenedDurationMs: 199000,
        recordingTitle: 'Previous Window Track',
        source: 'listenbrainz',
      },
      {
        ...base,
        id: 'synthetic-production-shape-historical-ms-string',
        stableListenId: 'spotify-import:synthetic-production-shape-historical-ms-string',
        listenedAt: String(historical.getTime()),
        listenedDurationMs: 205000,
        recordingTitle: 'Historical Millisecond String Track',
        spotifyTrackId: 'synthetic-production-shape-historical-ms-string',
        source: 'spotify_import',
      },
      {
        ...base,
        id: 'synthetic-production-shape-malformed-optional',
        stableListenId: 'listenbrainz:synthetic-production-shape-malformed-optional',
        listenedAt: 'not-a-real-date',
        listenedDurationMs: null,
        recordingTitle: 'Malformed Optional Record',
        releaseTitle: null,
        source: 'listenbrainz',
        futureOptionalMetadata: { malformedButNonFatal: true },
      },
    );
  }

  function fixtureTime(listen) {
    const candidates = [listen?.listenedAtMs, listen?.listenedAtUnix, listen?.listenedAtSeconds, listen?.timestamp, listen?.listenedAt];
    for (const candidate of candidates) {
      if (candidate == null || candidate === '') continue;
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) return Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric;
      const parsed = Date.parse(String(candidate));
      if (Number.isFinite(parsed)) return parsed;
    }
    return Infinity;
  }

  function createSyntheticListens(bands = [], nowValue = new Date()) {
    const now = safeNow(nowValue);
    const output = [];
    const eligibleBands = (bands || []).filter((band) => band?.id && band?.name && !band.syntheticListeningEmpty).slice(0, 100);
    eligibleBands.forEach((band, bandIndex) => {
      const currentCount = CURRENT_COUNTS[bandIndex] ?? Math.max(1, 12 - Math.floor((bandIndex - 8) / 10));
      const previousCount = PREVIOUS_COUNTS[bandIndex] ?? Math.max(1, 10 - Math.floor((bandIndex - 8) / 12));
      appendPeriod(output, { now, band, bandIndex, count: currentCount, startDay: 1, spanDays: 74, periodKey: 'current-quarter' });
      appendPeriod(output, { now, band, bandIndex, count: previousCount, startDay: 105, spanDays: 65, periodKey: 'previous-quarter' });
      appendPeriod(output, { now, band, bandIndex, count: Math.max(2, 8 - Math.floor(bandIndex / 2)), startDay: 205, spanDays: 130, periodKey: 'earlier-year' });
      appendPeriod(output, { now, band, bandIndex, count: Math.max(2, 10 - bandIndex), startDay: 400, spanDays: 260, periodKey: 'previous-year' });
      appendHistoricalYears(output, now, band, bandIndex);
    });

    appendProductionShapeRegressionRecords(output, now, eligibleBands[0]);

    // Retained for global totals/genre history, but deliberately excluded
    // from linked band rankings because it has no safe localBandId match.
    [12, 42, 160].forEach((daysAgo, index) => {
      const date = listenDate(now, daysAgo, index);
      output.push({
        id: `synthetic-listen-unmatched-${index}`,
        listenedAt: date.toISOString(),
        listenedAtMs: date.getTime(),
        listenedDurationMs: (190 + index * 20) * 1000,
        recordingTitle: `Unmatched Recording ${index + 1}`,
        releaseTitle: 'Unmatched Synthetic Release',
        artistCreditName: 'Unmatched Synthetic Artist',
        localBandId: null,
        musicbrainzArtistId: null,
        musicbrainzRecordingId: index === 1 ? null : syntheticMbid('40000000', 0, index),
        musicbrainzReleaseId: null,
        spotifyTrackId: null,
        artworkPath: index === 2 ? null : ARTWORK[index],
        genre: index === 2 ? 'unknown' : 'experimental folk',
        source: SOURCE,
      });
    });

    return output.sort((a, b) => fixtureTime(a) - fixtureTime(b) || String(a.id || '').localeCompare(String(b.id || '')));
  }

  function emptySyntheticListens() {
    return [];
  }

  return { SOURCE, ARTWORK, TRACK_TITLES, createSyntheticListens, emptySyntheticListens };
});
