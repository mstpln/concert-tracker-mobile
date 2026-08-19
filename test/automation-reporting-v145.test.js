'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const reporting = require('../scripts/lib/automationReporting');

function fakeUsage(state = {}) {
  return {
    state,
    _startedAt:'2026-08-19T01:00:00.000Z',
    finishRun(summary = {}) {
      this.state.lastRun = {
        startedAt:this._startedAt,
        finishedAt:'2026-08-19T01:15:00.000Z',
        ...summary,
      };
    },
    finishProviderIdentityRun(summary = {}) {
      this.state.lastProviderIdentityRun = {
        startedAt:this._startedAt,
        finishedAt:'2026-08-19T01:15:00.000Z',
        ...summary,
      };
    },
  };
}

test('failure normalization produces bounded user-readable categories without echoing diagnostics', () => {
  assert.deepEqual(reporting.safeFailureSummary({ status:503 }, 'setlist.fm'), {
    failureCode:'provider_unavailable',
    failureReason:'setlist.fm temporarily unavailable (HTTP 503)',
  });
  assert.equal(reporting.safeFailureSummary({ status:429 }, 'Spotify').failureReason, 'Rate limit reached; the item will be retried');
  assert.equal(reporting.safeFailureSummary({ error:'invalid_json' }, 'Provider').failureReason, 'Provider returned an invalid response');
  assert.equal(reporting.safeFailureSummary({ error:'fetch failed ECONNRESET bearer secret-token' }, 'Provider').failureReason, 'Network request failed');
  const generic = reporting.safeFailureSummary({ error:'Authorization: Bearer super-secret https://private.invalid/full/response' }, 'Provider');
  assert.equal(generic.failureReason, 'Provider update could not be completed safely');
  assert.doesNotMatch(JSON.stringify(generic), /super-secret|private\.invalid|Authorization|Bearer/i);
});

test('standardized structured reports are additive, keep unknown future state, and retain real zeroes', () => {
  const usage = fakeUsage({ automationRuns:{ futureFlow:{ keep:true } }, futureTopLevel:{ keep:true } });
  reporting.installUsageReporting(usage);
  reporting.recordActivity(usage, 'concerts', { result:{ workCount:7, changeCount:0 } });
  reporting.recordActivity(usage, 'artistArtwork', { result:{ workCount:3, changeCount:0 } });
  reporting.recordProblem(usage, 'setlists', { status:503, error:'Bearer hidden-token' }, 'setlist.fm', 'error');
  reporting.recordActivity(usage, 'setlists', { result:{ workCount:4, changeCount:0 } });
  usage.finishRun({ status:'ok', bandsProcessed:7, concertsAdded:0, setlistChecksAttempted:4, setlistsAdded:0, artistImagesUpdated:0 });

  assert.deepEqual(usage.state.futureTopLevel, { keep:true });
  assert.deepEqual(usage.state.automationRuns.futureFlow, { keep:true });
  assert.deepEqual(usage.state.automationRuns.structuredResearch.activities.concerts.result, { workCount:7, changeCount:0 });
  assert.deepEqual(usage.state.automationRuns.structuredResearch.activities.artistArtwork.result, { workCount:3, changeCount:0 });
  const setlists = usage.state.automationRuns.structuredResearch.activities.setlists;
  assert.equal(setlists.status, 'error');
  assert.equal(setlists.failureReason, 'setlist.fm temporarily unavailable (HTTP 503)');
  assert.doesNotMatch(JSON.stringify(usage.state.automationRuns), /hidden-token|Bearer/i);
});

test('focused web and provider identity runs use the same report contract', () => {
  const focused = fakeUsage({});
  reporting.installUsageReporting(focused);
  reporting.recordProblem(focused, 'webConcertSearch', { error:'request timed out token=secret' }, 'Web concert search', 'attention');
  reporting.recordActivity(focused, 'webConcertSearch', { result:{ workCount:5, changeCount:1 } });
  focused.finishRun({ mode:'tavily-concert-only', status:'ok', bandsAttempted:5, concertsAdded:1 });
  const web = focused.state.automationRuns.focusedTavilyConcert.activities.webConcertSearch;
  assert.equal(web.status, 'attention');
  assert.equal(web.failureReason, 'Request timed out');
  assert.deepEqual(web.result, { workCount:5, changeCount:1 });

  const identity = fakeUsage({ automationRuns:{ future:{ keep:true } } });
  reporting.installUsageReporting(identity);
  identity.finishProviderIdentityRun({ status:'ok', bandsConsidered:10, updates:3 });
  const artist = identity.state.automationRuns.providerIdentity.activities.artistInformation;
  assert.equal(artist.status, 'ok');
  assert.deepEqual(artist.result, { workCount:10, changeCount:3 });
  assert.deepEqual(identity.state.automationRuns.future, { keep:true });
});
