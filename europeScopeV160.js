'use strict';

(function attachBandmarkrEuropeScope(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.BandmarkrEuropeScopeV160 = api;
    // dataLib.js predates this shared contract. In the browser it is loaded
    // immediately before this file, so replace the legacy global helper with
    // the canonical implementation consumed by both UI filters and Node jobs.
    if (typeof root.dlIsEuropeCountry === 'function') root.dlIsEuropeCountry = api.isEuropeCountry;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function normalizeCountry(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  // BANDMARKR's visible "EU" tag means Europe, not European Union membership.
  // Keep aliases here so every browser filter and scheduled research lane uses
  // one product-level definition instead of maintaining independent country lists.
  const EUROPE_COUNTRY_ALIASES = Object.freeze([
    'Albania', 'AL',
    'Andorra', 'AD',
    'Armenia', 'AM',
    'Austria', 'AT',
    'Azerbaijan', 'AZ',
    'Belarus', 'BY',
    'Belgium', 'BE',
    'Bosnia and Herzegovina', 'Bosnia & Herzegovina', 'Bosnia', 'BA',
    'Bulgaria', 'BG',
    'Croatia', 'HR',
    'Cyprus', 'CY',
    'Czechia', 'Czech Republic', 'CZ',
    'Denmark', 'DK',
    'Estonia', 'EE',
    'Finland', 'FI',
    'France', 'FR',
    'Georgia', 'GE',
    'Germany', 'DE',
    'Greece', 'GR',
    'Hungary', 'HU',
    'Iceland', 'IS',
    'Ireland', 'IE',
    'Italy', 'IT',
    'Kosovo', 'XK',
    'Latvia', 'LV',
    'Liechtenstein', 'LI',
    'Lithuania', 'LT',
    'Luxembourg', 'LU',
    'Malta', 'MT',
    'Moldova', 'Republic of Moldova', 'MD',
    'Monaco', 'MC',
    'Montenegro', 'ME',
    'Netherlands', 'NL',
    'North Macedonia', 'Macedonia', 'MK',
    'Norway', 'NO',
    'Poland', 'PL',
    'Portugal', 'PT',
    'Romania', 'RO',
    'Russia', 'Russian Federation', 'RU',
    'San Marino', 'SM',
    'Serbia', 'RS',
    'Slovakia', 'SK',
    'Slovenia', 'SI',
    'Spain', 'ES',
    'Sweden', 'SE',
    'Switzerland', 'CH',
    'Turkey', 'Türkiye', 'TR',
    'Ukraine', 'UA',
    'United Kingdom', 'UK', 'Great Britain', 'GB',
    'England', 'Scotland', 'Wales', 'Northern Ireland',
    'Vatican City', 'Holy See', 'VA',
    'Aland Islands', 'Åland Islands', 'AX',
    'Faroe Islands', 'FO',
    'Gibraltar', 'GI',
    'Guernsey', 'GG',
    'Isle of Man', 'IM',
    'Jersey', 'JE',
    'Svalbard and Jan Mayen', 'SJ',
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
