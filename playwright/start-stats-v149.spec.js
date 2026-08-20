const { test, expect } = require('@playwright/test');

const APPROVED_ARROW_PATH = 'M16.2 1.8 Q17 1 17.8 1.8 L30.2 13.1 Q31.2 14.1 30.1 15.2 Q29.7 15.6 29.1 15.6 H23.6 V33 H10.4 V15.6 H4.9 Q4.3 15.6 3.9 15.2 Q2.8 14.1 3.8 13.1 Z';

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}

test('v149 Start listening and concert stats cards share the approved structure', async ({ page }, testInfo) => {
  await openStart(page);

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => renderMyConcertsScreen());

    const listening = page.locator('#screen-myconcerts .start-top-bands-card');
    const concert = page.locator('#screen-myconcerts .stats-teaser-card');
    await expect(listening).toBeVisible();
    await expect(concert).toBeVisible();

    await expect(listening.locator('.start-stats-card-header-v149')).toHaveText('Listening stats');
    await expect(concert.locator('.start-stats-card-header-v149')).toHaveText('Concert stats');
    await expect(listening.locator('.start-toplist-heading-v149 p')).toHaveText('YOUR TOP BANDS · 2 WEEKS');
    await expect(listening.locator('#start-top-bands-view-all')).toHaveText('TOPLIST');
    await expect(listening).not.toContainText('View all');

    const metrics = await page.evaluate(() => {
      const listening = document.querySelector('#screen-myconcerts .start-top-bands-card');
      const concert = document.querySelector('#screen-myconcerts .stats-teaser-card');
      const listeningFooter = listening.querySelector('.listening-card-footer');
      const concertFooter = concert.querySelector('.stats-teaser-footer');
      const listeningTitle = listening.querySelector('.start-stats-card-header-v149 p');
      const concertTitle = concert.querySelector('.start-stats-card-header-v149 p');
      return {
        listeningBorder: getComputedStyle(listening).borderTopWidth,
        concertBorder: getComputedStyle(concert).borderTopWidth,
        listeningFooterHeight: listeningFooter.getBoundingClientRect().height,
        concertFooterHeight: concertFooter.getBoundingClientRect().height,
        listeningFooterWeight: getComputedStyle(listeningFooter).fontWeight,
        concertFooterWeight: getComputedStyle(concertFooter).fontWeight,
        listeningTitleColor: getComputedStyle(listeningTitle).color,
        concertTitleColor: getComputedStyle(concertTitle).color,
      };
    });

    expect(metrics.listeningBorder).toBe('1px');
    expect(metrics.concertBorder).toBe('1px');
    expect(Math.abs(metrics.listeningFooterHeight - metrics.concertFooterHeight)).toBeLessThanOrEqual(1);
    expect(metrics.listeningFooterHeight).toBeLessThanOrEqual(40);
    expect(metrics.listeningFooterWeight).toBe('400');
    expect(metrics.concertFooterWeight).toBe('400');
    expect(metrics.listeningTitleColor).toBe(metrics.concertTitleColor);

    await page.locator('#screen-myconcerts').screenshot({ path: testInfo.outputPath(`v149-start-stats-${width}px.png`) });
  }
});

test('v149 uses the approved thick ranking arrow for Top Bands and Top Tracks', async ({ page }) => {
  await openStart(page);

  const startArrow = page.locator('#screen-myconcerts .start-top-bands-card .rank-movement-v149').first();
  await expect(startArrow).toBeVisible();
  await expect(startArrow.locator('path')).toHaveAttribute('d', APPROVED_ARROW_PATH);

  const rendered = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `${movementHtml({ kind: 'up', delta: 2, label: 'Up 2' })}${movementHtml({ kind: 'down', delta: 3, label: 'Down 3' })}`;
    document.body.append(host);
    const arrows = [...host.querySelectorAll('.rank-movement-v149')].map((node) => ({
      className: node.className,
      path: node.querySelector('path')?.getAttribute('d'),
      transform: getComputedStyle(node.querySelector('svg')).transform,
      color: getComputedStyle(node).color,
    }));
    host.remove();
    return arrows;
  });

  expect(rendered).toHaveLength(2);
  expect(rendered[0].path).toBe(APPROVED_ARROW_PATH);
  expect(rendered[1].path).toBe(APPROVED_ARROW_PATH);
  expect(rendered[0].className).toContain('is-up');
  expect(rendered[1].className).toContain('is-down');
  expect(rendered[0].color).not.toBe(rendered[1].color);
  expect(rendered[1].transform).not.toBe('none');

  await page.evaluate(() => openTopBandsScreen({ timeframe: 'twoWeeks', mode: 'tracks' }));
  await expect(page.locator('#screen-top-bands')).toBeVisible();
  const trackMovement = page.locator('#screen-top-bands .toplist-track-row .rank-movement-v149').first();
  if (await trackMovement.count()) {
    await expect(trackMovement.locator('path')).toHaveAttribute('d', APPROVED_ARROW_PATH);
  }
});

test('v149 Stats header follows the selected Listening or Concerts view', async ({ page }, testInfo) => {
  await openStart(page);
  await page.locator('[data-tab="stats"]').click();
  await expect(page.locator('#screen-stats')).toBeVisible();

  const title = page.locator('#header-title');
  await expect(title).toHaveText('LISTENINGSTATS');
  await expect(title.locator('.brand-blue')).toHaveText('LISTENING');
  await page.locator('#screen-stats [data-stats-tab="concerts"]').click();
  await expect(title).toHaveText('CONCERTSTATS');
  await expect(title.locator('.brand-blue')).toHaveText('CONCERT');
  await page.screenshot({ path: testInfo.outputPath('v149-stats-concert-header.png'), fullPage: true });

  await page.locator('#screen-stats [data-stats-tab="listening"]').click();
  await expect(title).toHaveText('LISTENINGSTATS');
  await expect(title.locator('.brand-blue')).toHaveText('LISTENING');
  await page.screenshot({ path: testInfo.outputPath('v149-stats-listening-header.png'), fullPage: true });
});
