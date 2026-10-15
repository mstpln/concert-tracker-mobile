const { test, expect } = require('@playwright/test');

// These UI tests exercise the connection screen, not offline caching.
// The dedicated PWA suite verifies service-worker behavior.
test.use({ serviceWorkers: 'block' });

test('QA preview shows the branded Bandmarkr connection screen without changing the app shell', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto('/');
  await page.getByTestId('qa-screen').selectOption('connect');

  await expect(page.getByTestId('qa-banner')).toContainText('QA');
  await expect(page.getByTestId('qa-screen')).toHaveValue('connect');
  await expect(page.locator('#onboarding')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.getByText('Bandmarkr', { exact: true })).toBeVisible();
  await expect(page.locator('.onboarding-brand-copy > span')).toHaveText('Music that leaves a mark.');
  await expect(page.locator('.onboarding-kicker')).toHaveText('From headphones to the front row.');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/A home for the\s*music you love/);
  await expect(page.locator('.onboarding-intro')).toHaveText('Log the shows you go to, follow the bands you love, and explore your concert and listening stats.');
  await expect(page.locator('.form-step, .onboarding-note')).toHaveCount(0);
  await expect(page.locator('.onboarding-icon')).toHaveAttribute('src', 'icons/icon-192.png?v=197');
  await expect(page.getByLabel('Worker URL')).toBeVisible();
  await expect(page.getByLabel('Access token')).toHaveAttribute('type', 'password');
  await expect(page.getByRole('link', { name: 'Worker setup guide' })).toHaveAttribute('href', /\/SETUP\.md$/);

  const guideResponse = await page.request.get('/SETUP.md');
  expect(guideResponse.ok()).toBe(true);

  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHorizontalOverflow).toBe(true);

  await page.getByRole('button', { name: /Connect to Bandmarkr/ }).click();
  await expect(page.getByRole('alert')).toContainText('Enter both the Worker URL and the access token.');
});

test('Bandmarkr connection screen adapts to a wide desktop preview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?qa-screen=connect');
  await expect(page.locator('#onboarding')).toBeVisible();

  const layout = await page.locator('.onboarding-inner').evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      columns: styles.gridTemplateColumns.split(' ').length,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(layout.columns).toBe(2);
  expect(layout.noHorizontalOverflow).toBe(true);
});

test('the original tablet-sized preview keeps the connection action in view', async ({ page }) => {
  await page.setViewportSize({ width: 757, height: 732 });
  await page.goto('/?qa-screen=connect');
  await expect(page.locator('#onboarding')).toBeVisible();

  const layout = await page.locator('.onboarding-inner').evaluate((element) => {
    const styles = getComputedStyle(element);
    const button = document.querySelector('#connect-submit').getBoundingClientRect();
    return {
      columns: styles.gridTemplateColumns.split(' ').length,
      connectVisible: button.bottom <= window.innerHeight,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(layout.columns).toBe(2);
  expect(layout.connectVisible).toBe(true);
  expect(layout.noHorizontalOverflow).toBe(true);
});

for (const submitWith of ['button', 'Enter']) {
  test(`connection form opens the app using ${submitWith} with synthetic QA credentials only`, async ({ page }) => {
    const externalRequests = [];
    page.on('request', request => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') externalRequests.push(request.url());
    });
    await page.goto('/?qa-screen=connect');
    await expect(page.locator('#onboarding')).toBeVisible();
    await page.locator('#connect-endpoint').fill('https://qa.invalid');
    await page.locator('#connect-token').fill('qa-synthetic-token');
    if (submitWith === 'Enter') await page.locator('#connect-token').press('Enter');
    else await page.locator('#connect-submit').click();
    await expect(page.locator('#onboarding')).toBeHidden();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
    await expect(page.locator('#onboarding-error')).toBeHidden();
    expect(externalRequests).toEqual([]);
  });
}
