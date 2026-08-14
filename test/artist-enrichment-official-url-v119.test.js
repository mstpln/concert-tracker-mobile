'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('../securityHardening');

test('adding a valid official URL makes completed enrichment immediately retryable', () => {
  const now = '2026-08-14T08:00:00.000Z';
  const band = {
    id: 'synthetic-band',
    officialUrl: null,
    artistEnrichment: {
      status: 'complete',
      lastAttemptedAt: '2026-08-13T08:00:00.000Z',
      lastSuccessfulAt: '2026-08-13T08:00:00.000Z',
      nextEligibleCheckAt: null,
      errorCategory: null,
      futureStateField: { keep: true },
    },
  };

  assert.equal(security.prepareOfficialUrlRefresh(band, 'https://band.example', now), true);
  assert.equal(band.artistEnrichment.status, 'retryable');
  assert.equal(band.artistEnrichment.nextEligibleCheckAt, now);
  assert.equal(band.artistEnrichment.errorCategory, 'official_url_changed');
  assert.equal(band.artistEnrichment.lastAttemptedAt, '2026-08-13T08:00:00.000Z');
  assert.equal(band.artistEnrichment.lastSuccessfulAt, '2026-08-13T08:00:00.000Z');
  assert.deepEqual(band.artistEnrichment.futureStateField, { keep: true });
});

test('changing a valid official URL preserves an existing retry reason and schedules immediate recovery', () => {
  const now = '2026-08-14T08:00:00.000Z';
  const band = {
    id: 'synthetic-band',
    officialUrl: 'https://old.example',
    artistEnrichment: {
      status: 'retryable',
      nextEligibleCheckAt: '2026-08-15T08:00:00.000Z',
      errorCategory: 'wikipedia',
    },
  };

  assert.equal(security.prepareOfficialUrlRefresh(band, 'https://new.example', now), true);
  assert.equal(band.artistEnrichment.status, 'retryable');
  assert.equal(band.artistEnrichment.nextEligibleCheckAt, now);
  assert.equal(band.artistEnrichment.errorCategory, 'wikipedia,official_url_changed');
});

test('canonical no-op, removal, and unsafe official URLs do not schedule provider work', () => {
  const complete = { status: 'complete', futureField: 'keep' };
  const same = { officialUrl: 'https://band.example', artistEnrichment: structuredClone(complete) };
  const removal = { officialUrl: 'https://band.example', artistEnrichment: structuredClone(complete) };
  const unsafe = { officialUrl: 'https://band.example', artistEnrichment: structuredClone(complete) };

  assert.equal(security.prepareOfficialUrlRefresh(same, 'https://band.example/', '2026-08-14T08:00:00.000Z'), false);
  assert.equal(security.prepareOfficialUrlRefresh(removal, '', '2026-08-14T08:00:00.000Z'), false);
  assert.equal(security.prepareOfficialUrlRefresh(unsafe, 'http://band.example', '2026-08-14T08:00:00.000Z'), false);
  assert.deepEqual(same.artistEnrichment, complete);
  assert.deepEqual(removal.artistEnrichment, complete);
  assert.deepEqual(unsafe.artistEnrichment, complete);
});
