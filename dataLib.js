'use strict';
// Shared read/write/diff helpers for bands.json and concerts.json.
// Originally used by the Chrome-extension build's background.js (weekly
// alarm check) and popup.js (UI); this file is copied byte-for-byte into
// the current PWA build too, where app.js (UI) and remoteStore.js (storage
// transport override) are the actual consumers — see remoteStore.js's
// header comment for why this file is kept unchanged across both builds.

async function dlReadJsonFile(dirHandle, filename, fallback) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

async function dlWriteJsonFile(dirHandle, filename, data) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

function dlSlugify(name) {
  const combiningMarks = /[\u0300-\u036f]/g;
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(combiningMarks, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dlIsUpcoming(concert) {
  if (!concert.date) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(concert.date + 'T00:00:00');
  return d >= today;
}

// Returns, per bandId, a single representative upcoming concert: if the band
// has any upcoming show marked attending, the earliest of those wins (so a
// show you've committed to always surfaces on the Concerts tab, even if a
// nearer-but-unconfirmed date exists for the same band); otherwise it's just
// the single nearest-upcoming-date concert. Sorted by date (soonest first),
// then distanceKm, then band name. Bands with no upcoming shows are dropped
// from this view — they still appear in the My Bands tab.
function dlNearestPerBand(concerts) {
  const upcoming = concerts.filter(dlIsUpcoming);
  const byBand = new Map();
  for (const c of upcoming) {
    const existing = byBand.get(c.bandId);
    if (!existing) {
      byBand.set(c.bandId, c);
      continue;
    }
    const existingAttending = !!existing.attending;
    const cAttending = !!c.attending;
    if (cAttending && !existingAttending) {
      byBand.set(c.bandId, c);
    } else if (cAttending === existingAttending && new Date(c.date) < new Date(existing.date)) {
      byBand.set(c.bandId, c);
    }
  }
  return [...byBand.values()].sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    if (da !== db) return da - db;
    return a.bandName.localeCompare(b.bandName);
  });
}

// Countries treated as "Europe" for the Europe-only filter on the Concerts
// tab. Matches the country strings actually used in concerts.json (some
// records use "UK"/"USA", others the long form).
const DL_EUROPE_COUNTRIES = new Set([
  'sweden', 'norway', 'denmark', 'finland', 'iceland',
  'uk', 'united kingdom', 'ireland',
  'germany', 'france', 'belgium', 'netherlands', 'switzerland', 'austria',
  'italy', 'spain', 'portugal', 'poland', 'czech republic', 'czechia',
  'turkey', 'greece', 'hungary', 'romania', 'slovakia', 'slovenia',
  'croatia', 'serbia', 'estonia', 'latvia', 'lithuania', 'luxembourg',
]);

function dlIsEuropeCountry(country) {
  if (!country) return false;
  return DL_EUROPE_COUNTRIES.has(String(country).trim().toLowerCase());
}

// "Nearby" filter for the Concerts tab. This is deliberately country+distance
// rather than a single km radius: from southern Sweden, the German Baltic
// coast (e.g. Rügen, ~90-115km away) is actually closer than the far corners
// of Skåne (~120-150km away), so a plain radius can't tell "nearby Sweden"
// apart from "nearby Germany". Scoping each distance cap to a specific
// country avoids that entirely.
const DL_NEARBY_RULES = [
  { country: 'sweden', maxKm: 150 },
  { country: 'denmark', maxKm: 80 },
];

function dlIsNearby(concert) {
  if (!concert || !concert.country || typeof concert.distanceKm !== 'number') return false;
  const country = String(concert.country).trim().toLowerCase();
  const rule = DL_NEARBY_RULES.find((r) => r.country === country);
  return !!rule && concert.distanceKm <= rule.maxKm;
}

