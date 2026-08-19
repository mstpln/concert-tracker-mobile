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
      id: 'qa-v148',
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

test('v148 changes only the approved normal-day ticket details and preserves v147 countdown geometry', async ({ page }, testInfo) => {
  await openStart(page);
  const future = await appDate(page, 65);

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await renderNextConcert(page, future);
    const metrics = await card.evaluate((node) => {
      const cardRect = node.getBoundingClientRect();
      const stub = node.querySelector('.countdown-v146-calendar-stub');
      const stubRect = stub.getBoundingClientRect();
      const countdown = stub.querySelector('.countdown-v139-countdown');
      const daysLeft = stub.querySelector('.countdown-v139-stub-content');
      const timer = stub.querySelector('.countdown-v139-time');
      const count = node.querySelector('.countdown-v140-ticket-count');
      const countText = count.querySelector('strong');
      const lines = count.querySelectorAll('.countdown-v140-ticket-count-line');
      const leftFrame = node.querySelector('.countdown-ticket-inner-frame:not(.countdown-v148-right-frame-base)');
      const rightBase = node.querySelector('.countdown-v148-right-frame-base');
      const rightOverlay = node.querySelector('.countdown-v148-right-frame');
      const contour = node.querySelector('.countdown-v146-ticket-contour');
      const stubStyle = getComputedStyle(stub);
      const timerStyle = getComputedStyle(timer);
      const countStyle = getComputedStyle(countText);
      const pillStyle = getComputedStyle(countText, '::before');
      return {
        stubLeft: (stubRect.left - cardRect.left) / cardRect.width,
        stubTop: (stubRect.top - cardRect.top) / cardRect.height,
        stubWidth: stubRect.width / cardRect.width,
        stubHeight: stubRect.height / cardRect.height,
        countdownTop: getComputedStyle(countdown).top,
        daysLeftAfterTop: getComputedStyle(daysLeft, '::after').top,
        timerTop: timerStyle.top,
        timerWeight: timerStyle.fontWeight,
        stubRadius: stubStyle.borderTopLeftRadius,
        countColor: countStyle.color,
        pillBorderColor: pillStyle.borderTopColor,
        pillBorderRadius: pillStyle.borderTopLeftRadius,
        pillHeight: pillStyle.height,
        countCenterX: count.getBoundingClientRect().left + count.getBoundingClientRect().width / 2,
        leftLaneCenterX: cardRect.left + cardRect.width * (0.0683 + 0.4366 / 2),
        lineOpacity: [...lines].map((line) => getComputedStyle(line).opacity),
        leftStroke: getComputedStyle(leftFrame).strokeWidth,
        rightBaseOpacity: getComputedStyle(rightBase).opacity,
        rightStroke: getComputedStyle(rightOverlay).strokeWidth,
        rightAttrs: ['x', 'y', 'width', 'height', 'rx'].map((name) => rightOverlay.getAttribute(name)),
        leftAttrs: ['x', 'y', 'width', 'height', 'rx'].map((name) => leftFrame.getAttribute(name)),
        contourStroke: getComputedStyle(contour).strokeWidth,
      };
    });

    // These are the merged v147 calendar values. v148 must not move them.
    expect(metrics.stubLeft).toBeCloseTo(0.640854, 3);
    expect(metrics.stubTop).toBeCloseTo(0.109071, 3);
    expect(metrics.stubWidth).toBeCloseTo(0.289024, 3);
    expect(metrics.stubHeight).toBeCloseTo(0.781857, 3);
    expect(metrics.countdownTop).toBe('1%');
    expect(metrics.daysLeftAfterTop).toBe('59%');
    expect(metrics.timerTop).toBe('75%');
    expect(metrics.stubRadius).toContain('6.962%');

    expect(metrics.timerWeight).toBe('400');
    expect(metrics.countColor).toBe('rgb(201, 201, 206)');
    expect(metrics.pillBorderColor).toBe('rgb(201, 201, 206)');
    expect(parseFloat(metrics.pillBorderRadius)).toBeGreaterThan(10);
    expect(metrics.pillHeight).toBe('24px');
    expect(Math.abs(metrics.countCenterX - metrics.leftLaneCenterX)).toBeLessThanOrEqual(1);
    expect(metrics.lineOpacity).toEqual(['0', '0']);

    expect(metrics.leftStroke).toBe('3px');
    expect(metrics.rightBaseOpacity).toBe('0');
    expect(metrics.rightStroke).toBe('3px');
    expect(metrics.rightAttrs).toEqual(['525', '50', '238', '363', '17']);
    expect(metrics.leftAttrs).toEqual(['56', '50', '358', '363', '17']);
    expect(metrics.contourStroke).toBe('1.1px');

    await card.screenshot({ path: testInfo.outputPath(`v148-next-concert-${width}px.png`) });
  }
});

test('v148 leaves concert-day presentation on the established v140 path', async ({ page }) => {
  await openStart(page);
  const today = await appDate(page, 0);
  const card = await renderNextConcert(page, today);

  await expect(card).toHaveClass(/countdown-card-today/);
  await expect(card.locator('.countdown-v148-right-frame-overlay')).toHaveCount(0);
  await expect(card.locator('.countdown-v140-ticket-count')).toHaveCount(0);
  await expect(card.locator('.countdown-v139-directions')).toBeVisible();
});
