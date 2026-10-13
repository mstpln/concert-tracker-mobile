'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'bandmarkrVisualV187.css'), 'utf8');
const match = css.match(/#screen-concerts \.discover-actions \.discover-spotify\s*\{([^}]+)\}/);

test('v192 Spotify CTA alone has a subtle top highlight, never the v191 radial metallic vignette', () => {
  assert.ok(match, 'Spotify style must be explicitly scoped to Discover > Bands');
  const style = match[1];
  assert.match(style, /linear-gradient\(180deg/);
  assert.match(style, /rgba\(255,255,255,\.08\)/);
  assert.match(style, /linear-gradient\(95deg/);
  assert.match(style, /#148749 48%/);
  assert.doesNotMatch(style, /radial-gradient|box-shadow|padding|height|width|border-radius|font-size|transition|animation/);
  assert.match(style, /color: #fff/);
});

test('v192 preserves the existing blue CTAs and Settings divider rules', () => {
  assert.match(css, /\.btn-primary,\s*\n\.discover-actions \.discover-add/);
  assert.match(css, /#screen-settings \.settings-v123-section \+ \.settings-v123-section::before/);
  assert.match(css, /#screen-settings \.settings-v123-section-accent/);
});
