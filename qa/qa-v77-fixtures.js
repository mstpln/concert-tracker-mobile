'use strict';

// Focused v77 synthetic release feed. The long-lived base fixture still
// contains historical article/lifecycle examples used by older regression
// coverage; the generated QA preview replaces only news.json with the
// post-cleanup Spotify-only shape approved for v77.
(function applyV77QaFixtures(root) {
  const fixtures = root.LiveVaultQaFixtures;
  if (!fixtures) return;
  fixtures.news = [
    {
      id: 'qa-spotify-album-art',
      bandId: 'qa-artist-one',
      bandName: 'QA Artist One',
      category: 'album',
      provider: 'spotify',
      structured: true,
      lifecycleStage: 'spotify_release',
      releaseTitle: 'Synthetic Blue Record',
      releaseType: 'Album',
      releaseDate: '2027-07-16',
      spotifyReleaseId: 'qaRelease001',
      spotifyUrl: 'https://open.spotify.com/album/qaRelease001',
      sourceName: 'Spotify',
      sourceUrl: 'https://open.spotify.com/album/qaRelease001',
      artworkUrl: 'https://example.invalid/images/release-cover.jpg',
      foundAt: '2027-07-16T11:00:00.000Z',
      futureField: { preserved: true },
    },
    {
      id: 'qa-spotify-single',
      bandId: 'qa-artist-two',
      bandName: 'QA Artist Two',
      category: 'album',
      provider: 'spotify',
      structured: true,
      lifecycleStage: 'spotify_release',
      releaseTitle: 'Synthetic Single',
      releaseType: 'Single',
      releaseDate: '2027-07-15',
      spotifyReleaseId: 'qaSingle001',
      spotifyUrl: 'https://open.spotify.com/album/qaSingle001',
      sourceName: 'Spotify',
      sourceUrl: 'https://open.spotify.com/album/qaSingle001',
      foundAt: '2027-07-15T11:00:00.000Z',
    },
    {
      id: 'qa-spotify-album-placeholder',
      bandId: 'qa-artist-one',
      bandName: 'QA Artist One',
      category: 'album',
      provider: 'spotify',
      structured: true,
      lifecycleStage: 'spotify_release',
      releaseTitle: 'Minimal Synthetic Album',
      releaseType: 'Album',
      releaseDate: '2027-07-14',
      spotifyReleaseId: 'qaRelease002',
      spotifyUrl: 'https://open.spotify.com/album/qaRelease002',
      sourceName: 'Spotify',
      sourceUrl: 'https://open.spotify.com/album/qaRelease002',
      artworkUrl: null,
      foundAt: '2027-07-14T11:00:00.000Z',
    },
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
