'use strict';

const MAX_REASON_LENGTH = 140;
const SAFE_STATUSES = new Set(['ok', 'error', 'attention']);
const REPORTING_MARK = Symbol.for('bandmarkr.automationReporting.v145');

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function normalizeStatus(value, fallback = 'ok') {
  const status = String(value || '').trim().toLowerCase();
  if (['ok', 'success', 'successful', 'complete', 'completed', 'healthy'].includes(status)) return 'ok';
  if (['error', 'failed', 'failure'].includes(status)) return 'error';
  if (['attention', 'partial', 'deferred', 'warning', 'needs_attention'].includes(status)) return 'attention';
  return SAFE_STATUSES.has(fallback) ? fallback : 'ok';
}

function providerLabel(value) {
  const label = String(value || 'Provider').replace(/[^A-Za-z0-9 ._-]/g, '').trim();
  return label.slice(0, 40) || 'Provider';
}

function diagnosticText(input) {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  return [input.kind, input.error, input.message, input.reason, input.code].filter(Boolean).join(' ');
}

function httpStatus(input, text) {
  const direct = Number(input && typeof input === 'object' ? input.status : NaN);
  if (Number.isInteger(direct) && direct >= 400 && direct <= 599) return direct;
  const match = String(text || '').match(/(?:http\s*)?(4\d\d|5\d\d)\b/i);
  return match ? Number(match[1]) : null;
}

function safeFailureSummary(input, provider = 'Provider') {
  const label = providerLabel(provider);
  const text = diagnosticText(input).toLowerCase();
  const status = httpStatus(input, text);

  if (status === 429 || /rate[ _-]?limit|quota[_ -]?exceed|usage[_ -]?cap/.test(text)) {
    return { failureCode: 'rate_limited', failureReason: 'Rate limit reached; the item will be retried' };
  }
  if (status && status >= 500) {
    return { failureCode: 'provider_unavailable', failureReason: `${label} temporarily unavailable (HTTP ${status})` };
  }
  if (/timeout|timed out|aborterror|aborted/.test(text)) {
    return { failureCode: 'timeout', failureReason: 'Request timed out' };
  }
  if (/invalid[_ -]?(json|response|provider)|unparseable|malformed/.test(text)) {
    return { failureCode: 'invalid_response', failureReason: 'Provider returned an invalid response' };
  }
  if (/show[_ -]?identity[_ -]?conflict|ambiguous[_ -]?show|match[_ -]?conflict/.test(text)) {
    return { failureCode: 'match_uncertain', failureReason: 'Show could not be matched safely' };
  }
  if (/artist[_ -]?id[_ -]?mismatch|duplicate[_ -]?spotify[_ -]?identity|needs[_ -]?review/.test(text)) {
    return { failureCode: 'match_uncertain', failureReason: 'Artist could not be matched safely' };
  }
  if (/network|fetch failed|failed to fetch|econn|socket|dns/.test(text)) {
    return { failureCode: 'network_error', failureReason: 'Network request failed' };
  }
  if (status) {
    return { failureCode: 'provider_error', failureReason: `${label} request failed (HTTP ${status})` };
  }
  return { failureCode: 'update_failed', failureReason: `${label} update could not be completed safely`.slice(0, MAX_REASON_LENGTH) };
}

function normalizeActivityReport(report = {}) {
  const result = {};
  const workCount = nonNegativeInteger(report?.result?.workCount ?? report.workCount);
  const changeCount = nonNegativeInteger(report?.result?.changeCount ?? report.changeCount);
  if (workCount !== null) result.workCount = workCount;
  if (changeCount !== null) result.changeCount = changeCount;

  const normalized = { status: normalizeStatus(report.status, report.failureReason || report.failureCode ? 'error' : 'ok') };
  if (report.startedAt) normalized.startedAt = String(report.startedAt);
  if (report.finishedAt) normalized.finishedAt = String(report.finishedAt);
  if (Object.keys(result).length) normalized.result = result;
  if (report.failureCode) normalized.failureCode = String(report.failureCode).slice(0, 60);
  if (report.failureReason) normalized.failureReason = String(report.failureReason).replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_REASON_LENGTH);
  return normalized;
}

function activityReport({ status = 'ok', startedAt = null, finishedAt = null, workCount = null, changeCount = null, problem = null, provider = 'Provider' } = {}) {
  const failure = problem ? safeFailureSummary(problem, provider) : null;
  return normalizeActivityReport({
    status: failure && normalizeStatus(status) === 'ok' ? 'error' : status,
    startedAt,
    finishedAt,
    workCount,
    changeCount,
    ...(failure || {}),
  });
}

function mergeActivity(previous = {}, patch = {}) {
  const priorStatus = normalizeStatus(previous.status);
  const nextStatus = patch.status ? normalizeStatus(patch.status) : priorStatus;
  const status = priorStatus === 'error' || nextStatus === 'error' ? 'error'
    : priorStatus === 'attention' || nextStatus === 'attention' ? 'attention' : 'ok';
  const normalized = normalizeActivityReport({
    ...previous,
    ...patch,
    status,
    result: { ...(previous.result || {}), ...(patch.result || {}) },
  });
  const problem = patch.problem ?? previous.problem;
  const provider = patch.provider ?? previous.provider;
  if (problem) normalized.problem = problem;
  if (provider) normalized.provider = provider;
  return normalized;
}

