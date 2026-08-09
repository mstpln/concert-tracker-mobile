'use strict';

const enrichment = require('./listening-enrichment-engine');

const DEFAULT_MAX_STEPS = 25;
const HARD_MAX_STEPS = 100;
const MAX_DOCUMENT_RECORDS = 100000;
const CHECKPOINT_KIND = 'livevault-listening-maintenance-checkpoint';
const PROVIDERS = new Set(['spotify', 'musicbrainz', 'listenbrainz']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function checkpointState(value = null, now = new