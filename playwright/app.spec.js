const { test, expect } = require('@playwright/test');

const LOCAL_ORIGIN = 'http://127.0.0.1:4173';
const SYNTHETIC_ORIGINS = new Set([LOCAL_ORIGIN, 'https://qa.invalid', 'https://example.invalid']);

async function installQaGuards(page) {
  const unexpectedRequests = [];
  const pageErrors = [];
  const consoleErrors = [];

  await page.route('https://example.invalid/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  page.on('request', (request) => {
    const origin = new URL(request.url()).origin;
    if (!SYNTHETIC_ORIGINS.has(origin)) unexpectedRequests.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  return () => {
    expect(unexpectedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  };
}

test('synthetic app starts, navigates, persists checklist, and resets', async ({ page }, testInfo) => {
  const assertQaGuards = await installQaGuards(page);

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#onboarding')).toBeHidden();

  await page.getByRole('button', { name: 'Bands' }).click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`), fullPage: true });

  await page.getByRole('button', { name: 'Concerts' }).click();
  const prepGroup = page.locator('.concert-prep-group[data-concert-id="qa-show-day"]');
  await prepGroup.locator('[data-prep-toggle="checklist"]').click();

  const prepKey = await prepGroup.locator('input[data-prep-key]:not(:checked)').first().getAttribute('data-prep-key');
  expect(prepKey).toBeTruthy();
  const targetCheckbox = prepGroup.locator(`input[data-prep-key="${prepKey}"]`);
  await expect(targetCheckbox).toBeVisible();
  await targetCheckbox.click();

  await expect.poll(async () => page.evaluate(({ concertId, key }) => {
    const stored = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const concert = (stored.concerts || []).find((item) => item.id === concertId);
    return concert?.prepChecklist?.[key] === true;
  }, { concertId: 'qa-show-day', key: prepKey })).toBe(true);

  await page.reload();
  const reloadedGroup = page.locator('.concert-prep-group[data-concert-id="qa-show-day"]');
  await reloadedGroup.locator('[data-prep-toggle="checklist"]').click();
  await expect(reloadedGroup.locator(`input[data-prep-key="${prepKey}"]`)).toBeChecked();

  await page.getByTestId('qa-reset').click();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('qa-banner')).toBeVisible();

  const storageKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(storageKeys).not.toContain('concertTrackerRemoteConnection');
  expect(storageKeys).not.toContain('concertTrackerSettings');
  expect(storageKeys).not.toContain('spotifyUserAuthorization');
  expect(storageKeys).not.toContain('spotifyUserPkcePending');

  assertQaGuards();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('primary screens, settings, and band profile tabs remain navigable', async ({ page }) => {
  const assertQaGuards = await installQaGuards(page);

  await page.goto('/');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();

  await page.getByRole('button', { name: 'Dates' }).click();
  await expect(page.locator('#screen-concerts')).toBeVisible();

  await page.getByRole('button', { name: 'Alerts' }).click();
  await expect(page.locator('#screen-news')).toBeVisible();

  await page.getByRole('button', { name: 'Bands' }).click();
  const bandsScreen = page.locator('#screen-mybands');
  await expect(bandsScreen).toBeVisible();
  await bandsScreen.getByText('QA Artist One', { exact: true }).click();
  await expect(page.locator('#screen-profile')).toBeVisible();

  for (const tabName of ['Concerts', 'Alerts', 'News', 'Data']) {
    await page.getByRole('tab', { name: tabName, exact: true }).click();
    await expect(page.getByRole('tab', { name: tabName, exact: true })).toHaveAttribute('aria-selected', 'true');
  }

  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();

  await page.getByTestId('settings-button').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();

  assertQaGuards();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});
