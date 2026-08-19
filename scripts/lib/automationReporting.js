'use strict';

const MAX_REASON_LENGTH = 140;
const SAFE_STATUSES = new Set(['ok', 'error', 'attention']);

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

  const normalized = {
    status: normalizeStatus(report.status, report.failureReason || report.failureCode ? 'error' : 'ok'),
  };
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

module.exports = {
  MAX_REASON_LENGTH,
  nonNegativeInteger,
  normalizeStatus,
  safeFailureSummary,
  normalizeActivityReport,
  activityReport,
};
