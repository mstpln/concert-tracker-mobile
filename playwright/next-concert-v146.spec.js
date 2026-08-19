const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}

async function appDate(page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const date = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, offsetDays);
}

function displayDate(date) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

async function render(page, date, overrides = {}) {
  await page.evaluate(({ date, overrides }) => {
    const concert = {
      id: 'qa-v146', bandId: 'qa-artist', bandName: 'LE SSERAFIM', date, time: '20:00', venue: 'Royal Arena',
      address: 'Hannemanns Alle 18-20', postalCode: '2300', city: 'Copenhagen', country: 'Denmark',
      latitude: 55.5, longitude: 12.6, attending: true, ownedTickets: [], ticketQuantity: 4, ...overrides,
    };
    document.querySelector('#screen-myconcerts').innerHTML = window.countdownCardHtml(concert);
  }, { date, overrides });
  return page.locator('#countdown-card');
}

test('v146 normal day uses calendar countdown, grey contour and softened side perforations', async ({ page }, testInfo) => {
  await openStart(page);
  const future = await appDate(page, 30);
  await page.setViewportSize({ width: 375, height: 900 });
  const card = await render(page, future);

  await expect(card).toHaveAttribute('data-today', 'false');
  const overlay = card.locator('.countdown-v146-ticket-contour');
  await expect(overlay).toHaveCount(1);
  const contourStyles = await overlay.evaluate((node) => ({
    fill: getComputedStyle(node).fill,
    stroke: getComputedStyle(node).stroke,
    strokeWidth: getComputedStyle(node).strokeWidth,
  }));
  expect(contourStyles.fill).toBe('rgb(0, 0, 0)');
  expect(contourStyles.stroke).toBe('rgb(181, 183, 188)');
  expect(contourStyles.strokeWidth).toBe('1.5px');
  await expect(card.locator('.countdown-ticket-tear')).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(card.locator('.countdown-ticket-inner-frame').first()).toHaveCSS('stroke', 'rgb(255, 255, 255)');

  const path = await overlay.getAttribute('d');
  expect(path).toContain('M11 1 L441 1 C442 11 452 18 468 18 C484 18 494 11 495 1');
  expect(path).toContain('Q809 17 805 17 C797 17 797 35 805 35 Q809 35 809 39');
  expect(path).toContain('L495 462 C494 452 484 445 468 445 C452 445 442 452 441 462');
  expect(path).toContain('Q11 35 15 35 C23 35 23 17 15 17 Q11 17 11 13');

  const stub = card.locator('.countdown-v146-calendar-stub');
  await expect(stub).toBeVisible();
  await expect(stub.locator('.countdown-v146-calendar-label')).toHaveText('DATE');
  await expect(stub.locator('.countdown-v146-calendar-date')).toHaveText(displayDate(future));
  await expect(stub.locator('#countdown-ring-day')).toBeVisible();
  const visibleDays = await stub.locator('#countdown-ring-day').textContent();
  expect(Number(visibleDays)).toBeGreaterThan(0);
  await expect(stub.locator('#countdown-d')).toHaveText(visibleDays);
  expect(await stub.locator('.countdown-v139-stub-content').evaluate((node) => getComputedStyle(node, '::after').content)).toBe('"DAYS LEFT"');
  await expect(stub.locator('.countdown-v139-time')).toBeVisible();
  expect(await card.locator('.countdown-v140-date').evaluate((node) => getComputedStyle(node).opacity)).toBe('0');

  const flush = await stub.evaluate((node) => {
    const head = node.querySelector('.countdown-v146-calendar-head').getBoundingClientRect();
    const stub = node.getBoundingClientRect();
    return {
      left: Math.abs(head.left - stub.left),
      right: Math.abs(head.right - stub.right),
      top: Math.abs(head.top - stub.top),
    };
  });
  expect(flush.left).toBeLessThanOrEqual(0.1);
  expect(flush.right).toBeLessThanOrEqual(0.1);
  expect(flush.top).toBeLessThanOrEqual(0.1);

  const fontFamilies = await card.evaluate((node) => ({
    card: getComputedStyle(node).fontFamily,
    date: getComputedStyle(node.querySelector('.countdown-v146-calendar-date')).fontFamily,
    day: getComputedStyle(node.querySelector('#countdown-ring-day')).fontFamily,
  }));
  expect(fontFamilies.date).toBe(fontFamilies.card);
  expect(fontFamilies.day).toBe(fontFamilies.card);

  await card.screenshot({ path: testInfo.outputPath('v146-next-concert-375px.png') });
});

