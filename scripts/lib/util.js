'use strict';
// Small shared helpers used across the pipeline. dlSlugify/haversine are
// deliberately re-implemented here (rather than imported from dataLib.js)
// because dataLib.js runs in the browser without a module system — keeping
// this a plain CommonJS file avoids having to touch that file at all.

function slugify(name) {
  const combiningMarks = new RegExp('[\\u0300-\\u036f]', 'g');
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(combiningMarks, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Great-circle distance in km, rounded to the nearest whole km (matches the
// precision already used throughout concerts.json).
function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
    return null;
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function thisMonthIso() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// Strict YYYY-MM-DD check — used to enforce the mandatory-year data-entry
// policy. Anything that isn't a full, explicit calendar date is rejected
// rather than guessed or defaulted.
//
// Note this also has to catch day-of-month overflow (e.g. "2026-11-31" —
// November only has 30 days). JS's Date constructor doesn't reject that:
// it silently rolls it over to December 1st instead of returning Invalid
// Date, so a plain regex-plus-NaN check lets a hallucinated LLM date
// through as the literal, unrolled invalid string (every caller uses the
// input string directly, never the rolled-over Date object) — exactly the
// kind of bad date the mandatory-year policy exists to catch. Confirmed
// with a live test during a QA pass: "2026-02-30" and "2026-04-31" both
// passed the old regex-only check.
function isValidFullDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Truncates search-result text before it goes into a Groq prompt. Groq's
// free tier is bounded by total tokens/day (see config.js), not just
// tokens/minute, so keeping each snippet short is what lets a full weekly
// run actually cover every band within that budget.
function truncate(text, maxChars = 350) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars).trim() + '…';
}

function daysAgo(isoDateOrTimestamp) {
  if (!isoDateOrTimestamp) return Infinity;
  const d = new Date(isoDateOrTimestamp);
  if (Number.isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

module.exports = {
  slugify,
  haversineKm,
  sleep,
  todayIso,
  thisMonthIso,
  isValidFullDate,
  daysAgo,
  truncate,
};
