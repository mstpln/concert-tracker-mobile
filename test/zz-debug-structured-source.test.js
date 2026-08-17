'use strict';
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('debug structured research source around current CI failure', () => {
  const source = fs.readFileSync(path.join(__dirname, 'structured-research.test.js'), 'utf8').split(/\r?\n/);
  console.log('STRUCTURED_SOURCE_DEBUG_BEGIN');
  for (let line = 535; line <= 595; line += 1) console.log(`${line}: ${source[line - 1] || ''}`);
  console.log('STRUCTURED_SOURCE_DEBUG_END');
});