test('v146 calendar remains single-frame and contained after later visual refinements', async ({ page }) => {
  await openStart(page);
  const future = await appDate(page, 30);
  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await render(page, future);
    const metrics = await card.evaluate((node) => {
      const cardRect = node.getBoundingClientRect();
      const stub = node.querySelector('.countdown-v146-calendar-stub');
      const stubRect = stub.getBoundingClientRect();
      const style = getComputedStyle(stub);
      return {
        left: (stubRect.left - cardRect.left) / cardRect.width,
        top: (stubRect.top - cardRect.top) / cardRect.height,
        width: stubRect.width / cardRect.width,
        height: stubRect.height / cardRect.height,
        boxShadow: style.boxShadow,
        overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    // v147 intentionally refines the exact inset; this historical test keeps
    // guarding the v146 single-frame/contained contract. Current geometry is
    // locked precisely by start-visual-v147.spec.js.
    expect(metrics.left).toBeGreaterThan(0.63);
    expect(metrics.left).toBeLessThan(0.66);
    expect(metrics.top).toBeGreaterThan(0.10);
    expect(metrics.top).toBeLessThan(0.13);
    expect(metrics.width).toBeGreaterThan(0.27);
    expect(metrics.width).toBeLessThan(0.30);
    expect(metrics.height).toBeGreaterThan(0.74);
    expect(metrics.height).toBeLessThan(0.80);
    expect(metrics.boxShadow).toBe('none');
    expect(metrics.overflow).toBe(true);
  }
});

test('v146 quantity DOM remains compatible after later spacing refinements', async ({ page }) => {
  await openStart(page);
  const future = await appDate(page, 30);
  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await render(page, future);
    const metrics = await card.locator('.countdown-v140-ticket-count').evaluate((node) => ({
      originalOpacity: Array.from(node.querySelectorAll('.countdown-v140-ticket-count-line')).map((line) => getComputedStyle(line).opacity),
      lineCount: node.querySelectorAll('.countdown-v140-ticket-count-line').length,
      beforeContent: getComputedStyle(node, '::before').content,
      afterContent: getComputedStyle(node, '::after').content,
    }));
    // v147 restores the original v140 line nodes to get equal visible gaps;
    // the exact pixel spacing is locked by start-visual-v147.spec.js.
    expect(metrics.lineCount).toBe(2);
    expect(metrics.originalOpacity).toEqual(['1', '1']);
    expect(metrics.beforeContent).toBe('none');
    expect(metrics.afterContent).toBe('none');
  }
});

test('v146 calendar keeps the established live countdown IDs updating', async ({ page }) => {
  await openStart(page);
  const future = await appDate(page, 30);
  const card = await render(page, future);
  const beforeSeconds = await card.locator('#countdown-s').textContent();
  const beforeOffset = await card.locator('#countdown-ring-inner').getAttribute('stroke-dashoffset');
  const after = await page.evaluate(() => {
    const current = dlCurrentDate();
    window.__LIVEVAULT_QA_NOW__ = new Date(current.getTime() + 1000).toISOString();
    tickCountdownCard();
    return {
      seconds: document.querySelector('#countdown-s').textContent,
      offset: document.querySelector('#countdown-ring-inner').getAttribute('stroke-dashoffset'),
      days: document.querySelector('#countdown-ring-day').textContent,
    };
  });
  expect(after.seconds).not.toBe(beforeSeconds);
  expect(after.offset).not.toBe(beforeOffset);
  expect(Number(after.days)).toBeGreaterThanOrEqual(0);
});

test('v146 does not alter the concert-day ticket presentation', async ({ page }, testInfo) => {
  await openStart(page);
  const today = await appDate(page, 0);
  await page.setViewportSize({ width: 375, height: 900 });
  const card = await render(page, today, {
    ownedTickets: [{ id: 'qa-ticket', type: 'url', url: 'https://qa.invalid/ticket', addedAt: '2026-01-01T00:00:00.000Z' }],
  });
  await expect(card).toHaveAttribute('data-today', 'true');
  await expect(card.locator('.countdown-v146-ticket-contour')).toHaveCount(0);
  await expect(card.locator('.countdown-v146-calendar-head')).toHaveCount(0);
  await expect(card.locator('.countdown-ticket-contour')).toHaveCSS('stroke', 'rgb(255, 255, 255)');
  await expect(card.getByRole('link', { name: 'Get directions' })).toBeVisible();
  const ticket = card.getByRole('link', { name: 'Open tickets' });
  await expect(ticket).toBeVisible();
  await expect(ticket).toHaveCSS('background-color', 'rgb(94, 216, 255)');
  await card.screenshot({ path: testInfo.outputPath('v146-show-day-375px.png') });
});