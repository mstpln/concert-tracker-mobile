const { test, expect } = require('@playwright/test');

async function openSettings(page) {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('Settings v123 uses one consistent Automation presentation', async ({ page }) => {
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await expect(screen.getByRole('tab', { name:'Automation' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByText('PROVIDER USAGE', { exact:true })).toBeVisible();
  await expect(screen.getByText('UPDATE ACTIVITY', { exact:true })).toBeVisible();
  await expect(screen.getByText('Ticketmaster', { exact:true })).toBeVisible();
  await expect(screen.getByText('MusicBrainz', { exact:true })).toBeVisible();
  await expect(screen.getByText('ListenBrainz', { exact:true })).toBeVisible();
  await expect(screen.locator('.settings-v123-section')).toHaveCount(2);
  const divider = screen.locator('.settings-v123-section').nth(1);
  await expect(divider).toHaveCSS('border-top-width','2px');
  await expect(divider).toHaveCSS('border-top-color','rgb(11, 99, 246)');
  expect(await screen.locator('.settings-v123-progress').count()).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
});

test('Review summary stays neutral, truthful and horizontal on narrow mobile widths', async ({ page }) => {
  await page.setViewportSize({ width:360, height:800 });
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name:'Review' }).click();
  await expect(screen.getByRole('tab', { name:'Review' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByText('REVIEW SUMMARY', { exact:true })).toBeVisible();
  const pills = screen.locator('.settings-v123-summary-grid > span');
  await expect(pills).toHaveCount(3);
  await expect(pills.nth(2)).toContainText('Total items');
  const pillValues = await pills.locator('b').allTextContents();
  expect(Number(pillValues[2])).toBe(Number(pillValues[0]) + Number(pillValues[1]));
  const boxes = await pills.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y))).toBeLessThan(2);
  expect(boxes.every((box) => box.width > 70)).toBe(true);
  const colors = await pills.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  expect(new Set(colors).size).toBe(1);
  const reviewStatuses = screen.locator('.settings-v123-review-item .settings-v123-status');
  if (await reviewStatuses.count()) {
    const statusColors = await reviewStatuses.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
    expect(new Set(statusColors).size).toBe(1);
    await expect(reviewStatuses.first()).toContainText('Needs review');
  }
  await expectNoHorizontalOverflow(page);
});

test('Data presents coverage, connections, export and device controls without old branding', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name:'Data' }).click();
  await expect(screen.getByText('DATA COVERAGE', { exact:true })).toBeVisible();
  await expect(screen.getByText('CONNECTIONS', { exact:true })).toBeVisible();
  await expect(screen.getByText('EXPORT', { exact:true })).toBeVisible();
  await expect(screen.getByText('DEVICE', { exact:true })).toBeVisible();
  for (const label of ['ARTIST IDS','ARTIST PROFILES','CONCERT DATA','LISTENING DATA']) {
    await expect(screen.getByText(label, { exact:true })).toBeVisible();
  }
  await expect(screen.getByText('Images', { exact:true })).toBeVisible();
  await expect(screen.getByText('Descriptions', { exact:true })).toBeVisible();
  await expect(screen.getByText('Venue information', { exact:true })).toBeVisible();
  await expect(screen.getByText('Songs identified', { exact:true })).toBeVisible();
  await expect(screen.getByText('Album artwork', { exact:true })).toBeVisible();
  await expect(screen).not.toContainText('Live Vault');
  await expect(screen).not.toContainText('LiveVault');
  await expect(screen.locator('.settings-v123-section')).toHaveCount(4);
  await expect(screen.locator('.settings-v123-maintenance')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const width of [360,390,430]) {
  test(`Settings remains contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height:900 });
    await openSettings(page);
    const screen = page.locator('#screen-settings');
    for (const tab of ['Automation','Review','Data']) {
      await screen.getByRole('tab', { name:tab }).click();
      await expectNoHorizontalOverflow(page);
    }
  });
}
