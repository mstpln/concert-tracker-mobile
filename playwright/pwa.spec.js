const { test, expect } = require('@playwright/test');

test('QA PWA installs an isolated service worker and serves the shell offline', async ({ page, context }) => {
  await page.goto('/');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.json');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const registration = await page.evaluate(async () => {
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker readiness timed out')), 10000)),
    ]);
    return {
      scriptURL: ready.active?.scriptURL || '',
      state: ready.active?.state || '',
    };
  });

  expect(registration.scriptURL).toMatch(/\/service-worker\.js$/);
  expect(registration.state).toBe('activated');

  const cacheKeys = await page.evaluate(() => caches.keys());
  const qaCaches = cacheKeys.filter((key) => key.startsWith('concert-tracker-qa-v68-'));
  expect(qaCaches).toHaveLength(1);
  expect(cacheKeys.some((key) => key.startsWith('concert-tracker-shell-'))).toBe(false);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#onboarding')).toBeHidden();
  } finally {
    await context.setOffline(false);
  }
});
