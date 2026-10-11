'use strict';
const { test, expect } = require('@playwright/test');

// Synthetic QA fixture only: no provider requests or production storage.
async function setup(page, width, colorScheme) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 880 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}
const pastSurface = scheme => scheme === 'dark' ? 'rgb(29, 33, 36)' : 'rgb(238, 241, 245)';

async function assertBlueCTA(locator) {
  await expect(locator).toHaveCSS('background-image', /radial-gradient.*linear-gradient/s);
  await expect(locator).toHaveCSS('color', 'rgb(255, 255, 255)');
}

for (const width of [320, 375, 480]) {
  for (const scheme of ['dark', 'light']) {
    test('v187 neutral history, consistent band cards, primary CTAs and glow at ' + width + 'px ' + scheme, async ({ page }, testInfo) => {
      await setup(page, width, scheme);
      const surface = pastSurface(scheme);

      // Primary Music tabs retain the approved first-letter lighting.
      const primary = page.locator('#music-tab-highlights');
      await expect(primary).toHaveCSS('background-image', /linear-gradient/);
      await expect.poll(() => primary.evaluate(el => el.style.getPropertyValue('--v186-first-letter-x'))).toMatch(/px$/);
      const frame = page.locator('#screen-myconcerts .myconcerts-summary > .start-top-bands-card');
      const frameGlow = await frame.evaluate(el => getComputedStyle(el).boxShadow);
      expect(frameGlow).toContain('rgba(61, 128, 250, 0.24)');
      await expect(frame).toHaveCSS('border-top-width', '1px');

      await page.locator('#music-tab-concerts').click();
      const group = page.locator('#screen-myconcerts .music-history-tabs-v183');
      const groupHeight = await group.evaluate(el => el.getBoundingClientRect().height);
      for (const tab of ['upcoming', 'past', 'cancelled']) {
        const button = group.locator('[data-my-history-tab="' + tab + '"]');
        await button.click();
        await expect(button).toHaveCSS('background-image', 'none');
        const style = await button.evaluate(el => ({
          pseudoContent: getComputedStyle(el, '::before').content,
          pseudoImage: getComputedStyle(el, '::before').backgroundImage,
          glyphX: el.style.getPropertyValue('--v186-first-letter-x'),
          height: el.getBoundingClientRect().height,
        }));
        expect(style.pseudoContent).toBe('none');
        expect(style.pseudoImage).toBe('none');
        expect(style.glyphX).toBe('');
        expect(style.height).toBe(42);
        await expect(page.locator('#my-history-' + tab)).toBeVisible();
      }
      expect(await group.evaluate(el => el.getBoundingClientRect().height)).toBe(groupHeight);
      await assertBlueCTA(page.locator('#past-concert-submit'));

      // My Bands: list rows use the concert color, not the page/grey-form fill.
      await page.locator('#tabbar [data-tab="mybands"]').click();
      const cards = page.locator('#screen-mybands .row-card.clickable[data-band-id]');
      expect(await cards.count()).toBeGreaterThan(0);
      await expect(cards.first()).toHaveCSS('background-color', surface);
      await expect(page.locator('#screen-mybands .add-band-card')).not.toHaveCSS('background-color', surface);
      const pageColor = await page.locator('#content').evaluate(el => getComputedStyle(el).backgroundColor);
      expect(pageColor).not.toBe(surface);
      const grey = page.locator('#screen-mybands .toggle-pill:not(.active)').first();
      await expect(grey).toHaveCSS('background-image', 'none');
      await assertBlueCTA(page.locator('#add-band-submit'));

      // Page headers: only the blue word gets the subdued neon treatment.
      const headerAccent = page.locator('#app-header .header-title .brand-blue');
      await expect(headerAccent).toBeVisible();
      await expect(headerAccent).toHaveCSS('background-image', /linear-gradient/);
      await expect(headerAccent).toHaveCSS('-webkit-text-fill-color', 'rgba(0, 0, 0, 0)');
      const glow = await headerAccent.evaluate(el => getComputedStyle(el).textShadow);
      expect(glow).not.toBe('none');
      await page.screenshot({ path: testInfo.outputPath('v187-bands-' + width + '-' + scheme + '.png') });

      // Official site is a solid-blue CTA even though it is an anchor.
      await page.evaluate(() => {
        bands[0].officialUrl = 'https://example.invalid/synthetic-official';
        openProfile(bands[0].id);
      });
      const official = page.locator('#screen-profile a.btn-primary').filter({ hasText: 'Official site' }).first();
      await expect(official).toBeVisible();
      await assertBlueCTA(official);

      // Discover uses a separate action class, not .btn-primary.
      await page.evaluate(() => {
        const wrapper = document.createElement('div');
        wrapper.className = 'discover-actions';
        const button = document.createElement('button');
        button.className = 'discover-add';
        button.textContent = 'Synthetic add';
        wrapper.appendChild(button);
        document.querySelector('#screen-concerts').appendChild(wrapper);
      });
      await assertBlueCTA(page.locator('#screen-concerts .discover-actions .discover-add').last());
      await page.locator('#tabbar [data-tab="concerts"]').click();
      await expect(page.locator('#app-header .header-title .brand-blue')).toHaveCSS('background-image', /linear-gradient/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }
}
