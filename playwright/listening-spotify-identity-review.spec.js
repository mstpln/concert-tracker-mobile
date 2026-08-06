const { test, expect } = require('@playwright/test');

test('v94 Spotify identity review is local, deterministic, and mobile-safe', async ({ page }) => {
  const browserErrors = [];
  const providerRequests = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    if (/api\.spotify\.com|accounts\.spotify\.com/.test(request.url())) providerRequests.push(request.url());
  });
  await page.goto('/');

  await page.evaluate(() => {
    bands = [
      {
        id: 'qa-candidate',
        name: 'A Very Long Synthetic Candidate Artist Name That Must Wrap Safely',
        favorite: true,
        notes: 'preserve',
        musicbrainz: {
          mbid: 'qa-mbid-candidate',
          status: 'confirmed',
          ticketmaster: { id: 'qa-tm-candidate', status: 'confirmed' },
          spotify: {
            status: 'needs_review',
            reviewCandidates: [{
              id: 'qaSpotifyCandidate123',
              artistName: 'A Very Long Synthetic Candidate Artist Name That Must Wrap Safely',
              url: 'https://open.spotify.com/artist/qaSpotifyCandidate123',
              disambiguation: 'Synthetic review candidate',
            }],
          },
        },
      },
      {
        id: 'qa-acquisition',
        name: 'Synthetic Artist Without Candidate',
        musicbrainz: { mbid: 'qa-mbid-acquisition', status: 'confirmed', spotify: { status: 'no_match' } },
      },
    ];
    listeningEvents = [
      { stableListenId: 'qa-listen-1', bandId: 'qa-candidate', playedAt: new Date(Date.now() - 86400000).toISOString(), source: 'spotify', spotifyTrackId: 'qa-track-1' },
      { stableListenId: 'qa-listen-2', bandId: 'qa-acquisition', playedAt: new Date(Date.now() - 86400000 * 30).toISOString(), source: 'spotify', spotifyTrackId: 'qa-track-2' },
    ];
  });

  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const section = page.locator('#spotify-identity-review-section');
  await expect(section).toBeVisible();
  await expect(section).toContainText('2 unresolved');
  await expect(section).toContainText('1 ready to review');
  await expect(section).toContainText('1 need candidate acquisition');
  await expect(section).toContainText('Synthetic Artist Without Candidate');
  await expect(section).toContainText('Candidate acquisition required');
  await expect(section.getByRole('button', { name: 'Use this artist' })).toHaveCount(1);
  await expect(section.getByRole('button', { name: 'None of these' })).toHaveCount(1);
  await expect(section.getByRole('link', { name: 'Open Spotify' })).toHaveAttribute('href', 'https://open.spotify.com/artist/qaSpotifyCandidate123');

  const overflow = await section.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(overflow).toBe(false);
  expect(providerRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});
