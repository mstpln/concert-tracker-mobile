'use strict';
const { test, expect } = require('@playwright/test');

// Entirely synthetic: no user R2 records or live provider APIs.
const SEED = '11111111-1111-4111-8111-111111111111';
const RECOMMENDED = '60000001-aaaa-4aaa-8aaa-000000000001';

async function openSyntheticApp(page, width, colorScheme) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedSyntheticDiscover(page) {
  await page.evaluate(({ seed, mbid }) => {
    const key = 'livevault-qa:data';
    const data = JSON.parse(localStorage.getItem(key));
    data.discoverRecommendations = {
      kind: 'bandmarkr-discover-recommendations',
      schemaVersion: 1,
      updatedAt: '2027-07-16T10:00:00.000Z',
      lastSuccessfulRefreshAt: '2027-07-16T10:00:00.000Z',
      groups: [{
        seedBandId: 'synthetic-seed',
        seedMbid: seed,
        seedName: 'Synthetic Seed Artist',
        createdAt: '2027-07-16T10:00:00.000Z',
        candidates: [{
          artistMbid: mbid,
          name: 'Synthetic Spotify Candidate',
          similarityScore: 95,
          tags: ['indie rock'],
          area: 'Sweden',
          beginYear: 2014,
          discoveredAt: '2027-07-16T10:00:00.000Z',
        }],
      }],
      decisions: {},
    };
    localStorage.setItem(key, JSON.stringify(data));
  }, { seed: SEED, mbid: RECOMMENDED });
  await page.reload();
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

for (const width of [375, 480]) {
  for (const colorScheme of ['dark', 'light']) {
    test('v192 matte Spotify + unchanged Settings Blue Light ' + width + 'px ' + colorScheme, async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openSyntheticApp(page, width, colorScheme);

      // Approved blue CTA and Highlights stats-frame remain the references.
      const statsFrame = page.locator('#screen-myconcerts .myconcerts-summary > .start-top-bands-card');
      await expect(statsFrame).toHaveCSS('border-top-width', '1px');
      await expect(statsFrame).toHaveCSS('box-shadow', /rgba\(61, 128, 250, 0\.24\)/);
      await seedSyntheticDiscover(page);
      await page.locator('#tabbar [data-tab="concerts"]').click();
      await page.locator('[data-discover-tab="bands"]').click();
      const card = page.locator('.discover-card').first();
      await expect(card).toContainText('Synthetic Spotify Candidate');
      const spotify = card.locator('a.discover-spotify');
      await expect(spotify).toBeVisible();
      await expect(spotify).toHaveCSS('background-image', /linear-gradient.*linear-gradient/s);
      await expect(spotify).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(spotify).toHaveAttribute('href', 'https://open.spotify.com/search/Synthetic%20Spotify%20Candidate');
      const green = await spotify.evaluate(el => ({
        background: getComputedStyle(el).backgroundImage,
        dimensions: { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height },
        iconPresent: !!el.querySelector('svg'),
        label: el.textContent.trim(),
      }));
      expect(green.background).toContain('rgb(20, 135, 73)');
      expect(green.background).toContain('rgba(255, 255, 255, 0.08)');
      expect(green.background).not.toContain('radial-gradient');
      expect(green.background).not.toContain('rgb(8, 78, 40)');
      await expect(spotify).toHaveCSS('border-top-width', '1px');
      await expect(spotify).toHaveCSS('border-top-color', 'rgb(21, 150, 74)');
      await expect(spotify).toHaveCSS('box-shadow', 'none');
      expect(green.dimensions.height).toBeGreaterThanOrEqual(34);
      expect(green.iconPresent).toBe(true);
      expect(green.label).toBe('Spotify');
      const add = card.locator('.discover-add');
      await expect(add).toHaveCSS('background-image', /radial-gradient.*linear-gradient/s);
      await expect(card.locator('.discover-dismiss')).toHaveCSS('background-image', 'none');
      await page.screenshot({ path: info.outputPath('v192-discover-' + width + '-' + colorScheme + '.png') });

      await page.getByTestId('settings-button').click();
      await expect(page.locator('#screen-settings')).toBeVisible();
      const automation = page.locator('#screen-settings .settings-v123-section');
      await expect(automation).toHaveCount(2);
      const separator = automation.nth(1);
      await expect(separator).toHaveCSS('border-top-width', '2px');
      await expect(separator).toHaveCSS('border-top-color', 'rgb(2, 77, 223)');
      const divider = await separator.evaluate(el => {
        const s = getComputedStyle(el, '::before');
        return { content: s.content, gradient: s.backgroundImage, glow: s.boxShadow, height: s.height };
      });
      expect(divider.content).not.toBe('none');
      expect(divider.gradient).toContain('linear-gradient');
      expect(divider.gradient).toContain('rgba(132, 186, 255, 0.97)');
      expect(divider.glow).toContain('rgba(61, 128, 250, 0.22)');
      expect(divider.height).toBe('2px');

      const accent = page.locator('#screen-settings .settings-v123-section-accent').first();
      const accentStyle = await accent.evaluate(el => {
        const s = getComputedStyle(el);
        return { width: s.width, gradient: s.backgroundImage, glow: s.boxShadow };
      });
      expect(accentStyle.width).toBe('4px');
      expect(accentStyle.gradient).toContain('linear-gradient');
      expect(accentStyle.gradient).toContain('rgba(132, 186, 255, 0.97)');
      expect(accentStyle.glow).toContain('rgba(61, 128, 250, 0.22)');
      await page.screenshot({ path: info.outputPath('v191-settings-' + width + '-' + colorScheme + '.png') });

      // All three Settings tabs use the same rules, with no layout expansion.
      for (const tab of ['Review', 'Data']) {
        await page.locator('#screen-settings').getByRole('tab', { name: tab }).click();
        const sectionCount = await page.locator('#screen-settings .settings-v123-section').count();
        expect(sectionCount).toBeGreaterThanOrEqual(2);
        await expect(page.locator('#screen-settings .settings-v123-section').nth(1)).toHaveCSS('border-top-width', '2px');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
