'use strict';

const EuropeScope = require('../../europeScopeV160');

// Only automatic provider observations are gated here. Existing user-owned,
// attended and saved concerts must never be removed by regional filtering.
function canAutoAdmitConcert(candidate) {
  return !!candidate && typeof candidate === 'object'
    && EuropeScope.isEuropeCountry(candidate.country);
}

function europeOnlyCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).filter(canAutoAdmitConcert);
}

module.exports = { canAutoAdmitConcert, europeOnlyCandidates };