function dlAllUpcomingForBand(concerts, bandId) {
  return concerts
    .filter((c) => c.bandId === bandId && dlIsUpcoming(c))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Diff against previously-notified ids. Returns the list of concerts that
// are new (isNew flag set by the research pipeline's run) and haven't been
// notified yet.
function dlUnnotified(concerts, alreadyNotifiedIds) {
  const seen = new Set(alreadyNotifiedIds || []);
  return concerts.filter((c) => c.isNew && dlIsUpcoming(c) && !seen.has(c.id));
}

// The later of a band's researched lastKnownConcertDate and the latest date
// across all of its concerts.json entries (past or future — an upcoming show
// always counts, even if lastKnownConcertDate hasn't been refreshed since).
// Returns a Date, or null if neither source has anything.
function dlEffectiveLastShowDate(band, concerts) {
  let latest = null;
  if (band.lastKnownConcertDate) {
    const d = new Date(band.lastKnownConcertDate + (band.lastKnownConcertDate.length === 4 ? '-01-01' : '') + 'T00:00:00');
    if (!isNaN(d)) latest = d;
  }
  for (const c of concerts) {
    if (c.bandId !== band.id || !c.date) continue;
    const d = new Date(c.date + 'T00:00:00');
    if (isNaN(d)) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

// Classifies a band's touring activity for the inactive-badge UI:
// - 'unknown'  — no lastKnownConcertDate and no concerts.json entries at all
// - 'active'   — most recent known/upcoming date is in the future, or within
//                thresholdYears of today
// - 'inactive' — most recent known date is thresholdYears or more in the past
// Returns { status, lastDate, lastYear }.
function dlBandActivity(band, concerts, thresholdYears, today = new Date()) {
  const lastDate = dlEffectiveLastShowDate(band, concerts);
  if (!lastDate) return { status: 'unknown', lastDate: null, lastYear: null };
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const lastYear = lastDate.getFullYear();
  if (lastDate >= t) return { status: 'active', lastDate, lastYear };
  const yearsAgo = (t - lastDate) / (1000 * 60 * 60 * 24 * 365.25);
  return { status: yearsAgo >= thresholdYears ? 'inactive' : 'active', lastDate, lastYear };
}

// Every concert the user has marked "I'm going" to (or manually backlogged),
// split into upcoming (ascending by date) and past (descending — most recent
// first). This is the only view in the extension that ever shows a past
// concert.
function dlMyConcerts(concerts) {
  const mine = concerts.filter((c) => c.attending);
  const upcoming = mine.filter(dlIsUpcoming).sort((a, b) => new Date(a.date) - new Date(b.date));
  const past = mine.filter((c) => !dlIsUpcoming(c)).sort((a, b) => new Date(b.date) - new Date(a.date));
  return { upcoming, past };
}

// Aggregate "fun facts" for the stats screen. Takes the same `past` array
// dlMyConcerts already returns (past date + attending === true, both
// guaranteed) — never counts upcoming "going" shows that haven't happened.
//
// distanceKm is read from each concert rather than recomputed here: it's
// already stored per-concert (from Smygehamn, the fixed home base used
// everywhere else in the app — the Concerts tab's "203 km away" labels and
// the Nearby filter both rely on the same field). Manually-backlogged past
// concerts (added via the "Add a past concert" form) never got a distance
// computed, so distanceKm is null for a real chunk of the ~1000+ show
// history — kmTraveled quietly skips those rather than treating null as 0,
// and knownDistanceCount says how many shows the total is actually based on
// so the UI can caveat it instead of silently under-counting.
function dlConcertStats(attendedPast) {
  const totalShows = attendedPast.length;

  const countrySet = new Set();
  for (const c of attendedPast) {
    if (c.country) countrySet.add(String(c.country).trim().toLowerCase());
  }

  let kmTraveled = 0;
  let knownDistanceCount = 0;
  for (const c of attendedPast) {
    if (typeof c.distanceKm === 'number' && !Number.isNaN(c.distanceKm)) {
      kmTraveled += c.distanceKm;
      knownDistanceCount += 1;
    }
  }

  const yearCounts = new Map();
  for (const c of attendedPast) {
    const year = (c.date || '').slice(0, 4);
    if (!year) continue;
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
  }
  let busiestYear = null;
  for (const [year, count] of yearCounts) {
    if (!busiestYear || count > busiestYear.count || (count === busiestYear.count && year > busiestYear.year)) {
      busiestYear = { year, count };
    }
  }

  const sortedByDate = [...attendedPast].filter((c) => c.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  let longestGap = null;
  for (let i = 1; i < sortedByDate.length; i++) {
    const days = (new Date(sortedByDate[i].date) - new Date(sortedByDate[i - 1].date)) / (1000 * 60 * 60 * 24);
    if (!longestGap || days > longestGap.days) {
      longestGap = { days: Math.round(days), fromDate: sortedByDate[i - 1].date, toDate: sortedByDate[i].date };
    }
  }
  const firstShow = sortedByDate[0] || null;

  // Ties broken by most recently seen — the most natural reading of "which
  // of these tied artists is more front-of-mind right now".
  const artistCounts = new Map();
  for (const c of attendedPast) {
    const existing = artistCounts.get(c.bandId) || { bandId: c.bandId, bandName: c.bandName, count: 0, lastDate: null };
    existing.count += 1;
    if (c.date && (!existing.lastDate || c.date > existing.lastDate)) existing.lastDate = c.date;
    artistCounts.set(c.bandId, existing);
  }
  const topArtists = [...artistCounts.values()]
    .filter((a) => a.count >= 2)
    .sort((a, b) => b.count - a.count || (b.lastDate || '').localeCompare(a.lastDate || ''))
    .slice(0, 3);

  const venueCounts = new Map();
  for (const c of attendedPast) {
    if (!c.venue) continue;
    const key = `${c.venue}|${c.city || ''}`;
    const existing = venueCounts.get(key) || { venue: c.venue, city: c.city, count: 0, lastDate: null };
    existing.count += 1;
    if (c.date && (!existing.lastDate || c.date > existing.lastDate)) existing.lastDate = c.date;
    venueCounts.set(key, existing);
  }
  let mostVisitedVenue = null;
  for (const v of venueCounts.values()) {
    if (!mostVisitedVenue || v.count > mostVisitedVenue.count || (v.count === mostVisitedVenue.count && (v.lastDate || '') > (mostVisitedVenue.lastDate || ''))) {
      mostVisitedVenue = v;
    }
  }

  return {
    totalShows,
    countries: countrySet.size,
    kmTraveled: Math.round(kmTraveled),
    knownDistanceCount,
    busiestYear,
    longestGap,
    firstShow,
    topArtists,
    mostVisitedVenue,
  };
}
