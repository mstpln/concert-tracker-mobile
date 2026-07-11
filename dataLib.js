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

// Groups the messy, free-text band.genre field (often multi-genre and
// inconsistently formatted — "Rock, alternative rock" vs "Alternative Rock /
// Theatrical Rock", inconsistent casing) into a small, stable set of
// buckets for the My Bands genre filter dropdown only. This never touches
// band.genre itself — the raw string is untouched and still shown as-is on
// the band's own profile page and anywhere else in the app (e.g. the stats
// screen's genre breakdown).
//
// A genre string is split on "," and "/" into individual pieces, each piece
// is tested against every rule below, and a band ends up in every group any
// of its pieces matches (a band tagged "R&B, pop" lands in both Hip-hop &
// R&B and Pop — filtering by either should surface it). The one deliberate
// exclusion: "post-punk"/"post punk" is excluded from the Punk rule so
// post-punk-revival/indie bands land in Rock rather than the raw punk-scene
// bucket, which is where they read more naturally.
const DL_GENRE_GROUP_RULES = [
  { id: 'rock', label: 'Rock', test: (t) => /rock|new wave|britpop|post[\s-]?punk|psych|grunge|power pop/.test(t) },
  { id: 'punk', label: 'Punk', test: (t) => (/punk|noise rock/.test(t)) && !/post[\s-]?punk/.test(t) },
  { id: 'metal', label: 'Metal', test: (t) => /metal|hardcore|thrash/.test(t) },
  { id: 'hiphop_rnb', label: 'Hip-hop & R&B', test: (t) => /\bhip[\s-]?hop\b|\brap\b|r ?& ?b|\brnb\b|g-?funk/.test(t) },
  { id: 'pop', label: 'Pop', test: (t) => /\bpop\b/.test(t) },
  { id: 'folk', label: 'Folk & Singer-songwriter', test: (t) => /\bfolk\b|singer[\s-]?songwriter|americana/.test(t) },
];

// Display order for the filter dropdown — "Not tagged yet" always last so it
// reads as a catch-all rather than a "real" genre.
const DL_GENRE_GROUPS = [...DL_GENRE_GROUP_RULES.map((r) => ({ id: r.id, label: r.label })), { id: 'untagged', label: 'Not tagged yet' }];

