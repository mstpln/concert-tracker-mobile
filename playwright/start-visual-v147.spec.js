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

test('v147 calendar meets the existing frame and keeps the countdown centered', async ({ page }) => {
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
        boxShadow: getComputedStyle(stub).boxShadow,
      };
    });

    expect(metrics.left).toBeCloseTo(0.6421, 3);
    expect(metrics.top).toBeCloseTo(0.1112, 3);
    expect(metrics.width).toBeCloseTo(0.2866, 3);
    expect(metrics.height).toBeCloseTo(0.7775, 3);
    expect(metrics.headTopGap).toBeLessThanOrEqual(0.1);
    expect(metrics.headLeftGap).toBeLessThanOrEqual(0.1);
    expect(metrics.headRightGap).toBeLessThanOrEqual(0.1);
    expect(Math.abs(metrics.dayCenterX - metrics.stubCenterX)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.timerCenterY - metrics.ticketCenterY)).toBeLessThanOrEqual(4);
    expect(Number(metrics.labelWeight)).toBeGreaterThanOrEqual(800);
    expect(metrics.dateWeight).toBe('790');
    expect(metrics.dayFont).toBe(metrics.cardFont);
    expect(metrics.boxShadow).toBe('none');
  }
});

test('v147 restores equal visible spacing around the ticket quantity', async ({ page }) => {
  await openStart(page);
  const future = await appDate(page, 65);

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await renderNextConcert(page, future);
    const gaps = await card.locator('.countdown-v140-ticket-count').evaluate((node) => {
      const lines = node.querySelectorAll('.countdown-v140-ticket-count-line');
      const text = node.querySelector('strong').getBoundingClientRect();
      const upper = lines[0].getBoundingClientRect();
      const lower = lines[1].getBoundingClientRect();
      return {
        upperOpacity: getComputedStyle(lines[0]).opacity,
        lowerOpacity: getComputedStyle(lines[1]).opacity,
        above: text.top - upper.bottom,
        below: lower.top - text.bottom,
        beforeContent: getComputedStyle(node, '::before').content,
        afterContent: getComputedStyle(node, '::after').content,
      };
    });

    expect(gaps.upperOpacity).toBe('1');
    expect(gaps.lowerOpacity).toBe('1');
    expect(gaps.above).toBeCloseTo(4, 1);
    expect(gaps.below).toBeCloseTo(4, 1);
    expect(Math.abs(gaps.above - gaps.below)).toBeLessThanOrEqual(0.25);
    expect(gaps.beforeContent).toBe('none');
    expect(gaps.afterContent).toBe('none');
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
