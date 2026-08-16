const { test, expect } = require('@playwright/test');

test('v132 renders aligned two-line listening row and contained visible feedback', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const visual = await page.evaluate(() => {
    const screen = document.getElementById('screen-myconcerts');
    const divider = document.createElement('div');
    divider.className = 'section-label section-label-gap-lg';
    divider.textContent = 'Past concerts';
    const past = document.createElement('article');
    past.className = 'row-card row-card-mc is-past';
    past.textContent = 'Synthetic past concert';
    screen.append(divider, past);
    const progress = document.getElementById('interaction-progress');
    const app = document.getElementById('app');
    return {
      pastBackground: getComputedStyle(past).backgroundColor,
      dividerText: divider.textContent.trim(),
      dividerDisplay: getComputedStyle(divider).display,
      progressHeight: getComputedStyle(progress).height,
      progressLeft: progress.getBoundingClientRect().left,
      progressRight: progress.getBoundingClientRect().right,
      appLeft: app.getBoundingClientRect().left,
      appRight: app.getBoundingClientRect().right,
    };
  });

  expect(visual.pastBackground).toBe('rgb(29, 33, 36)');
  expect(visual.dividerText.toLowerCase()).toBe('past concerts');
  expect(visual.dividerDisplay).toBe('flex');
  expect(visual.progressHeight).toBe('3px');
  expect(visual.progressLeft).toBeGreaterThanOrEqual(visual.appLeft);
  expect(visual.progressRight).toBeLessThanOrEqual(visual.appRight);

  const firstFrame = await page.evaluate(() => {
    const feedback = LiveVaultInteractionFeedbackV129;
    const handle = feedback.begin({ key: 'qa:immediate', delayMs: 0 });
    const progress = document.getElementById('interaction-progress');
    const segment = progress.querySelector('span');
    const trackRect = progress.getBoundingClientRect();
    const segmentRect = segment.getBoundingClientRect();
    const result = {
      visibleImmediately: progress.classList.contains('is-active'),
      segmentStartsVisible: segmentRect.left >= trackRect.left && segmentRect.left < trackRect.right,
      segmentContained: segmentRect.right <= trackRect.right,
    };
    feedback.end(handle);
    return result;
  });
  expect(firstFrame).toEqual({ visibleImmediately: true, segmentStartsVisible: true, segmentContained: true });

  const alignment = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'row-card-mc';
    host.innerHTML = `
      <div class="concert-listening-row">${icon('headphones')}<span><strong>Your listening</strong><small>53 min · 19 listens</small></span></div>
      <div class="concert-prep-group"><button class="concert-prep-row">${icon('weather')}<span><strong>Weather forecast</strong><small>Available later</small></span></button></div>
    `;
    document.body.appendChild(host);
    const listening = host.querySelector('.concert-listening-row');
    const listeningIcon = listening.querySelector('svg').getBoundingClientRect();
    const listeningText = listening.querySelector('span').getBoundingClientRect();
    const listeningTitle = listening.querySelector('strong').getBoundingClientRect();
    const listeningMeta = listening.querySelector('small').getBoundingClientRect();
    const prep = host.querySelector('.concert-prep-row');
    const prepText = prep.querySelector('span').getBoundingClientRect();
    const result = {
      iconWidth: listeningIcon.width,
      iconHeight: listeningIcon.height,
      textDelta: Math.abs(listeningText.left - prepText.left),
      titleAndMetaStacked: listeningMeta.top >= listeningTitle.bottom,
    };
    host.remove();
    return result;
  });
  expect(alignment.iconWidth).toBe(15);
  expect(alignment.iconHeight).toBe(15);
  expect(alignment.textDelta).toBeLessThanOrEqual(1);
  expect(alignment.titleAndMetaStacked).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('v132 keeps fast local feedback visible without keeping the action blocked', async ({ page }) => {
  await page.goto('/');
  const lifecycle = await page.evaluate(async () => {
    const button = document.createElement('button');
    button.id = 'qa-fast-local-action';
    button.textContent = 'Fast local action';
    document.body.appendChild(button);
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      document.getElementById('screen-myconcerts').setAttribute('data-qa-fast-action', String(Date.now()));
    });

    button.click();
    const progress = document.getElementById('interaction-progress');
    const visibleImmediately = progress.classList.contains('is-active');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const busyAfterSettlement = button.hasAttribute('aria-busy');
    button.click();
    const secondClickAccepted = clicks === 2;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const visibleAt120ms = progress.classList.contains('is-active');
    await new Promise((resolve) => setTimeout(resolve, 180));
    const visibleAfter300ms = progress.classList.contains('is-active');
    const busyAfter300ms = button.hasAttribute('aria-busy');
    button.remove();
    return { visibleImmediately, busyAfterSettlement, secondClickAccepted, visibleAt120ms, visibleAfter300ms, busyAfter300ms };
  });

  expect(lifecycle).toEqual({
    visibleImmediately: true,
    busyAfterSettlement: false,
    secondClickAccepted: true,
    visibleAt120ms: true,
    visibleAfter300ms: false,
    busyAfter300ms: false,
  });
});

test('v132 keeps processing feedback active for perceptible local IndexedDB work and stops at completion', async ({ page }) => {
  await page.goto('/');
  const lifecycle = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('qa-state-feedback-v132', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('items');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const button = document.createElement('button');
    button.id = 'qa-local-idb-action';
    button.textContent = 'Local IndexedDB action';
    document.body.appendChild(button);

    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    button.addEventListener('click', () => {
      const transaction = db.transaction('items', 'readwrite');
      const store = transaction.objectStore('items');
      let index = 0;
      const deadline = performance.now() + 260;
      const keepBusy = () => {
        const request = store.put(index, `key-${index}`);
        request.onsuccess = () => {
          index += 1;
          if (performance.now() < deadline) keepBusy();
        };
      };
      transaction.addEventListener('complete', resolveDone, { once: true });
      keepBusy();
    });

    button.click();
    const visibleImmediately = document.getElementById('interaction-progress').classList.contains('is-active');
    await new Promise((resolve) => setTimeout(resolve, 165));
    const visibleDuring = document.getElementById('interaction-progress').classList.contains('is-active');
    const busyDuring = button.getAttribute('aria-busy') === 'true';
    await done;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visibleAfter = document.getElementById('interaction-progress').classList.contains('is-active');
    const busyAfter = button.hasAttribute('aria-busy');

    button.remove();
    db.close();
    indexedDB.deleteDatabase('qa-state-feedback-v132');
    return { visibleImmediately, visibleDuring, busyDuring, visibleAfter, busyAfter };
  });

  expect(lifecycle).toEqual({ visibleImmediately: true, visibleDuring: true, busyDuring: true, visibleAfter: false, busyAfter: false });
});

test('v132 reduced motion keeps the processing segment static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const style = await page.evaluate(() => {
    const handle = LiveVaultInteractionFeedbackV129.begin({ key: 'qa:motion', delayMs: 0 });
    const segment = document.querySelector('#interaction-progress span');
    const result = { animationName: getComputedStyle(segment).animationName, transform: getComputedStyle(segment).transform };
    LiveVaultInteractionFeedbackV129.end(handle);
    return result;
  });
  expect(style.animationName).toBe('none');
  expect(style.transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
});
