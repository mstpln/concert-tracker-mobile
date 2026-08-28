const { test, expect } = require('@playwright/test');

const SEED = '11111111-1111-4111-8111-111111111111';
const candidateMbid = (n) => `600000${String(n).padStart(2, '0')}-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedDiscover(page) {
  await page.evaluate(({ seed, candidates }) => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data'));
    data.discoverRecommendations = {
      kind: 'bandmarkr-discover-recommendations',
      schemaVersion: 1,
      updatedAt: '2027-07-16T10:00:00.000Z',
      lastSuccessfulRefreshAt: '2027-07-16T10:00:00.000Z',
      groups: [{
        seedBandId: 'qa-seed',
        seedMbid: seed,
        seedName: 'Synthetic Seed Artist',
        createdAt: '2027-07-16T10:00:00.000Z',
        candidates: candidates.map((artistMbid, index) => ({
          artistMbid,
          name: `Recommended Artist ${index + 1}`,
          similarityScore: 100 - index,
          tags: index === 0 ? ['indie rock', 'dream pop'] : ['indie'],
          area: index === 0 ? 'Sweden' : null,
          beginYear: index === 0 ? 2014 : null,
          discoveredAt: '2027-07-16T10:00:00.000Z',
        })),
      }],
      decisions: {},
    };
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  }, { seed: SEED, candidates: Array.from({ length: 11 }, (_, index) => candidateMbid(index + 1)) });
  await page.reload();
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function openDiscoverBands(page) {
  await page.locator('#tabbar [data-tab="concerts"]').click();
  await expect(page.locator('#header-title')).toHaveText('DISCOVERCONCERTS');
  await expect(page.locator('.discover-subtabs')).toBeVisible();
  await expect(page.locator('.discover-subtabs .stats-subtab-btn')).toHaveCount(3);
  await page.locator('[data-discover-tab="bands"]').click();
  await expect(page.locator('#header-title')).toHaveText('DISCOVERBANDS');
}

test('v170 Discover Bands renders grouped recommendations and stays responsive from 320 to 480px', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedDiscover(page);
  await openDiscoverBands(page);

  await expect(page.locator('.discover-group h2')).toHaveText('Similar to Synthetic Seed Artist');
  await expect(page.locator('.discover-card')).toHaveCount(10);
  const first = page.locator('.discover-card').first();
  await expect(first).toContainText('Recommended Artist 1');
  await expect(first).toContainText('indie rock · dream pop');
  await expect(first).toContainText('Sweden');
  await expect(first).toContainText('Formed 2014');
  await expect(first.locator('.discover-spotify')).toHaveAttribute('href', 'https://open.spotify.com/search/Recommended%20Artist%201');

  for (const width of [320, 360, 375, 390, 414, 430, 480]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('v170 Add is durable, briefly confirms success, removes Dismiss and fills the hidden queue from the bottom', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await seedDiscover(page);
  await openDiscoverBands(page);

  const first = page.locator('.discover-card').first();
  await first.locator('[data-discover-add]').click();
  await expect(first.locator('[data-discover-add]')).toHaveText('Added ✓');
  await expect(first.locator('[data-discover-dismiss]')).toHaveCount(0);
  await expect(page.locator('.discover-card')).toHaveCount(10, { timeout: 2000 });
  await expect(page.locator('.discover-card').last()).toContainText('Recommended Artist 11');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')));
  const added = stored.bands.find((band) => band.name === 'Recommended Artist 1');
  expect(added).toBeTruthy();
  expect(added.musicbrainz.mbid).toBe(candidateMbid(1));
  expect(added.musicbrainz.status).toBe('manual_confirmed');
  expect(added.musicbrainz.discoverProvenance).toBeUndefined();
  expect(added.discoverRecommendation.source).toBe('listenbrainz_similar_artists');
  expect(added.artistEnrichment.status).toBe('retryable');
  expect(stored.discoverRecommendations.decisions[candidateMbid(1)].status).toBe('added');
  expect(stored.discoverRecommendations.decisions[candidateMbid(1)].addedBandId).toBe(added.id);
});

test('v170 Dismiss persists its decision and the recommendation stays gone after reload', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await seedDiscover(page);
  await openDiscoverBands(page);

  const target = `.discover-card[data-discover-mbid="${candidateMbid(1)}"]`;
  const first = page.locator(target);
  await first.locator('[data-discover-dismiss]').click();
  await expect(page.locator(target)).toHaveCount(0);
  const decision = await page.evaluate((mbid) => JSON.parse(localStorage.getItem('livevault-qa:data')).discoverRecommendations.decisions[mbid], candidateMbid(1));
  expect(decision.status).toBe('dismissed');

  await page.reload();
  await openDiscoverBands(page);
  await expect(page.locator(target)).toHaveCount(0);
});
