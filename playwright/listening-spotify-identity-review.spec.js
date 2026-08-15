const { test, expect } = require('@playwright/test');

async function seedSpotifyReview(page) {
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
    window.__rawHistoryReads = 0;
    window.LiveVaultSpotifyHistory = {
      loadEvents: async () => {
        window.__rawHistoryReads += 1;
        return [...listeningEvents];
      },
    };
  });
}

test('v94 Spotify identity review remains local, session-deferred, and mobile-safe in Settings v123', async ({ page }) => {
  const browserErrors = [];
  const providerRequests = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    if (/api\.spotify\.com|accounts\.spotify\.com/.test(request.url())) providerRequests.push(request.url());
  });
  await page.goto('/');
  await seedSpotifyReview(page);

  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const screen = page.locator('#screen-settings');
  const item = screen.locator('[data-v123-artist-review]').filter({ hasText: 'A Very Long Synthetic Candidate Artist Name That Must Wrap Safely' });
  await expect(item).toBeVisible();
  await expect(item).toContainText('Spotify needs you to confirm the artist match.');
  await expect(item.getByRole('button', { name: 'Use this artist' })).toHaveCount(1);
  await expect(item.getByRole('button', { name: 'None of these' })).toHaveCount(1);
  await expect(item.getByRole('button', { name: 'Later' })).toHaveCount(1);
  await expect(screen).not.toContainText('Synthetic Artist Without Candidate');

  await item.getByRole('button', { name: 'Later' }).click();
  await expect(item).toHaveCount(0);
  await expect(screen).toContainText('Deferred for this session.');

  await screen.getByRole('tab', { name: 'Automation', exact: true }).click();
  await screen.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(item).toHaveCount(0);

  const state = await page.evaluate(() => ({ rawHistoryReads: window.__rawHistoryReads }));
  expect(state.rawHistoryReads).toBe(0);
  const overflow = await screen.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(overflow).toBe(false);
  expect(providerRequests).toEqual([]);
  expect(browserErrors).toEqual([]);

  await page.reload();
  await seedSpotifyReview(page);
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(page.locator('#screen-settings').locator('[data-v123-artist-review]').filter({ hasText: 'A Very Long Synthetic Candidate Artist Name That Must Wrap Safely' })).toBeVisible();
});
