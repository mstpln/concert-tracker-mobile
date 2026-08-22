const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 900 }
    : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('AUB2 edits attended-card roles, survives failed writes, and updates performance stats', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);

  const pastCard = page.locator('.row-card-mc').filter({ has: page.locator('[data-lineup-role-toggle="qa-past-attended"]') });
  const pastBadge = pastCard.getByRole('button', { name: /Lineup role: Support/ });
  await expect(pastBadge).toBeVisible();
  const placement = await pastCard.evaluate((card) => {
    const name = card.querySelector('.row-name-line').getBoundingClientRect();
    const badge = card.querySelector('.lineup-role-badge').getBoundingClientRect();
    const metadata = card.querySelector('.row-sub').getBoundingClientRect();
    return { underName: badge.top >= name.bottom, beforeMetadata: badge.bottom <= metadata.top };
  });
  expect(placement).toEqual({ underName: true, beforeMetadata: true });

  await pastBadge.focus();
  await page.keyboard.press('Enter');
  const currentOption = pastCard.getByRole('button', { name: 'Support', exact: true });
  await expect(currentOption).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pastCard.locator('.lineup-role-selector')).toHaveCount(0);

  const upcomingCard = page.locator('.row-card-mc').filter({ has: page.locator('[data-lineup-role-toggle="qa-show-day"]') });
  await upcomingCard.getByRole('button', { name: /Lineup role: Headliner/ }).click();
  await page.evaluate(() => localStorage.setItem('livevault-qa:failures', JSON.stringify({ write: 'concerts.json' })));
  await upcomingCard.getByRole('button', { name: 'Support', exact: true }).click();
  await expect(upcomingCard.getByRole('status')).toHaveText('Could not save lineup role. Try again.');
  await expect(upcomingCard.getByRole('button', { name: /Lineup role: Headliner/ })).toBeVisible();
  await expect(upcomingCard.getByRole('button', { name: 'Headliner', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (testInfo.project.name === 'mobile-chromium') await upcomingCard.screenshot({ path: testInfo.outputPath('aub2-v155-selector-failure-375-light.png') });

  await page.evaluate(() => localStorage.removeItem('livevault-qa:failures'));
  await upcomingCard.getByRole('button', { name: 'Support', exact: true }).click();
  await expect(upcomingCard.getByRole('button', { name: /Lineup role: Support/ })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.find((concert) => concert.id === 'qa-show-day'));
  expect(stored.lineupRole).toBe('support');
  expect(stored.futureFeatureData).toEqual({ preserved: true, nested: { value: 'concert-preserve-me' } });

  await pastCard.getByRole('button', { name: /Lineup role: Support/ }).click();
  await pastCard.getByRole('button', { name: 'Headliner', exact: true }).click();
  await expect(pastCard.getByRole('button', { name: /Lineup role: Headliner/ })).toBeVisible();

  await page.locator('#tabbar [data-tab="stats"]').click();
  await page.getByRole('tab', { name: 'Concerts' }).click();
  const lineupSection = page.locator('.section-label', { hasText: 'Lineup role' });
  await expect(lineupSection).toBeVisible();
  const lineupGrid = lineupSection.locator('+ .stats-kpi-grid');
  await expect(lineupGrid).toContainText('1');
  await expect(lineupGrid).toContainText('headliner performances');
  await expect(lineupGrid).toContainText('100% of attended performances');
  await expect(lineupGrid).toContainText('0');
  await expect(lineupGrid).toContainText('support performances');
  await lineupGrid.screenshot({ path: testInfo.outputPath(`aub2-v155-lineup-stats-${testInfo.project.name}.png`) });

  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`aub2-v155-stats-${testInfo.project.name}.png`), fullPage: true });

  if (testInfo.project.name === 'mobile-chromium') {
    await page.locator('#tabbar [data-tab="myconcerts"]').click();
    await page.setViewportSize({ width: 480, height: 920 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.locator('.row-card-mc').filter({ has: page.locator('[data-lineup-role-toggle="qa-show-day"]') }).screenshot({ path: testInfo.outputPath('aub2-v155-card-480-light.png') });
  }
});
