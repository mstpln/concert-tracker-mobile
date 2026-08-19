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

async function renderNextConcert(page, date) {
  await page.evaluate((concertDate) => {
    const concert = {
      id: 'qa-v147',
      bandId: 'qa-artist',
      bandName: 'LE SSERAFIM',
      date: concertDate,
      time: '20:00',
      venue: 'Royal Arena',
      address: 'Hannemanns Alle 18-20',
      postalCode: '2300',
      city: 'Copenhagen',
      country: 'Denmark',
      latitude: 55.5,
      longitude: 12.6,
      attending: true,
      ownedTickets: [],
      ticketQuantity: 4,
    };
    document.querySelector('#screen-myconcerts').innerHTML = window.countdownCardHtml(concert);
  }, date);
  return page.locator('#countdown-card');
}

test('v147 calendar underlaps the existing frame and keeps the countdown centered', async ({ page }, testInfo) => {
  await openStart(page);
  const future = await appDate(page, 65);

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await renderNextConcert(page, future);
    const metrics = await card.evaluate((node) => {
      const cardRect = node.getBoundingClientRect();
      const stub = node.querySelector('.countdown-v146-calendar-stub');
      const stubRect = stub.getBoundingClientRect();
      const headRect = stub.querySelector('.countdown-v146-calendar-head').getBoundingClientRect();
      const dayRect = stub.querySelector('#countdown-ring-day').getBoundingClientRect();
      const timerRect = stub.querySelector('.countdown-v139-time').getBoundingClientRect();
      const ticketRect = node.querySelector('.countdown-v140-ticket-count strong').getBoundingClientRect();
      const labelStyle = getComputedStyle(stub.querySelector('.countdown-v146-calendar-label'));
      const dateStyle = getComputedStyle(stub.querySelector('.countdown-v146-calendar-date'));
      const dayStyle = getComputedStyle(stub.querySelector('#countdown-ring-day'));
      const cardStyle = getComputedStyle(node);
      const stubStyle = getComputedStyle(stub);
      return {
        left: (stubRect.left - cardRect.left) / cardRect.width,
        top: (stubRect.top - cardRect.top) / cardRect.height,
        width: stubRect.width / cardRect.width,
        height: stubRect.height / cardRect.height,
        headTopGap: Math.abs(headRect.top - stubRect.top),
        headLeftGap: Math.abs(headRect.left - stubRect.left),
        headRightGap: Math.abs(headRect.right - stubRect.right),
        dayCenterX: dayRect.left + dayRect.width / 2,
        stubCenterX: stubRect.left + stubRect.width / 2,
        timerCenterY: timerRect.top + timerRect.height / 2,
        ticketCenterY: ticketRect.top + ticketRect.height / 2,
        labelWeight: labelStyle.fontWeight,
        dateWeight: dateStyle.fontWeight,
        dayFont: dayStyle.fontFamily,
        cardFont: cardStyle.fontFamily,
        boxShadow: stubStyle.boxShadow,
        radius: stubStyle.borderTopLeftRadius,
      };
    });

    // One SVG unit of underlap beneath the 3-unit frame stroke prevents its
    // antialiased inner edge from exposing a dark seam around the white head.
    // Ratios are normalized but still subject to browser pixel rounding.
    expect(metrics.left).toBeCloseTo(0.640854, 3);
    expect(metrics.top).toBeCloseTo(0.109071, 3);
    expect(metrics.width).toBeCloseTo(0.289024, 3);
    expect(metrics.height).toBeCloseTo(0.781857, 3);
    expect(metrics.headTopGap).toBeLessThanOrEqual(0.1);
    expect(metrics.headLeftGap).toBeLessThanOrEqual(0.1);
    expect(metrics.headRightGap).toBeLessThanOrEqual(0.1);
    expect(Math.abs(metrics.dayCenterX - metrics.stubCenterX)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.timerCenterY - metrics.ticketCenterY)).toBeLessThanOrEqual(4);
    expect(Number(metrics.labelWeight)).toBeGreaterThanOrEqual(800);
    expect(metrics.dateWeight).toBe('790');
    expect(metrics.dayFont).toBe(metrics.cardFont);
    expect(metrics.boxShadow).toBe('none');
    // Chromium keeps percentage radii in percentage form through CSSOM. That
    // is the scaling contract: the corner follows the proportional ticket box
    // instead of being frozen to a viewport-specific pixel value.
    expect(metrics.radius).toContain('%');
    expect(metrics.radius).toContain('6.962%');
    await card.screenshot({ path: testInfo.outputPath(`v147-next-concert-${width}px.png`) });
  }
});

test('v147 retains the canonical ticket quantity DOM contract after later presentation refinements', async ({ page }) => {
  await openStart(page);
  const future = await appDate(page, 65);

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await renderNextConcert(page, future);
    const contract = await card.locator('.countdown-v140-ticket-count').evaluate((node) => ({
      lineCount: node.querySelectorAll('.countdown-v140-ticket-count-line').length,
      text: node.querySelector('strong')?.textContent,
      ariaLabel: node.getAttribute('aria-label'),
      beforeContent: getComputedStyle(node, '::before').content,
      afterContent: getComputedStyle(node, '::after').content,
    }));

    // v148 intentionally changes the visible quantity presentation. This
    // historical test keeps the v140/v147 DOM/data compatibility contract;
    // current pill/line visibility is locked by next-concert-v148.spec.js.
    expect(contract.lineCount).toBe(2);
    expect(contract.text).toBe('4 TICKETS');
    expect(contract.ariaLabel).toBe('4 tickets');
    expect(contract.beforeContent).toBe('none');
    expect(contract.afterContent).toBe('none');
  }
});

test('v147 Concert Stats matches the single-pixel card outline and regular CTA weight', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openStart(page);

  const stats = page.locator('#screen-myconcerts .stats-teaser-card');
  await expect(stats).toBeVisible();
  const styles = await stats.evaluate((node) => {
    const footer = node.querySelector('.stats-teaser-footer');
    const cardStyle = getComputedStyle(node);
    const footerStyle = getComputedStyle(footer);
    return {
      borderTopWidth: cardStyle.borderTopWidth,
      borderRightWidth: cardStyle.borderRightWidth,
      boxShadow: cardStyle.boxShadow,
      footerWeight: footerStyle.fontWeight,
    };
  });
  expect(styles.borderTopWidth).toBe('1px');
  expect(styles.borderRightWidth).toBe('1px');
  expect(styles.boxShadow).toBe('none');
  expect(styles.footerWeight).toBe('400');

  await page.locator('#screen-myconcerts').screenshot({ path: testInfo.outputPath('v147-start-375px.png') });
});
