const { test, expect } = require('@playwright/test');

const KLAXONS_MBID = '12345678-1234-4123-8123-1234567890ab';
const SEED_MBID = '87654321-4321-4321-8321-ba0987654321';

function viewportFor(testInfo) {
  return testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 900 }
    : { width: 480, height: 900 };
}

async function openApp(page, testInfo) {
  await page.setViewportSize(viewportFor(testInfo));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function installKlaxonsScenario(page) {
  await page.evaluate(({ candidateMbid, seedMbid }) => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const existing = {
      id: 'qa-v171-klaxons',
      name: 'Klaxons',
      favorite: true,
      notes: 'preserve this user note',
      futureField: { preserve: true },
      musicbrainz: {
        ticketmaster: {
          id: 'K8vZ917GZ57',
          attractionName: 'Klaxons',
          status: 'manual_confirmed',
          confidence: 'user_confirmed',
          matchMethod: 'user_approved_exact_id',
          futureProviderField: 'keep-me',
        },
      },
    };
    data.bands = [...(data.bands || []).filter((band) => band.id !== existing.id && band.name !== 'Klaxons'), existing];
    data.discoverRecommendations = {
      kind: 'bandmarkr-discover-recommendations',
      schemaVersion: 1,
      updatedAt: '2026-08-28T10:00:00.000Z',
      lastSuccessfulRefreshAt: '2026-08-28T10:00:00.000Z',
      groups: [{
        seedBandId: 'qa-v171-seed',
        seedMbid,
        seedName: 'QA Seed',
        createdAt: '2026-08-28T10:00:00.000Z',
        candidates: [{
          artistMbid: candidateMbid,
          name: 'Klaxons',
          similarityScore: 98,
          tags: ['indie rock'],
          area: 'United Kingdom',
          beginYear: 2005,
          discoveredAt: '2026-08-28T10:00:00.000Z',
        }],
      }],
      decisions: {},
    };
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  }, { candidateMbid: KLAXONS_MBID, seedMbid: SEED_MBID });
  await page.reload();
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

test('v171 highlights MUSIC and ALERTS in their compound headers', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await expect(page.locator('#header-title')).toHaveText('MYMUSIC');
  await expect(page.locator('#header-title .brand-blue')).toHaveText('MUSIC');

  await page.locator('#tabbar [data-tab="news"]').click();
  await expect(page.locator('#header-title')).toHaveText('CONCERTALERTS');
  await expect(page.locator('#header-title .brand-blue')).toHaveText('ALERTS');
});

test('v171 moves Discover geographic filters below the primary tabs with matching height', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await page.locator('#tabbar [data-tab="concerts"]').click();
  const tabs = page.locator('.discover-subtabs');
  const filters = page.locator('.discover-geo-filters-v171');
  await expect(tabs).toBeVisible();
  await expect(filters).toBeVisible();
  await expect(filters.locator('[data-discover-geo]')).toHaveCount(3);
  await expect(filters.locator('[data-discover-geo="nearby"]')).toHaveText('Nearby');
  await expect(filters.locator('[data-discover-geo="sweden"]')).toHaveText('SE');
  await expect(filters.locator('[data-discover-geo="europe"]')).toHaveText('EU');

  const geometry = await page.evaluate(() => ({
    primary: document.querySelector('.discover-subtabs .stats-subtab-btn').getBoundingClientRect().height,
    secondary: document.querySelector('.discover-geo-filter-btn-v171').getBoundingClientRect().height,
    sourceDisplays: ['nearby-toggle-btn', 'sweden-toggle-btn', 'europe-toggle-btn'].map((id) => getComputedStyle(document.getElementById(id)).display),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(Math.abs(geometry.primary - geometry.secondary)).toBeLessThanOrEqual(0.5);
  expect(geometry.sourceDisplays).toEqual(['none', 'none', 'none']);
  expect(geometry.overflow).toBe(false);

  await filters.locator('[data-discover-geo="sweden"]').click();
  await expect(filters.locator('[data-discover-geo="sweden"]')).toHaveClass(/active/);
  await expect(filters.locator('[data-discover-geo="europe"]')).not.toHaveClass(/active/);

  await page.locator('[data-discover-tab="venues"]').click();
  await expect(page.locator('.discover-geo-filters-v171')).toHaveCount(0);
});

test('v171 Add links one exact-name existing band in place without losing Ticketmaster or user data', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await installKlaxonsScenario(page);
  await page.locator('#tabbar [data-tab="concerts"]').click();
  await page.locator('[data-discover-tab="bands"]').click();
  const card = page.locator(`.discover-card[data-discover-mbid="${KLAXONS_MBID}"]`);
  await expect(card).toContainText('Klaxons');
  await card.locator('[data-discover-add]').click();
  await expect(card.locator('[data-discover-add]')).toHaveText('Added ✓');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')));
  const matches = stored.bands.filter((band) => band.name === 'Klaxons');
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toBe('qa-v171-klaxons');
  expect(matches[0].favorite).toBe(true);
  expect(matches[0].notes).toBe('preserve this user note');
  expect(matches[0].futureField).toEqual({ preserve: true });
  expect(matches[0].musicbrainz.ticketmaster.id).toBe('K8vZ917GZ57');
  expect(matches[0].musicbrainz.ticketmaster.futureProviderField).toBe('keep-me');
  expect(matches[0].musicbrainz.mbid).toBe(KLAXONS_MBID);
  expect(matches[0].musicbrainz.status).toBe('manual_confirmed');
  expect(stored.discoverRecommendations.decisions[KLAXONS_MBID].addedBandId).toBe('qa-v171-klaxons');
});

test('v171 Band Data does not claim Setlist.fm MBID linkage before MusicBrainz is confirmed', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await installKlaxonsScenario(page);
  await page.evaluate(() => openProfile('qa-v171-klaxons'));
  await page.locator('[data-profile-tab="data"]').click();
  await expect(page.locator('#screen-profile')).toContainText('MusicBrainz');
  await expect(page.locator('#screen-profile')).toContainText('Not yet checked');
  await expect(page.locator('#screen-profile')).toContainText('Waiting for MusicBrainz identity');
  await expect(page.locator('#screen-profile')).not.toContainText('Linked through the confirmed MusicBrainz MBID');
});
