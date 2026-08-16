const { test, expect } = require('@playwright/test');

test('v131 renders past state, aligned listening row and contained immediate feedback', async ({ page }) => {
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

  const immediate = await page.evaluate(() => {
    const feedback = LiveVaultInteractionFeedbackV129;
    const handle = feedback.begin({ key: 'qa:immediate', delayMs: 0 });
    const visibleImmediately = document.getElementById('interaction-progress').classList.contains('is-active');
    feedback.end(handle);
    const visibleAfter = document.getElementById('interaction-progress').classList.contains('is-active');
    return { visibleImmediately, visibleAfter };
  });
  expect(immediate).toEqual({ visibleImmediately: true, visibleAfter: false });

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
    const prep = host.querySelector('.concert-prep-row');
    const prepText = prep.querySelector('span').getBoundingClientRect();
    const result = {
      iconWidth: listeningIcon.width,
      iconHeight: listeningIcon.height,
      textDelta: Math.abs(listeningText.left - prepText.left),
    };
    host.remove();
    return result;
  });
  expect(alignment.iconWidth).toBe(15);
  expect(alignment.iconHeight).toBe(15);
  expect(alignment.textDelta).toBeLessThanOrEqual(1);

  const keys = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button data-v123-listen-merge="qa-review-a|qa-review-c">Same listen</button>
      <button data-v123-listen-merge="qa-review-a|qa-review-b">Same listen</button>
    `;
    document.body.appendChild(host);
    const buttons = host.querySelectorAll('button');
    const result = [...buttons].map((button) => LiveVaultStateFeedbackIntegrationV129.userActionKey(button));
    host.remove();
    return result;
  });
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys).toEqual([
    'data:v123ListenMerge=qa-review-a|qa-review-c',
    'data:v123ListenMerge=qa-review-a|qa-review-b',
  ]);
  expect(pageErrors).toEqual([]);
});

test('v131 keeps processing feedback active for perceptible local IndexedDB work and stops at completion', async ({ page }) => {
  await page.goto('/');
  const lifecycle = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('qa-state-feedback-v131', 1);
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
      const deadline = performance.now() + 220;
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
    indexedDB.deleteDatabase('qa-state-feedback-v131');
    return { visibleImmediately, visibleDuring, busyDuring, visibleAfter, busyAfter };
  });

  expect(lifecycle).toEqual({ visibleImmediately: true, visibleDuring: true, busyDuring: true, visibleAfter: false, busyAfter: false });
});

test('v131 reduced motion keeps the processing segment static', async ({ page }) => {
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
