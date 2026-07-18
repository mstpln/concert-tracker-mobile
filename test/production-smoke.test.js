'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSanitizedSmoke } = require('../scripts/production-smoke');

function healthyResult() {
  return {
    ok: true,
    files: {
      'bands.json': { ok: true, type: 'array', count: 135 },
      'concerts.json': { ok: true, type: 'array', count: 42 },
      'news.json': { ok: true, type: 'array', count: 18 },
      'apiUsage.json': { ok: true, type: 'object', count: null },
    },
  };
}

test('production smoke validator accepts only the sanitized aggregate shape', () => {
  assert.equal(validateSanitizedSmoke(healthyResult()), true);
});

test('production smoke validator rejects unexpected keys and leaked fields', () => {
  const extraFile = healthyResult();
  extraFile.files['raw.json'] = { ok: true, type: 'array', count: 1 };
  assert.throws(() => validateSanitizedSmoke(extraFile), /unexpected file keys/);

  const leakedField = healthyResult();
  leakedField.files['bands.json'].sample = [{ id: 'private' }];
  assert.throws(() => validateSanitizedSmoke(leakedField), /leaked an unexpected field/);
});

test('production smoke validator rejects invalid counts and failure reasons', () => {
  const badCount = healthyResult();
  badCount.files['concerts.json'].count = -1;
  assert.throws(() => validateSanitizedSmoke(badCount), /invalid count/);

  const badReason = healthyResult();
  badReason.ok = false;
  badReason.files['news.json'] = { ok: false, type: 'array', count: null, reason: 'details-follow' };
  assert.throws(() => validateSanitizedSmoke(badReason), /invalid failure reason/);
});
