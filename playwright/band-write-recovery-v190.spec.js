'use strict';

const { test, expect } = require('@playwright/test');

test('v190 concurrent backfill survives two Add Band writes including a 412 conflict', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bands' }).click();
  const targetId = await page.evaluate(async () => {
    // This is the existing in-memory QA fake backend; no production R2 or
    // provider host is contacted. Add realistic ETags to reproduce the bug.
    const key = 'livevault-qa:data';
    const saved = JSON.parse(localStorage.getItem(key));
    let document = JSON.parse(JSON.stringify(saved.bands));
    let revision = 1;
    let conflictPending = true;
    const targetId = document[0].id;
    const upstream = window.fetch.bind(window);
    const etag = () => '"synthetic-revision-' + revision + '"';
    const persist = () => {
      const data = JSON.parse(localStorage.getItem(key));
      data.bands = JSON.parse(JSON.stringify(document));
      localStorage.setItem(key, JSON.stringify(data));
    };
    function applyIndependentCuratedUpdate() {
      const candidate = document.find((item) => item.id === targetId);
      candidate.favorite = true;
      candidate.unknownFutureField = { mustSurvive: 'yes' };
      candidate.musicbrainz = {
        ...(candidate.musicbrainz || {}),
        mbid: 'synthetic-curated-mbid',
        status: 'manual_confirmed',
        reviewedAt: '2026-10-12T11:00:00.000Z',
        spotify: {
          id: 'synthetic-curated-spotify', status: 'manual_confirmed',
          reviewedBy: 'user', futureField: 'preserve',
        },
      };
      revision++;
      persist();
    }
    window.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin !== 'https://qa.invalid' || url.pathname !== '/bands.json') {
        return upstream(input, options);
      }
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { ETag: etag(), 'Content-Type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        if (conflictPending) {
          conflictPending = false;
          // Another owner writes a verified identity between GET and PUT.
          applyIndependentCuratedUpdate();
        }
        if (new Headers(options.headers || {}).get('If-Match') !== etag()) {
          return new Response('Precondition Failed', { status: 412 });
        }
        document = JSON.parse(options.body);
        revision++;
        persist();
        return new Response('OK', { status: 200, headers: { ETag: etag() } });
      }
      return new Response('Not allowed', { status: 405 });
    };
    // Set a realistic ETag baseline after the synthetic app has loaded.
    await dlReadJsonFile(remote, 'bands.json', []);
    return targetId;
  });

  async function add(name) {
    await page.locator('#screen-mybands #add-band-name').fill(name);
    await page.locator('#screen-mybands #add-band-submit').click();
    await expect(page.locator('#screen-mybands').getByText(name, { exact: true })).toBeVisible();
  }

  await add('Synthetic First After Backfill');
  await add('Synthetic Second After Backfill');

  const result = await page.evaluate((target) => {
    const stored = JSON.parse(localStorage.getItem('livevault-qa:data')).bands;
    return {
      persisted: stored.find((item) => item.id === target),
      inMemory: bands.find((item) => item.id === target),
      added: stored.filter((item) => item.name.startsWith('Synthetic ') && item.name.endsWith(' After Backfill')),
    };
  }, targetId);

  for (const copy of [result.persisted, result.inMemory]) {
    expect(copy.favorite).toBe(true);
    expect(copy.unknownFutureField).toEqual({ mustSurvive: 'yes' });
    expect(copy.musicbrainz.mbid).toBe('synthetic-curated-mbid');
    expect(copy.musicbrainz.status).toBe('manual_confirmed');
    expect(copy.musicbrainz.spotify.id).toBe('synthetic-curated-spotify');
    expect(copy.musicbrainz.spotify.status).toBe('manual_confirmed');
    expect(copy.musicbrainz.spotify.futureField).toBe('preserve');
  }
  expect(result.added).toHaveLength(2);
  for (const added of result.added) {
    expect(added.artistProfileResearch.status).toBe('pending');
    expect(added.artistEnrichment).toBeUndefined();
  }
  await page.reload();
  await expect.poll(async () => page.evaluate(() => bands.some((item) => item.name === 'Synthetic Second After Backfill'))).toBe(true);
  const reloaded = await page.evaluate((target) => {
    const record = bands.find((item) => item.id === target);
    return {
      id: record.musicbrainz.mbid,
      spotify: record.musicbrainz.spotify.id,
      added: bands.filter((item) => item.name.endsWith(' After Backfill')).length,
    };
  }, targetId);
  expect(reloaded).toEqual({
    id: 'synthetic-curated-mbid', spotify: 'synthetic-curated-spotify', added: 2,
  });
});

test('v190 a failed fresh bands read cannot add an unsaved band', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bands' }).click();
  await page.evaluate(() => {
    const previous = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === 'https://qa.invalid' && url.pathname === '/bands.json' && (options.method || 'GET').toUpperCase() === 'GET') {
        return new Response('Synthetic temporary read failure', { status: 503 });
      }
      return previous(input, options);
    };
  });
  await page.locator('#screen-mybands #add-band-name').fill('Synthetic Unsaved Artist');
  await page.locator('#screen-mybands #add-band-submit').click();
  await expect(page.locator('#add-band-error')).toContainText('Could not save this band');
  const stored = await page.evaluate(() => ({
    presentInMemory: bands.some((item) => item.name === 'Synthetic Unsaved Artist'),
    presentInStorage: JSON.parse(localStorage.getItem('livevault-qa:data')).bands
      .some((item) => item.name === 'Synthetic Unsaved Artist'),
  }));
  expect(stored).toEqual({ presentInMemory: false, presentInStorage: false });
});