function dlGenreGroupsForBand(band) {
  const raw = (band?.genre || '').trim();
  if (!raw) return ['untagged'];
  const tokens = raw.split(/[,/]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const groups = new Set();
  for (const t of tokens) {
    for (const rule of DL_GENRE_GROUP_RULES) {
      if (rule.test(t)) groups.add(rule.id);
    }
  }
  return groups.size ? [...groups] : ['untagged'];
}

// Priority order for single-bucket assignment — used only by the stats
// screen's genre breakdown, never the My Bands filter. Most specific/niche
// genres win over the broad "Rock" catch-all, so a "punk rock" show is
// counted once, as Punk, rather than as Rock — Rock is deliberately last
// since nearly every rock subgenre literally contains the word "rock",
// making it a poor discriminator when something more specific also matches.
const DL_GENRE_PRIORITY_ORDER = ['metal', 'punk', 'folk', 'hiphop_rnb', 'pop', 'rock'];

function dlPrimaryGenreGroupForBand(band) {
  const raw = (band?.genre || '').trim();
  if (!raw) return 'untagged';
  const tokens = raw.split(/[,/]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const groupId of DL_GENRE_PRIORITY_ORDER) {
    const rule = DL_GENRE_GROUP_RULES.find((r) => r.id === groupId);
    if (tokens.some((t) => rule.test(t))) return groupId;
  }
  return 'untagged';
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
function dlConcertStats(attendedPast, bands = []) {
  const totalShows = attendedPast.length;
  const bandsById = new Map(bands.map((b) => [b.id, b]));

  const countrySet = new Set();
  for (const c of attendedPast) {
    if (c.country) countrySet.add(String(c.country).trim().toLowerCase());
  }

  // Distance is summed once per physical trip, not once per band seen: a
  // multi-day festival (concert.type === 'festival') gets its distance
  // counted a single time per Venue+year, however many bands you saw there
  // — otherwise a single Roskilde trip where you saw 11 bands would count
  // that same round-trip distance 11 times over. Regular shows (everything
  // with no `type` set, or type: 'concert') are summed individually exactly
  // as before. knownDistanceCount still counts every show with a known
  // distance (festival or not) — it's a coverage caveat for the UI, separate
  // from the dedup applied to the sum itself.
  let kmTraveled = 0;
  let knownDistanceCount = 0;
  const countedFestivalTrips = new Set();
  for (const c of attendedPast) {
    if (typeof c.distanceKm !== 'number' || Number.isNaN(c.distanceKm)) continue;
    knownDistanceCount += 1;
    if (c.type === 'festival') {
      const tripKey = `${c.venue || ''}|${(c.date || '').slice(0, 4)}`;
      if (countedFestivalTrips.has(tripKey)) continue;
      countedFestivalTrips.add(tripKey);
    }
    kmTraveled += c.distanceKm;
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
  const topVenues = [...venueCounts.values()]
    .sort((a, b) => b.count - a.count || (b.lastDate || '').localeCompare(a.lastDate || ''))
    .slice(0, 3);

  // All 5-star shows, most recent first — deliberately not a forced "top 5"
  // ranking. Once a rating hits the ceiling there's no real distinction left
  // between two shows that both got 5 stars, so picking an arbitrary subset
  // would just be fake precision. The stats screen caps how many it *shows*
  // (with a "+N more"), but the underlying list here is everything.
  const topRatedShows = attendedPast
    .filter((c) => c.rating === 5)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  let farthestShow = null;
  let closestShow = null;
  for (const c of attendedPast) {
    if (typeof c.distanceKm !== 'number' || Number.isNaN(c.distanceKm)) continue;
    if (!farthestShow || c.distanceKm > farthestShow.distanceKm) farthestShow = c;
    if (!closestShow || c.distanceKm < closestShow.distanceKm) closestShow = c;
  }

  const totalUniqueArtists = new Set(attendedPast.map((c) => c.bandId)).size;

  const cityCounts = new Map();
  for (const c of attendedPast) {
    if (!c.city) continue;
    const key = c.city.trim();
    const existing = cityCounts.get(key) || { city: c.city, count: 0, lastDate: null };
    existing.count += 1;
    if (c.date && (!existing.lastDate || c.date > existing.lastDate)) existing.lastDate = c.date;
    cityCounts.set(key, existing);
  }
  let mostVisitedCity = null;
  for (const v of cityCounts.values()) {
    if (!mostVisitedCity || v.count > mostVisitedCity.count || (v.count === mostVisitedCity.count && (v.lastDate || '') > (mostVisitedCity.lastDate || ''))) {
      mostVisitedCity = v;
    }
  }

  // Calendar month aggregated across every year (not tied to a specific
  // year, unlike busiestYear) — "you go to more shows in August than any
  // other month", regardless of which year each August show happened in.
  const monthCounts = new Map();
  for (const c of attendedPast) {
    if (!c.date) continue;
    const m = Number(c.date.slice(5, 7));
    if (!m) continue;
    monthCounts.set(m, (monthCounts.get(m) || 0) + 1);
  }
  let busiestMonth = null;
  for (const [month, count] of monthCounts) {
    if (!busiestMonth || count > busiestMonth.count) busiestMonth = { month, count };
  }

  // Uses the same grouped genre buckets as the My Bands filter dropdown
  // (dlGenreGroupsForBand) rather than the raw, free-text band.genre string
  // — otherwise a show ends up as one of ~90 near-duplicate slices like
  // "Alternative rock, indie pop" and "Rock, alternative rock" instead of a
  // handful of readable categories. Unlike the filter (which is deliberately
  // multi-membership, so a band matching two buckets is findable under
  // either), the breakdown assigns each show to exactly one bucket via
  // dlPrimaryGenreGroupForBand's fixed priority order — a breakdown's
  // percentages need to sum to 100%, which multi-membership would break.
  // Percentages are relative to shows with a known/classifiable genre, not
  // the full attendedPast total, so untagged bands don't silently skew it.
  const genreCounts = new Map();
  let withGenre = 0;
  for (const c of attendedPast) {
    const band = bandsById.get(c.bandId);
    const groupId = dlPrimaryGenreGroupForBand(band);
    if (groupId === 'untagged') continue;
    withGenre += 1;
    genreCounts.set(groupId, (genreCounts.get(groupId) || 0) + 1);
  }
  const groupLabels = new Map(DL_GENRE_GROUPS.map((g) => [g.id, g.label]));
  const genreBreakdown = [...genreCounts.entries()]
    .map(([groupId, count]) => ({ genre: groupLabels.get(groupId) || groupId, count, pct: withGenre ? Math.round((count / withGenre) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  // Unique festival trips attended (grouped by Venue+year, same key as the
  // kmTraveled dedup above) — e.g. three separate years of Roskilde count
  // as 3, not as the 24 individual band performances seen across them.
  const festivalTripKeys = new Set();
  for (const c of attendedPast) {
    if (c.type === 'festival') {
      festivalTripKeys.add(`${c.venue || ''}|${(c.date || '').slice(0, 4)}`);
    }
  }
  const festivalsAttended = festivalTripKeys.size;

  return {
    totalShows,
    countries: countrySet.size,
    kmTraveled: Math.round(kmTraveled),
    knownDistanceCount,
    busiestYear,
    longestGap,
    firstShow,
    topArtists,
    topVenues,
    topRatedShows,
    farthestShow,
    closestShow,
    totalUniqueArtists,
    mostVisitedCity,
    busiestMonth,
    genreBreakdown,
    festivalsAttended,
  };
}
