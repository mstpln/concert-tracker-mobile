const { test, expect } = require('@playwright/test');

test('v129 renders past state, divider and perceptible request feedback', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const visual = await page.evaluate(() => {
    window.__LIVEVAULT_QA_NOW__ = '2026-08-15T12:00:00.000Z';
    bands = [{ id: 'v129-band', name: 'V129 Band', genre: 'Rock', socials: {} }];
    concerts = [
      { id: 'v129-upcoming', bandId: 'v129-band', bandName: 'V129 Band', date: '2026-08-20', venue: 'Future Hall', city: 'Test City', country: 'Denmark', attending: true },
      { id: 'v129-past', bandId: 'v129-band', bandName: 'V129 Band', date: '2026-08-10', venue: 'Past Hall', city: 'Test City', country: 'Denmark', attending: true },
    ];
    listeningEvents = [];
    renderMyConcertsScreen();
    LiveVaultStateFeedbackIntegrationV129.decoratePastDivider();
    const past = document.querySelector('#screen-myconcerts .row-card-mc.is-past');
    const divider = document.querySelector('#screen-myconcerts .myconcerts-past-divider');
    return {
      hasPast: Boolean(past),
      pastBackground: past ? getComputedStyle(past).backgroundColor : '',
      dividerText: divider?.textContent?.trim() || '',
      progressHeight: getComputedStyle(document.getElementById('interaction-progress')).height,
    };
  });

  expect(visual.hasPast).toBe(true);
  expect(visual.dividerText.toLowerCase()).toBe('past concerts');
  expect(visual.progressHeight).toBe('0px');

  const lifecycle = await page.evaluate(async () => {
    const feedback = LiveVaultInteractionFeedbackV129;
    const first = feedback.begin({ key: 'qa:slow', delayMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 35));
    const visibleDuring = document.getElementById('interaction-progress').classList.contains('is-active');
    const duplicate = feedback.begin({ key: 'qa:slow', delayMs: 20 });
    feedback.end(first);
    const visibleAfter = document.getElementById('interaction-progress').classList.contains('is-active');
    return { visibleDuring, duplicateWasSuppressed: duplicate === null, visibleAfter };
  });

  expect(lifecycle).toEqual({ visibleDuring: true, duplicateWasSuppressed: true, visibleAfter: false });
  expect(pageErrors).toEqual([]);
});

test('v129 reduced motion keeps the processing segment static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const style = await page.evaluate(async () => {
    const handle = LiveVaultInteractionFeedbackV129.begin({ key: 'qa:motion', delayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const segment = document.querySelector('#interaction-progress span');
    const result = { animationName: getComputedStyle(segment).animationName, transform: getComputedStyle(segment).transform };
    LiveVaultInteractionFeedbackV129.end(handle);
    return result;
  });
  expect(style.animationName).toBe('none');
  expect(style.transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
});
