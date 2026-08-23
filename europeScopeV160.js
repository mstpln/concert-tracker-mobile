'use strict';

(function attachBandmarkrEuropeScope(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.BandmarkrEuropeScopeV160 = api;
    // dataLib.js predates this shared contract. In the browser it is loaded
    // immediately before this file, so replace the legacy helper with the
    // same country classifier used by scheduled venue research.
    if (typeof root.dlIsEuropeCountry === 'function') root.dlIsEuropeCountry = api.isEuropeCountry;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function normalizeCountry(value) {
    return String(value || '').trim().toLocaleLowerCase('en');
  }

  // BANDMARKR's "EU" product scope is broader than EU membership. Preserve
  // the EU-27 scheduler coverage and add only the non-EU countries already
  // treated as Europe by the app: Norway, Iceland, United Kingdom,
  // Switzerland, Turkey and Serbia. Aliases cover values present in source
  // data plus the ISO-2 forms already accepted by the scheduler.
  const EUROPE_COUNTRY_ALIASES = Object.freeze([
    'Austria', 'AT',
    'Belgium', 'BE',
    'Bulgaria', 'BG',
    'Croatia', 'HR',
    'Cyprus', 'CY',
    'Czechia', 'Czech Republic', 'CZ',
    'Denmark', 'DK',
    'Estonia', 'EE',
    'Finland', 'FI',
    'France', 'FR',
    'Germany', 'DE',
    'Greece', 'GR',
    'Hungary', 'HU',
    'Ireland', 'IE',
    'Italy', 'IT',
    'Latvia', 'LV',
    'Lithuania', 'LT',
    'Luxembourg', 'LU',
    'Malta', 'MT',
    'Netherlands', 'NL',
    'Poland', 'PL',
    'Portugal', 'PT',
    'Romania', 'RO',
    'Slovakia', 'SK',
    'Slovenia', 'SI',
    'Spain', 'ES',
    'Sweden', 'SE',
    'Norway', 'NO',
    'Iceland', 'IS',
    'United Kingdom', 'UK', 'Great Britain', 'GB', 'England',
    'Switzerland', 'CH',
    'Turkey', 'TR',
    'Serbia', 'RS',
  ]);

  const EUROPE_COUNTRY_KEYS = new Set(EUROPE_COUNTRY_ALIASES.map(normalizeCountry));

  function isEuropeCountry(value) {
    const key = normalizeCountry(value);
    return !!key && EUROPE_COUNTRY_KEYS.has(key);
  }

  return Object.freeze({
    EUROPE_COUNTRY_ALIASES,
    normalizeCountry,
    isEuropeCountry,
  });
});
