const { test, expect } = require('@playwright/test');

async function installSyntheticProviderStubs(page) {
  await page.route('https://example.invalid/images/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#1261ff"/></svg>',
    });
  });

  await page.evaluate(() => {
    const upstreamFetch = window.fetch.bind(window);
    const observerKey = Symbol.for('livevault.gau3.artist-enrichment-fetch-observer');
    const observer = window.fetch[observerKey] || null;

    function observeNonOk(url, response) {
      if (!observer?.contexts || response?.ok !== false) return response;
      for (const context of observer.contexts) {
        try {
          if (context.matches(url)) context.nonOk = true;
        } catch (_) {}
      }
      return response;
    }

    const syntheticFetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      let response = null;
      if (url.hostname === 'en.wikipedia.org' && url.pathname.includes('/w/api.php')) {
        const search = url.searchParams.get('search') || '';
        response = search === 'Synthetic Wikipedia Failure'
          ? new Response(JSON.stringify([search, [search], [], []]), { status: 503, headers: { 'Content-Type': 'application/json' } })
          : new Response(JSON.stringify([search, [search], [], []]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else if (url.hostname === 'en.wikipedia.org' && url.pathname.includes('/api/rest_v1/page/summary/')) {
        response = new Response(JSON.stringify({ extract: 'Synthetic Wikipedia context for browser QA.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (url.hostname === 'text.pollinations.ai') {
        response = new Response(JSON.stringify({
          genre: 'Synthetic rock',
          origin: 'Sweden',
          formedYear: '2026',
          bio: 'Generated synthetic biography from the existing add-band enrichment path.',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else if (url.hostname === 'example.invalid' && url.pathname === '/official-failure') {
        response = new Response('<html><head><title>Temporarily unavailable</title><meta property="og:image" content="https://example.invalid/images/error.svg"></head><body>Retry later</body></html>', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        });
      } else if (url.hostname === 'example.invalid' && url.pathname === '/official-success') {
        response = new Response('<html><head><title>Synthetic official site</title><meta property="og:image" content="https://example.invalid/images/official-success.svg"></head><body>Synthetic artist home page.</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (response) return observeNonOk(url, response);
      return upstreamFetch(input, options);
    };

    if (observer) Object.defineProperty(syntheticFetch, observerKey, { value: observer, enumerable: false });
    window.fetch = syntheticFetch;
  });
}

async function addManualBand(page, name, officialUrl = '') {
  await page.getByRole('button', { name: 'Bands' }).click();
  const screen = page.locator('#screen-mybands');
  await screen.locator('#add-band-name').fill(name);
  if (officialUrl) await screen.locator('#add-band-url').fill(officialUrl);
  await screen.locator('#add-band-submit').click();
  await expect(screen.getByText(name, { exact: true })).toBeVisible();
}

async function readStoredBand(page, name) {
  return page.evaluate((bandName) => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    return (data.bands || []).find((band) => band.name === bandName) || null;
  }, name);
}

test('manual add enrichment exposes only trusted Spotify artwork and preserves manual artwork', async ({ page }) => {
  await page.goto('/');
  await installSyntheticProviderStubs(page);

  await addManualBand(page, 'Synthetic Added Artist');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Added Artist'))?.artistEnrichment?.status).toBe('complete');
  const enriched = await readStoredBand(page, 'Synthetic Added Artist');
  expect(enriched.id).toBe('synthetic-added-artist');
  expect(enriched.generatedBio).toContain('Generated synthetic biography');
  expect(enriched.bio ?? null).toBeNull();

  await addManualBand(page, 'Synthetic Manual Artwork');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Manual Artwork'))?.artistEnrichment?.status).toBe('complete');

  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const providerBand = data.bands.find((band) => band.name === 'Synthetic Added Artist');
    providerBand.musicbrainz = {
      ...(providerBand.musicbrainz || {}),
      spotify: {
        id: 'spotify-trusted-artist',
        status: 'confirmed',
        artistName: providerBand.name,
        images: [{ url: 'https://example.invalid/images/trusted-artist.svg', width: 640, height: 640 }],
      },
    };
    const manualBand = data.bands.find((band) => band.name === 'Synthetic Manual Artwork');
    manualBand.photoUrl = 'https://example.invalid/images/manual-artist.svg';
    manualBand.musicbrainz = {
      ...(manualBand.musicbrainz || {}),
      spotify: {
        id: 'spotify-other-artist',
        status: 'manual_confirmed',
        artistName: manualBand.name,
        images: [{ url: 'https://example.invalid/images/provider-other.svg', width: 640, height: 640 }],
      },
    };
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  });

  await page.reload();
  await installSyntheticProviderStubs(page);
  await page.getByRole('button', { name: 'Bands' }).click();

  await page.locator('#screen-mybands').getByText('Synthetic Added Artist', { exact: true }).click();
  const trustedImage = page.locator('#screen-profile .profile-avatar img');
  await expect(trustedImage).toHaveAttribute('src', 'https://example.invalid/images/trusted-artist.svg');
  await expect.poll(async () => trustedImage.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#screen-profile')).toContainText('Generated synthetic biography');

  await page.getByTestId('back-button').click();
  await page.locator('#screen-mybands').getByText('Synthetic Manual Artwork', { exact: true }).click();
  const manualImage = page.locator('#screen-profile .profile-avatar img');
  await expect(manualImage).toHaveAttribute('src', 'https://example.invalid/images/manual-artist.svg');
  await expect.poll(async () => manualImage.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('unconfirmed Spotify candidate stays initials-only', async ({ page }) => {
  await page.goto('/');
  await installSyntheticProviderStubs(page);
  await addManualBand(page, 'Synthetic Candidate Only');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Candidate Only'))?.artistEnrichment?.status).toBe('complete');

  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const band = data.bands.find((item) => item.name === 'Synthetic Candidate Only');
    band.musicbrainz = {
      ...(band.musicbrainz || {}),
      spotify: {
        id: null,
        status: 'needs_review',
        reviewCandidates: [{
          id: 'spotify-untrusted-candidate',
          artistName: band.name,
          images: [{ url: 'https://example.invalid/images/untrusted.svg', width: 640, height: 640 }],
        }],
      },
    };
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  });

  await page.reload();
  await installSyntheticProviderStubs(page);
  await page.getByRole('button', { name: 'Bands' }).click();
  await page.locator('#screen-mybands').getByText('Synthetic Candidate Only', { exact: true }).click();
  await expect(page.locator('#screen-profile .profile-avatar img')).toHaveCount(0);
  await expect(page.locator('#screen-profile .profile-avatar')).toContainText('SC');
});

test('non-OK Wikipedia and official-site responses remain retryable and their payloads are discarded', async ({ page }) => {
  await page.goto('/');
  await installSyntheticProviderStubs(page);

  await addManualBand(page, 'Synthetic Wikipedia Failure');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Wikipedia Failure'))?.artistEnrichment?.status).toBe('retryable');
  const wikipediaFailure = await readStoredBand(page, 'Synthetic Wikipedia Failure');
  expect(wikipediaFailure.artistEnrichment.errorCategory).toContain('wikipedia');
  expect(wikipediaFailure.generatedBio).toContain('Generated synthetic biography');
  expect(Date.parse(wikipediaFailure.artistEnrichment.nextEligibleCheckAt)).toBeGreaterThan(Date.parse(wikipediaFailure.artistEnrichment.lastAttemptedAt));

  await addManualBand(page, 'Synthetic Official Failure', 'https://example.invalid/official-failure');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Official Failure'))?.artistEnrichment?.status).toBe('retryable');
  const officialFailure = await readStoredBand(page, 'Synthetic Official Failure');
  expect(officialFailure.artistEnrichment.errorCategory).toContain('official_site');
  expect(officialFailure.artistArtwork?.officialSite).toBeUndefined();
});

test('adding an official URL through Edit schedules and completes refreshed official artwork', async ({ page }) => {
  await page.goto('/');
  await installSyntheticProviderStubs(page);

  await addManualBand(page, 'Synthetic Official Edit');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Official Edit'))?.artistEnrichment?.status).toBe('complete');

  await page.locator('#screen-mybands').getByText('Synthetic Official Edit', { exact: true }).click();
  await page.locator('#screen-profile').getByRole('button', { name: 'Edit band' }).click();
  await page.locator('#screen-profile .edit-url').fill('https://example.invalid/official-success');
  await page.locator('#screen-profile .edit-save').click();

  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Official Edit'))?.officialUrl).toBe('https://example.invalid/official-success');
  await expect.poll(async () => (await readStoredBand(page, 'Synthetic Official Edit'))?.artistEnrichment?.status).toBe('complete');
  const refreshed = await readStoredBand(page, 'Synthetic Official Edit');
  expect(refreshed.artistArtwork.officialSite.url).toBe('https://example.invalid/images/official-success.svg');
  expect(refreshed.artistArtwork.officialSite.sourceUrl).toBe('https://example.invalid/official-success');
  expect(refreshed.artistArtwork.officialSite.source).toBe('official_site_og_image');
  await expect(page.locator('#screen-profile .profile-avatar img')).toHaveAttribute('src', 'https://example.invalid/images/official-success.svg');
});
