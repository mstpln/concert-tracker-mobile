'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const marker = nextName.startsWith('const ') ? nextName : `function ${nextName}`;
  const end = app.indexOf(marker, start);
  return app.slice(start, end);
}

test('past concert cards render one ordered Ticket, Playlist, Photos, Setlist, Rating & notes detail group', () => {
  const row = functionSource('myConcertRowHtml', 'venueAddressLinkHtml');
  assert.match(row, /\$\{isPast \? pastConcertDetailsGroupHtml\(c\) : concertPrepGroupHtml\(c\)\}/);
  assert.doesNotMatch(row, /ticketCostBlockHtml|mcLinksRowHtml|concertReviewHtml/);
  const details = functionSource('pastConcertDetailsGroupHtml', 'const PREP_CHECKLIST');
  const labels = ['Ticket', 'Playlist', 'Photos', 'Setlist'];
  let at = 0;
  for (const label of labels) {
    const next = details.indexOf(`'${label}'`, at);
    assert.ok(next >= at, `${label} follows the previous row`);
    at = next + 1;
  }
  assert.ok(details.indexOf('pastRatingDetailsHtml(c)') > at, 'rating remains last');
  assert.doesNotMatch(details, /Weather forecast|Predicted setlist|Checklist/);
});

test('past rows reuse the shared preparation structure with accessible up/down chevrons and one open panel state', () => {
  const detailRow = functionSource('pastDetailRowHtml', 'pastRatingDetailsHtml');
  assert.match(detailRow, /class="concert-prep-row past-detail-row/);
  assert.match(detailRow, /data-prep-toggle="\$\{id\}" aria-expanded="\$\{open\}" aria-controls=/);
  assert.match(detailRow, /icon\('chevronDown'\)/);
  assert.doesNotMatch(detailRow, /chevronRight/);
  assert.match(app, /group\.querySelectorAll\('\.concert-prep-panel'\).*item\.hidden = true/);
  assert.match(app, /prepOpenPanels\.set\(group\.dataset\.concertId, btn\.dataset\.prepToggle\)/);
  assert.match(css, /\.past-concert-details-group \{ background: var\(--surface-muted\); \}/);
  assert.match(css, /\.past-rating-details \.concert-prep-row \{ border-bottom: 0; \}/);
});

test('past Ticket uses the exact current summary and panel while preserving ticket cache hydration', () => {
  const details = functionSource('pastConcertDetailsGroupHtml', 'const PREP_CHECKLIST');
  assert.match(details, /ticketPrepSummaryHtml\(c\), ticketPreparationPanelHtml\(c\), \{ statusHtml: true \}/);
  const handler = functionSource('wireMyConcertsHandlers', 'pastConcertYearOptionsHtml');
  assert.match(handler, /btn\.dataset\.prepToggle === 'ticket'.*hydrateTicketCacheStatus\(concert, refresh\)/);
  assert.match(app, /const pdfOpenButtons = items\.filter\(\(item\) => item\.type === 'pdf'\)\.map/);
});

test('past manual Playlist and Photos panels have their own add, edit, remove and save path without prediction content', () => {
  const panel = functionSource('pastManualLinkPanelHtml', 'pastDetailRowHtml');
  assert.match(panel, /past-link-edit-btn/);
  assert.match(panel, /past-link-remove-btn/);
  assert.match(panel, /cfg\.formFn\(c\)/);
  assert.doesNotMatch(panel, /Predicted mix|Create from Predicted Setlist|confidence/i);
  const handler = functionSource('wireMyConcertsHandlers', 'pastConcertYearOptionsHtml');
  assert.match(handler, /querySelectorAll\('\.past-link-edit-btn'\)/);
  assert.match(handler, /querySelectorAll\('\.past-link-remove-btn'\)/);
  assert.match(handler, /patchLatestConcert\(concertId, \(latest\) => \(\{ \.\.\.latest, \[cfg\.field\]: null \}\)\)/);
  assert.match(handler, /patchLatestConcert\(concertId, \(latest\) => \(\{ \.\.\.latest, playlistUrl: playlistUrl \|\| null \}\)\)/);
  assert.match(handler, /patchLatestConcert\(concertId, \(latest\) => \(\{ \.\.\.latest, photoUrl: photoUrl \|\| null \}\)\)/);
});

test('past Setlist shows the real song count and preserves actual-setlist content, while a missing setlist is noninteractive', () => {
  const details = functionSource('pastConcertDetailsGroupHtml', 'const PREP_CHECKLIST');
  assert.match(details, /hasSetlist \? `\$\{c\.setlist\.songs\.length\} songs` : 'Not available'/);
  assert.match(details, /hasSetlist \? `<div class="prep-section past-setlist-panel">\$\{mcSetlistPanelContentHtml\(c\)\}<\/div>` : ''/);
  assert.match(details, /\{ expandable: hasSetlist \}/);
  const detailRow = functionSource('pastDetailRowHtml', 'pastRatingDetailsHtml');
  const unavailable = detailRow.slice(detailRow.indexOf('if (!expandable)'), detailRow.indexOf('const open'));
  assert.match(unavailable, /<div class="concert-prep-row past-detail-row is-unavailable">/);
  assert.doesNotMatch(unavailable, /<button|details-chevron|concert-prep-panel/);
  const actual = functionSource('mcSetlistPanelContentHtml', 'pastManualLinkPanelHtml');
  assert.match(actual, /setlist-encore-divider/);
  assert.match(actual, /setlist-cover-tag/);
  assert.match(actual, /setlist-insight-context/);
  assert.match(actual, /setlist-attribution/);
});

test('past Rating & notes always keeps saved rating and wrapping notes visible, and Save/Cancel safely close its panel', () => {
  const rating = functionSource('pastRatingDetailsHtml', 'pastConcertDetailsGroupHtml');
  assert.match(rating, /starsHtml\(c\.rating\)/);
  assert.match(rating, /Not rated/);
  assert.match(rating, /No notes added/);
  assert.match(rating, /reviewFormHtml\(c, \{ includeCancel: true \}\)/);
  assert.doesNotMatch(rating, /Edit rating|Add rating/);
  const handler = functionSource('wireMyConcertsHandlers', 'pastConcertYearOptionsHtml');
  assert.match(handler, /querySelectorAll\('\.past-review-cancel-btn'\)[\s\S]*?prepOpenPanels\.delete/);
  assert.match(handler, /patchLatestConcert\(concertId, \(latest\) => \(\{ \.\.\.latest, rating: rating \|\| null, notes: notes \|\| null \}\)\)/);
  assert.match(handler, /btn\.closest\('\.past-concert-details-group'\).*prepOpenPanels\.delete/);
  assert.match(css, /\.past-rating-saved \.review-notes \{[^}]*overflow-wrap: anywhere; white-space: normal;/);
});

test('past row interactions remain inside the card while ordinary card areas keep profile navigation', () => {
  const handler = functionSource('wireMyConcertsHandlers', 'pastConcertYearOptionsHtml');
  assert.match(handler, /ev\.target\.closest\('\.concert-prep-group'\)/);
  assert.match(handler, /group\.addEventListener\('click', \(ev\) => ev\.stopPropagation\(\)\)/);
  assert.match(handler, /openProfile\(row\.dataset\.bandId\)/);
});
