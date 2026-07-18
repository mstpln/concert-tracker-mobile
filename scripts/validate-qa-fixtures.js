'use strict';

const { createLiveVaultQaFixtures } = require('../qa/fixtures/qa-fixtures.js');
const { validateQaFixtures } = require('../qa/qa-fixture-validator.js');

const result = validateQaFixtures(createLiveVaultQaFixtures());
if (!result.valid) {
  for (const error of result.errors) console.error(`QA fixture error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`QA fixtures valid: ${result.summary.bands} bands, ${result.summary.concerts} concerts, ${result.summary.news} news records`);
}
