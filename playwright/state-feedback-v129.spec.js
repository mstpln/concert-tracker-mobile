const { test, expect } = require('@playwright/test');

test('v130 renders past state, divider and perceptible request feedback', async ({ page }) => {
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
    return {
      pastBackground: getComputedStyle(past).backgroundColor,
      dividerText: divider.textContent.trim(),
      dividerDisplay: getComputedStyle(divider).display,
      progressHeight: getComputedStyle(document.getElementById('interaction-progress')).height,
    };
  });

  expect(visual.pastBackground).toBe('rgb(29, 33, 36)');
  expect(visual.dividerText.toLowerCase()).toBe('past concerts');
  expect(visual.dividerDisplay).toBe('flex');
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

test('v130 keeps processing feedback active for perceptible local IndexedDB work', async ({ page }) => {
  await page.goto('/');
  const lifecycle = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('qa-state-feedback-v130', 1);
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
      const keepBusy = () => {
        const request = store.put(index, `key-${index}`);
        request.onsuccess = () => {
          index += 1;
          if (performance.now() < deadline) {
            keepBusy();
          }
        };
      };
      const deadline = performance.now() + 220;
      transaction.addEventListener('complete', resolveDone, { once: true });
      keepBusy();
    });

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 165));
    const visibleDuring = document.getElementById('interaction-progress').classList.contains('is-active');
    const busyDuring = button.getAttribute('aria-busy') === 'true';
    await done;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visibleAfter = document.getElementById('interaction-progress').classList.contains('is-active');
    const busyAfter = button.hasAttribute('aria-busy');

    button.remove();
    db.close();
    indexedDB.deleteDatabase('qa-state-feedback-v130');
    return { visibleDuring, busyDuring, visibleAfter, busyAfter };
  });

  expect(lifecycle).toEqual({ visibleDuring: true, busyDuring: true, visibleAfter: false, busyAfter: false });
});

test('v130 reduced motion keeps the processing segment static', async ({ page }) => {
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
