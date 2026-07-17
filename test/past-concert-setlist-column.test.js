'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('past concert cards retain an interactive third Setlist column when songs exist', () => {
  assert.match(app, /<button type="button" class="link-trigger setlist-trigger" data-toggle-panel="setlist" data-concert-id="\$\{escapeAttr\(c\.id\)\}">\$\{icon\('setlistOrdered'\)\}<span class="link-trigger-label">Setlist \(\$\{songCount\}\)<\/span><span class="details-chevron">\$\{icon\('chevronDown'\)\}<\/span><\/button>/);
  assert.match(app, /\$\{hasSetlist \? `<div class="expand-panel" data-panel="setlist" hidden>\$\{mcSetlistPanelContentHtml\(c\)\}<\/div>` : ''\}/);
});

test('past concert cards reserve a muted, non-interactive Setlist (0) column without songs', () => {
  assert.match(app, /if \(!songCount\) \{\n    return `<span class="link-trigger setlist-trigger is-empty">\$\{icon\('setlistOrdered'\)\}<span class="link-trigger-label">Setlist \(0\)<\/span><\/span>`;/);
  assert.doesNotMatch(app.match(/if \(!songCount\) \{[\s\S]*?\n  \}/)?.[0] || '', /data-toggle-panel|details-chevron|<button/);
});

test('past cards always keep the third column and second-row spacer while upcoming cards remain unchanged', () => {
  assert.match(app, /\$\{isPast \? mcSetlistTriggerCellHtml\(c\) : ''\}/);
  assert.match(app, /\$\{isPast \? '<span class="row-edit-spacer"><\/span>' : ''\}/);
  assert.match(app, /\$\{isPast \? mcLinksRowHtml\(c, true\) : concertPrepGroupHtml\(c\)\}/);
});
