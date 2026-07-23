'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../scripts/lib/config');
const { ensureTavilyUsageState } = require('../scripts/lib/usageTracker');

test('a new Tavily key epoch resets an older monthly counter exactly once', () => {
  const state = {
    tavily: {
      usageCounterEpoch: 'previous-key',
      monthOfCounts: '2026-07',
      callsThisMonth: 686,
    },
  };

  ensureTavilyUsageState(state, '2026-07');

  assert.equal(state.tavily.usageCounterEpoch, config.TAVILY.usageCounterEpoch);
  assert.equal(state.tavily.monthOfCounts, '2026-07');
  assert.equal(state.tavily.callsThisMonth, 0);

  state.tavily.callsThisMonth = 4;
  ensureTavilyUsageState(state, '2026-07');
  assert.equal(state.tavily.callsThisMonth, 4);
});

test('the Tavily key epoch remains backward compatible with missing state', () => {
  const state = {};

  ensureTavilyUsageState(state, '2026-07');

  assert.equal(state.tavily.usageCounterEpoch, config.TAVILY.usageCounterEpoch);
  assert.equal(state.tavily.monthOfCounts, '2026-07');
  assert.equal(state.tavily.callsThisMonth, 0);
});