function storeAutomationRun(state, key, run) {
  const prior = state.automationRuns && typeof state.automationRuns === 'object' ? state.automationRuns : {};
  state.automationRuns = { ...prior, [key]: run };
}

function installUsageReporting(usage) {
  if (!usage || usage[REPORTING_MARK]) return usage;
  const scratch = {};
  const originalFinishRun = usage.finishRun.bind(usage);
  const originalFinishProviderIdentityRun = usage.finishProviderIdentityRun?.bind(usage);

  Object.defineProperty(usage, REPORTING_MARK, { value: { scratch }, enumerable: false });

  usage.finishRun = (summary = {}) => {
    originalFinishRun(summary);
    const last = usage.state.lastRun;
    const startedAt = last?.startedAt || usage._startedAt || null;
    const finishedAt = last?.finishedAt || null;
    const parentStatus = normalizeStatus(last?.status, last?.error ? 'error' : 'ok');
    const parentProblem = parentStatus === 'error' && last?.error ? last.error : null;

    if (last?.mode === 'tavily-concert-only') {
      const lane = scratch.webConcertSearch || {};
      const report = activityReport({
        status: lane.status || parentStatus,
        startedAt,
        finishedAt,
        workCount: lane.result?.workCount ?? last.bandsAttempted,
        changeCount: lane.result?.changeCount ?? last.concertsAdded,
        problem: lane.problem || parentProblem,
        provider: lane.provider || 'Web concert search',
      });
      storeAutomationRun(usage.state, 'focusedTavilyConcert', {
        startedAt,
        finishedAt,
        status: parentStatus,
        activities: { webConcertSearch: report },
      });
      return;
    }

    const concertLane = scratch.concerts || {};
    const artworkLane = scratch.artistArtwork || {};
    const setlistLane = scratch.setlists || {};
    const activities = {
      concerts: activityReport({
        status: concertLane.status || parentStatus,
        startedAt,
        finishedAt,
        workCount: concertLane.result?.workCount ?? last?.bandsProcessed,
        changeCount: concertLane.result?.changeCount ?? last?.concertsAdded,
        problem: concertLane.problem || parentProblem,
        provider: concertLane.provider || 'Concert research',
      }),
      artistArtwork: activityReport({
        status: artworkLane.status || (parentStatus === 'error' ? 'error' : 'ok'),
        startedAt,
        finishedAt,
        workCount: artworkLane.result?.workCount,
        changeCount: artworkLane.result?.changeCount ?? last?.artistImagesUpdated,
        problem: artworkLane.problem || (parentStatus === 'error' ? parentProblem : null),
        provider: artworkLane.provider || 'Artist artwork',
      }),
      setlists: activityReport({
        status: setlistLane.status || (parentStatus === 'error' ? 'error' : 'ok'),
        startedAt,
        finishedAt,
        workCount: setlistLane.result?.workCount ?? last?.setlistChecksAttempted,
        changeCount: setlistLane.result?.changeCount ?? last?.setlistsAdded,
        problem: setlistLane.problem || (parentStatus === 'error' ? parentProblem : null),
        provider: setlistLane.provider || 'setlist.fm',
      }),
    };
    storeAutomationRun(usage.state, 'structuredResearch', { startedAt, finishedAt, status: parentStatus, activities });
  };

  if (originalFinishProviderIdentityRun) {
    usage.finishProviderIdentityRun = (summary = {}) => {
      originalFinishProviderIdentityRun(summary);
      const last = usage.state.lastProviderIdentityRun;
      const parentStatus = normalizeStatus(last?.status, last?.error ? 'error' : 'ok');
      const lane = scratch.artistInformation || {};
      const report = activityReport({
        status: lane.status || parentStatus,
        startedAt: last?.startedAt,
        finishedAt: last?.finishedAt,
        workCount: lane.result?.workCount ?? last?.bandsConsidered,
        changeCount: lane.result?.changeCount ?? last?.updates,
        problem: lane.problem || (parentStatus === 'error' ? last?.error : null),
        provider: lane.provider || 'Artist information',
      });
      storeAutomationRun(usage.state, 'providerIdentity', {
        startedAt: last?.startedAt,
        finishedAt: last?.finishedAt,
        status: parentStatus,
        activities: { artistInformation: report },
      });
    };
  }
  return usage;
}

function recordActivity(usage, key, patch = {}) {
  installUsageReporting(usage);
  const state = usage?.[REPORTING_MARK]?.scratch;
  if (!state || !key) return;
  state[key] = mergeActivity(state[key], patch);
}

function recordProblem(usage, key, input, provider = 'Provider', status = 'error') {
  const failure = safeFailureSummary(input, provider);
  recordActivity(usage, key, { status, problem: input, provider, ...failure });
}

module.exports = {
  MAX_REASON_LENGTH,
  nonNegativeInteger,
  normalizeStatus,
  safeFailureSummary,
  normalizeActivityReport,
  activityReport,
  installUsageReporting,
  recordActivity,
  recordProblem,
};
