'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'spotifyListeningMetadataV99.js');
const source = fs.readFileSync(scriptPath, 'utf8');

test('Spotify metadata load hook routes restore through the public API so Settings can observe hydration completion', async () => {
  let loadCalls = 0;
  let restoreCalls = 0;
  const context = vm.createContext({
    console,
    URL,
    module: { exports: {} },
    exports: {},
    loadDataAndShowApp: async (...args) => {
      loadCalls += 1;
      return { args };
    },
  });

  vm.runInContext(source, context, { filename: 'spotifyListeningMetadataV99.js' });
  const api = context.module.exports;
  assert.equal(typeof api.installLoadHook, 'function');
  assert.equal(context.SpotifyListeningMetadataV99, api);

  api.restore = async () => {
    restoreCalls += 1;
    return api.emptyDocument();
  };
  api.installLoadHook();

  const result = await context.loadDataAndShowApp('synthetic');
  assert.equal(loadCalls, 1);
  assert.equal(restoreCalls, 1);
  assert.equal(result.args.length, 1);
  assert.equal(result.args[0], 'synthetic');
});

test('Spotify metadata startup paths do not bypass a wrapped public restore method', () => {
  assert.doesNotMatch(source, /(?:await\s+)?restore\(\)\.catch\(\(\)\s*=>\s*\{\}\)/);
  assert.match(source, /root\.SpotifyListeningMetadataV99\.restore\(\)\.catch\(\(\)\s*=>\s*\{\}\)/);
});
