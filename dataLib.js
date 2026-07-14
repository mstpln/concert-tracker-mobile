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

// Groups every concert on record (any tracked band, past or upcoming,
// attending or not) by venue+city for the Concerts tab's Venues sub-tab.
// Unlike dlConcertStats' topVenues (attended-past only, a personal-history
// highlight for the stats screen), this is a directory of every venue in
// the whole database — the Venues tab's own scope, confirmed with the user
// as "every concert on record" rather than just what you've attended.
// Sorted alphabetically by venue name, per the user's chosen default sort.
function dlVenueGroups(concerts) {
  const byKey = new Map();
  for (const c of concerts) {
    if (!c.venue) continue;
    const key = `${c.venue}|${c.city || ''}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, venue: c.venue, city: c.city || '', country: c.country || '', concerts: [] };
      byKey.set(key, group);
    }
    group.concerts.push(c);
    // Some historical entries for the same venue are missing country (e.g.
    // manually backlogged past shows) — fall back to whichever record does
    // have it rather than leaving the group's country blank.
    if (!group.country && c.country) group.country = c.country;
  }
  return [...byKey.values()].sort((a, b) => a.venue.localeCompare(b.venue));
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
  // Added when Familjen (genre: "Electronica / Techno") was found to be the
  // only band in the whole dataset that didn't match any rule above — see
  // the 'other' fallback comment below for the audit that surfaced this.
  { id: 'electronic', label: 'Electronic & Dance', test: (t) => /electro|techno|\bhouse\b|\bedm\b|\bdance\b|synth/.test(t) },
];

// Single catch-all bucket for both "band has no genre at all" and "band has
// a genre but it doesn't match any rule above" — deliberately not split into
// two separate buckets (e.g. "Not tagged yet" vs. "Other") since a live data
// audit found exactly one case of the latter (Familjen, before the
// Electronic & Dance rule was added) and one generic fallback is simpler for
// users to scan than two near-identical ones. Always displayed last in the
// filter dropdown so it reads as a catch-all rather than a "real" genre.
const DL_GENRE_GROUPS = [...DL_GENRE_GROUP_RULES.map((r) => ({ id: r.id, label: r.label })), { id: 'other', label: 'Other' }];

function dlGenreGroupsForBand(band) {
  const raw = (band?.genre || '').trim();
  if (!raw) return ['other'];
  const tokens = raw.split(/[,/]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const groups = new Set();
  for (const t of tokens) {
    for (const rule of DL_GENRE_GROUP_RULES) {
      if (rule.test(t)) groups.add(rule.id);
    }
  }
  return groups.size ? [...groups] : ['other'];
}

// Priority order for single-bucket assignment — used only by the stats
// screen's genre breakdown, never the My Bands filter. Most specific/niche
// genres win over the broad "Rock" catch-all, so a "punk rock" show is
// counted once, as Punk, rather than as Rock — Rock is deliberately last
// since nearly every rock subgenre literally contains the word "rock",
// making it a poor discriminator when something more specific also matches.
const DL_GENRE_PRIORITY_ORDER = ['metal', 'punk', 'folk', 'hiphop_rnb', 'electronic', 'pop', 'rock'];

function dlPrimaryGenreGroupForBand(band) {
  const raw = (band?.genre || '').trim();
  if (!raw) return 'other';
  const tokens = raw.split(/[,/]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const groupId of DL_GENRE_PRIORITY_ORDER) {
    const rule = DL_GENRE_GROUP_RULES.find((r) => r.id === groupId);
    if (tokens.some((t) => rule.test(t))) return groupId;
  }
  return 'other';
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

// Countdown card math (My Concerts, above the upcoming list) for the single
// soonest concert the user is attending — `upcoming[0]` from dlMyConcerts
// above, already sorted ascending by date. Two nested rings: outer tracks
// days-out capped at a 30-day window (so a show booked months ahead just
// renders as a full circle instead of an unreadably thin sliver), inner
// tracks the partial day remaining once you're down to the final stretch.
// Both drain from full towards empty as the show approaches, reaching
// empty exactly at showtime — a countdown timer running out, not a
// progress bar filling up. The day count itself is never capped, even
// though the outer ring's fill is — a show 126 days out still shows "126"
// in the center, just with the ring maxed at full.
const DL_COUNTDOWN_MAX_DAYS = 30;

function dlCountdownParts(targetDate, now = new Date()) {
  const diffMs = Math.max(0, targetDate.getTime() - now.getTime());
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  const outerPct = Math.min(1, diffMs / (DL_COUNTDOWN_MAX_DAYS * 86400000));
  const innerPct = (hours * 3600 + minutes * 60 + seconds) / 86400;
  return { days, hours, minutes, seconds, outerPct, innerPct };
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
// Compact number formatting ("34.2k", "241k") for the front-page stats
// teaser row specifically — that row has to fit 4 metrics side by side on a
// phone width, so "traveled" and "spent" (the two values that can grow
// large) get abbreviated there to keep the row stable regardless of how big
// the real numbers get. The full stats page keeps exact numbers (more room,
// and precision matters more on a dedicated stats screen); this helper is
// only used for the teaser row. One decimal under 100k for a bit of
// precision, whole numbers at 100k+ to stay short.
function dlCompactNumber(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const val = n / 1000;
  const rounded = abs < 100000 ? Math.round(val * 10) / 10 : Math.round(val);
  return `${rounded}k`;
}

// Groups attended concerts into physical "visits" to a venue, so a co-headline
// bill or a multi-day festival counts once, not once per band seen. Two
// concerts at the same venue always merge into one visit when they're on the
// exact same date (e.g. Queens of the Stone Age + System of a Down playing
// the same bill/date). Concerts on consecutive-but-different dates only merge
// when they're festival shows (a multi-day festival like Roskilde) — a band
// playing two separate non-festival nights back-to-back at the same venue
// still counts as two visits. This replaces the older "same venue + same
// year" dedup (used only for festivals' kmTraveled/festivalsAttended), which
// was both too coarse — any two festival editions in the same calendar year
// at a venue would have collapsed together — and missed the same-day,
// different-bill case for regular (non-festival) shows entirely. Concerts
// missing a date can't be reliably clustered, so each becomes its own
// singleton visit rather than being dropped or merged incorrectly.
function dlVenueVisits(concerts) {
  const byVenue = new Map();
  for (const c of concerts) {
    if (!c.venue) continue;
    const key = `${c.venue}|${c.city || ''}`;
    if (!byVenue.has(key)) byVenue.set(key, []);
    byVenue.get(key).push(c);
  }

  const visits = [];
  for (const list of byVenue.values()) {
    const dated = list.filter((c) => c.date).sort((a, b) => new Date(a.date) - new Date(b.date));
    const undated = list.filter((c) => !c.date);

    let cluster = null;
    for (const c of dated) {
      if (cluster) {
        const last = cluster.concerts[cluster.concerts.length - 1];
        const dayDiff = Math.round((new Date(c.date) - new Date(last.date)) / 86400000);
        const bothFestival = c.type === 'festival' && last.type === 'festival';
        if (dayDiff === 0 || (dayDiff === 1 && bothFestival)) {
          cluster.concerts.push(c);
          continue;
        }
      }
      cluster = { venue: c.venue, city: c.city, concerts: [c] };
      visits.push(cluster);
    }
    for (const c of undated) {
      visits.push({ venue: c.venue, city: c.city, concerts: [c] });
    }
  }

  for (const v of visits) {
    v.lastDate = v.concerts[v.concerts.length - 1].date || null;
    v.isFestival = v.concerts.every((c) => c.type === 'festival');
    const withDist = v.concerts.find((c) => typeof c.distanceKm === 'number' && !Number.isNaN(c.distanceKm));
    v.representativeDistanceKm = withDist ? withDist.distanceKm : null;
  }
  return visits;
}

function dlConcertStats(attendedPast, bands = [], upcomingGoing = []) {
  const totalShows = attendedPast.length;
  const bandsById = new Map(bands.map((b) => [b.id, b]));
  // Computed once, shared by kmTraveled, topVenues, and festivalsAttended
  // below — see dlVenueVisits for the clustering rules.
  const visits = dlVenueVisits(attendedPast);

  const countrySet = new Set();
  for (const c of attendedPast) {
    if (c.country) countrySet.add(String(c.country).trim().toLowerCase());
  }

  // Unique venues/cities — simple distinct counts, unaffected by the
  // trip-vs-row distinction below since a Set already dedups regardless of
  // how many bands you saw at the same venue/city. Venue key includes city
  // (matches topVenues' key below) so two different venues that happen to
  // share a name in different cities aren't conflated into one.
  const venueKeySet = new Set();
  const citySet = new Set();
  for (const c of attendedPast) {
    if (c.venue) venueKeySet.add(`${c.venue.trim().toLowerCase()}|${(c.city || '').trim().toLowerCase()}`);
    if (c.city) citySet.add(c.city.trim().toLowerCase());
  }

  // Distance is summed once per physical visit (see dlVenueVisits above), not
  // once per band seen — otherwise a single Roskilde trip where you saw 11
  // bands would count that same round-trip distance 11 times over.
  // knownDistanceCount still counts every individual show with a known
  // distance (festival or not) — it's a coverage caveat for the UI, separate
  // from the dedup applied to the sum itself.
  //
  // c.distanceKm itself is one-way (home -> venue, same value the Concerts
  // tab's "203 km away" labels and the Nearby filter use). "km traveled" is
  // meant to represent actual total travel, which includes the way back home
  // too — so each visit's one-way distance is doubled here before being added
  // to the total.
  let kmTraveled = 0;
  let knownDistanceCount = 0;
  for (const c of attendedPast) {
    if (typeof c.distanceKm === 'number' && !Number.isNaN(c.distanceKm)) knownDistanceCount += 1;
  }
  for (const v of visits) {
    if (typeof v.representativeDistanceKm === 'number') kmTraveled += v.representativeDistanceKm * 2;
  }

  // Ticket cost. totalSpend sums ticketPrice*ticketQuantity across every show
  // (past AND upcoming-going, see upcomingGoing param) that has a price
  // entered — tickets already bought for a future show are real money spent,
  // so they count toward the running total the same as a past show would.
  // knownSpendCount says how many shows (past+upcoming combined) that's based
  // on; knownSpendCountPast is the past-only subset, used for the "from X of
  // Y shows" caveat against totalShows (which is past-only) so that caveat
  // never reads oddly if upcoming shows happen to have more prices entered
  // than past ones. averageTicketPrice is the mean *per-ticket* price across
  // every ticket bought, not per-show — so a 2-ticket night isn't
  // double-weighted against a 1-ticket night when averaging.
  let totalSpend = 0;
  let knownSpendCount = 0;
  let knownSpendCountPast = 0;
  let totalTicketsWithPrice = 0;
  for (const c of [...attendedPast, ...upcomingGoing]) {
    if (typeof c.ticketPrice !== 'number' || Number.isNaN(c.ticketPrice)) continue;
    const qty = c.ticketQuantity || 1;
    totalSpend += c.ticketPrice * qty;
    totalTicketsWithPrice += qty;
    knownSpendCount += 1;
  }
  for (const c of attendedPast) {
    if (typeof c.ticketPrice === 'number' && !Number.isNaN(c.ticketPrice)) knownSpendCountPast += 1;
  }
  const averageTicketPrice = totalTicketsWithPrice ? Math.round(totalSpend / totalTicketsWithPrice) : null;

  // % of past concerts with a ticket price logged. Deliberately per-show
  // (matches knownSpendCountPast above), not per-trip — ticket price is
  // entered per concert already (each band's share of a festival ticket is
  // split across its rows manually), so a row-level percentage already
  // reflects reality without needing trip-based dedup.
  const pctWithTicketPrice = totalShows ? Math.round((knownSpendCountPast / totalShows) * 100) : 0;

  // Per-year ticket spend — same past+upcoming pool as totalSpend above, and
  // same per-row basis as pctWithTicketPrice (not trip-deduped) for the same
  // reason: split festival prices already sum correctly row-by-row.
  const yearSpend = new Map();
  for (const c of [...attendedPast, ...upcomingGoing]) {
    if (typeof c.ticketPrice !== 'number' || Number.isNaN(c.ticketPrice)) continue;
    const year = (c.date || '').slice(0, 4);
    if (!year) continue;
    const qty = c.ticketQuantity || 1;
    const existing = yearSpend.get(year) || { year, total: 0, count: 0 };
    existing.total += c.ticketPrice * qty;
    existing.count += 1;
    yearSpend.set(year, existing);
  }
  let highestSpendYear = null;
  let lowestSpendYear = null;
  const spendYears = [...yearSpend.values()];
  for (const y of spendYears) {
    if (!highestSpendYear || y.total > highestSpendYear.total) highestSpendYear = y;
    if (!lowestSpendYear || y.total < lowestSpendYear.total) lowestSpendYear = y;
  }
  // A single year of data makes "lowest" a meaningless restatement of
  // "highest" — only show both once there are at least two distinct years.
  if (spendYears.length < 2) lowestSpendYear = null;

  // Overall average rating + % of past concerts rated — both per-show, same
  // basis as the rest of the ratings-related stats (you rate each concert
  // individually, per the app's existing rating flow).
  let ratingSum = 0;
  let ratedCount = 0;
  for (const c of attendedPast) {
    if (typeof c.rating === 'number' && !Number.isNaN(c.rating)) {
      ratingSum += c.rating;
      ratedCount += 1;
    }
  }
  const overallAverageRating = ratedCount ? Math.round((ratingSum / ratedCount) * 10) / 10 : null;
  const pctWithRating = totalShows ? Math.round((ratedCount / totalShows) * 100) : 0;

  // Total songs heard live — summed per-show (setlist.fm data), same as
  // longestSetlist below.
  let totalSongsHeardLive = 0;
  for (const c of attendedPast) {
    totalSongsHeardLive += c.setlist?.songs?.length || 0;
  }

  // Busiest year counts trips (see dlVenueVisits above), not individual
  // concert rows — a multi-band festival day, or a multi-day festival,
  // counts once, not once per band seen. Consistent with the
  // kmTraveled/topVenues/festivalsAttended trip-based fix above.
  const yearCounts = new Map();
  for (const v of visits) {
    const year = (v.lastDate || '').slice(0, 4);
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
  // Most recent past show, and how long ago that was — the "time since last
  // concert" tile. Reuses sortedByDate (already sorted ascending) rather than
  // re-sorting.
  const lastShow = sortedByDate.length ? sortedByDate[sortedByDate.length - 1] : null;
  const daysSinceLastShow = lastShow
    ? Math.round((Date.now() - new Date(lastShow.date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))
    : null;

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

  // Counts visits (see dlVenueVisits), not individual concert rows — a
  // co-headline bill or a multi-day festival counts once, not once per band.
  const venueVisitCounts = new Map();
  for (const v of visits) {
    const key = `${v.venue}|${v.city || ''}`;
    const existing = venueVisitCounts.get(key) || { venue: v.venue, city: v.city, count: 0, lastDate: null };
    existing.count += 1;
    if (v.lastDate && (!existing.lastDate || v.lastDate > existing.lastDate)) existing.lastDate = v.lastDate;
    venueVisitCounts.set(key, existing);
  }
  const topVenues = [...venueVisitCounts.values()]
    .sort((a, b) => b.count - a.count || (b.lastDate || '').localeCompare(a.lastDate || ''))
    .slice(0, 5);

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

  // Cheapest/priciest ticket — per-ticket price (not total for the night),
  // past shows only, same pool as farthest/closest above. Free shows
  // (ticketPrice: 0, see the Free toggle) still count as a known price for
  // averageTicketPrice above, but a Free show isn't an interesting answer to
  // "what's the cheapest ticket you've bought" — that tile is scoped to
  // shows you actually paid for, so Free is deliberately excluded here and
  // cheapestTicket becomes the cheapest PAID ticket instead.
  let cheapestTicket = null;
  let priciestTicket = null;
  for (const c of attendedPast) {
    if (typeof c.ticketPrice !== 'number' || Number.isNaN(c.ticketPrice)) continue;
    if (c.ticketPrice > 0 && (!cheapestTicket || c.ticketPrice < cheapestTicket.ticketPrice)) cheapestTicket = c;
    if (!priciestTicket || c.ticketPrice > priciestTicket.ticketPrice) priciestTicket = c;
  }

  // Longest setlist on record (setlist.fm data, past shows only).
  let longestSetlist = null;
  for (const c of attendedPast) {
    const songCount = c.setlist?.songs?.length || 0;
    if (songCount === 0) continue;
    if (!longestSetlist || songCount > longestSetlist.setlist.songs.length) longestSetlist = c;
  }

  const totalUniqueArtists = new Set(attendedPast.map((c) => c.bandId)).size;

  // Trip-based, same reasoning as busiestYear above — a festival day (or
  // multi-day festival) visiting a city counts once, not once per band.
  const cityCounts = new Map();
  for (const v of visits) {
    if (!v.city) continue;
    const key = v.city.trim();
    const existing = cityCounts.get(key) || { city: v.city, count: 0, lastDate: null };
    existing.count += 1;
    if (v.lastDate && (!existing.lastDate || v.lastDate > existing.lastDate)) existing.lastDate = v.lastDate;
    cityCounts.set(key, existing);
  }
  let mostVisitedCity = null;
  for (const v of cityCounts.values()) {
    if (!mostVisitedCity || v.count > mostVisitedCity.count || (v.count === mostVisitedCity.count && (v.lastDate || '') > (mostVisitedCity.lastDate || ''))) {
      mostVisitedCity = v;
    }
  }

  // Calendar month aggregated across every year (not tied to a specific
  // year, unlike busiestYear) — "you go to more trips in August than any
  // other month", regardless of which year each August trip happened in.
  // Trip-based, same reasoning as busiestYear above.
  const monthCounts = new Map();
  for (const v of visits) {
    if (!v.lastDate) continue;
    const m = Number(v.lastDate.slice(5, 7));
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

  // Unique festival visits attended (see dlVenueVisits above) — e.g. three
  // separate years of Roskilde count as 3, not as the 24 individual band
  // performances seen across them.
  const festivalsAttended = visits.filter((v) => v.isFestival).length;

  return {
    totalShows,
    countries: countrySet.size,
    uniqueVenues: venueKeySet.size,
    uniqueCities: citySet.size,
    kmTraveled: Math.round(kmTraveled),
    knownDistanceCount,
    totalSpend: Math.round(totalSpend),
    knownSpendCount,
    knownSpendCountPast,
    pctWithTicketPrice,
    highestSpendYear,
    lowestSpendYear,
    averageTicketPrice,
    overallAverageRating,
    ratedCount,
    pctWithRating,
    totalSongsHeardLive,
    busiestYear,
    longestGap,
    firstShow,
    lastShow,
    daysSinceLastShow,
    topArtists,
    topVenues,
    topRatedShows,
    farthestShow,
    closestShow,
    cheapestTicket,
    priciestTicket,
    longestSetlist,
    totalUniqueArtists,
    mostVisitedCity,
    busiestMonth,
    genreBreakdown,
    festivalsAttended,
  };
}
