'use strict';

(function (root) {
  const ALLOWED_HOSTS = new Set(['qa.invalid', 'example.invalid']);
  const FORBIDDEN = ['ticketmaster.', 'spotify.', 'setlist.fm', 'musicbrainz.', 'tavily.', 'groq.', 'open-meteo.', 'workers.dev', 'github.io/concert-tracker-mobile'];
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  const QA_NOW = Date.parse('2027-07-16T12:00:00.000Z');

  function validateUrl(value, label, errors) {
    if (value == null || value === '') return;
    try {
      const url = new URL(String(value));
      const href = url.href.toLowerCase();
      if (url.protocol !== 'https:') errors.push(`${label} must use HTTPS`);
      if (!ALLOWED_HOSTS.has(url.hostname)) errors.push(`${label} must use a fictional QA domain`);
      if (FORBIDDEN.some((part) => href.includes(part))) errors.push(`${label} contains a forbidden provider or production domain`);
    } catch {
      errors.push(`${label} is not a valid URL`);
    }
  }

  function trustedLifecycleSpotifyUrl(value) {
    try {
      const url = new URL(String(value));
      const parts = url.pathname.split('/').filter(Boolean);
      return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && parts.length === 2 && parts[0] === 'album' && /^[A-Za-z0-9]+$/.test(parts[1]);
    } catch { return false; }
  }

  function uniqueIds(rows, label, errors) {
    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !row.id.trim()) {
        errors.push(`${label} item is missing an id`);
        continue;
      }
      if (seen.has(row.id)) errors.push(`${label} contains duplicate id ${row.id}`);
      seen.add(row.id);
    }
  }

  function providerRecords(band) {
    return [band?.musicbrainz, band?.musicbrainz?.ticketmaster, band?.musicbrainz?.spotify].filter(Boolean);
  }

  function validateQaFixtures(fixtures) {
    const errors = [];
    if (!Array.isArray(fixtures?.bands)) errors.push('bands must be an array');
    if (!Array.isArray(fixtures?.concerts)) errors.push('concerts must be an array');
    if (!Array.isArray(fixtures?.news)) errors.push('news must be an array');
    if (!fixtures?.apiUsage || typeof fixtures.apiUsage !== 'object' || Array.isArray(fixtures.apiUsage)) errors.push('apiUsage must be an object');
    if (errors.length) return { valid: false, errors, summary: { bands: 0, concerts: 0, news: 0 } };

    const { bands, concerts, news, apiUsage } = fixtures;
    uniqueIds(bands, 'bands', errors);
    uniqueIds(concerts, 'concerts', errors);
    uniqueIds(news, 'news', errors);
    const bandIds = new Set(bands.map((band) => band.id));

    for (const concert of concerts) {
      if (!bandIds.has(concert.bandId)) errors.push(`concert ${concert.id} references unknown bandId ${concert.bandId}`);
      const ticketIds = new Set();
      for (const ticket of concert.ownedTickets || []) {
        if (!SAFE_ID.test(ticket?.id || '')) errors.push(`concert ${concert.id} has unsafe ticket id`);
        if (ticketIds.has(ticket.id)) errors.push(`concert ${concert.id} has duplicate ticket id ${ticket.id}`);
        ticketIds.add(ticket.id);
        if (!['pdf', 'url'].includes(ticket.type)) errors.push(`ticket ${ticket.id} has invalid type`);
        if (!ticket.addedAt || !Number.isFinite(Date.parse(ticket.addedAt))) errors.push(`ticket ${ticket.id} is missing a valid addedAt`);
        if (ticket.type === 'pdf' && (!Number.isInteger(ticket.sizeBytes) || ticket.sizeBytes <= 0 || ticket.sizeBytes > MAX_PDF_BYTES)) errors.push(`ticket ${ticket.id} has invalid PDF size`);
        if (ticket.type === 'url') validateUrl(ticket.url, `ticket ${ticket.id} URL`, errors);
      }
    }
    for (const item of news) if (!bandIds.has(item.bandId)) errors.push(`news ${item.id} references unknown bandId ${item.bandId}`);

    function inspectUrls(value, path = 'fixtures') {
      if (Array.isArray(value)) return value.forEach((item, index) => inspectUrls(item, `${path}[${index}]`));
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        const next = `${path}.${key}`;
        if (/url$/i.test(key) && item != null && item !== '') {
          if (key === 'spotifyUrl' && value.lifecycleStage && trustedLifecycleSpotifyUrl(item)) continue;
          validateUrl(item, next, errors);
        }
        else inspectUrls(item, next);
      }
    }
    inspectUrls(fixtures);

    const records = bands.flatMap(providerRecords);
    const hasStatus = (status) => records.some((record) => record.status === status);
    const checks = [
      [bands.some((band) => ['musicbrainz', 'ticketmaster', 'spotify'].every((provider) => { const r = provider === 'musicbrainz' ? band.musicbrainz : band.musicbrainz?.[provider]; return r && ['confirmed', 'manual_confirmed'].includes(r.status) && (provider === 'musicbrainz' ? r.mbid : r.id); })), 'missing fully confirmed provider identity scenario'],
      [hasStatus('manual_confirmed'), 'missing manual_confirmed identity scenario'],
      [hasStatus('needs_review'), 'missing needs_review identity scenario'],
      [records.some((record) => (record.reviewCandidates || []).length >= 2), 'missing multiple review candidates scenario'],
      [hasStatus('no_match'), 'missing no_match identity scenario'],
      [hasStatus('error'), 'missing error identity scenario'],
      [records.some((record) => Date.parse(record.nextEligibleCheckAt || '') > QA_NOW), 'missing future retry scenario'],
      [records.some((record) => Number.isFinite(Date.parse(record.nextEligibleCheckAt || '')) && Date.parse(record.nextEligibleCheckAt) <= QA_NOW && !['confirmed', 'manual_confirmed'].includes(record.status)), 'missing retry eligible now scenario'],
      [bands.some((band) => band.favorite), 'missing favorite band scenario'],
      [bands.some((band) => band.muted), 'missing muted band scenario'],
      [bands.some((band) => !concerts.some((concert) => concert.bandId === band.id) && !news.some((item) => item.bandId === band.id)), 'missing empty-profile band scenario'],
      [bands.some((band) => band.futureFeatureData?.keep), 'missing unknown future band field scenario'],
      [concerts.some((concert) => concert.date === '2027-07-16'), 'missing show-day concert scenario'],
      [concerts.some((concert) => concert.attended && concert.date < '2027-07-16'), 'missing attended past concert scenario'],
      [concerts.some((concert) => concert.date > '2027-07-16'), 'missing upcoming concert scenario'],
      [concerts.some((concert) => concert.ownedTickets?.length === 1 && concert.ownedTickets[0].type === 'pdf'), 'missing one-PDF-ticket scenario'],
      [concerts.some((concert) => concert.ownedTickets?.length === 1 && concert.ownedTickets[0].type === 'url'), 'missing one-URL-ticket scenario'],
      [concerts.some((concert) => concert.ownedTickets?.length === 2 && concert.ownedTickets.every((ticket) => ticket.type === 'pdf')), 'missing two-PDF-ticket scenario'],
      [concerts.some((concert) => concert.prepChecklist && Object.values(concert.prepChecklist).some(Boolean) && Object.values(concert.prepChecklist).some((value) => !value)), 'missing partial checklist scenario'],
      [concerts.some((concert) => concert.prepChecklist && Object.values(concert.prepChecklist).length && Object.values(concert.prepChecklist).every(Boolean)), 'missing complete checklist scenario'],
      [concerts.some((concert) => concert.predictedSetlist?.status === 'ready'), 'missing predicted setlist scenario'],
      [concerts.some((concert) => concert.setlist?.songs?.length), 'missing actual setlist scenario'],
      [concerts.some((concert) => concert.weather?.status === 'ready'), 'missing weather ready scenario'],
      [concerts.some((concert) => concert.weather?.status === 'unavailable'), 'missing weather unavailable scenario'],
      [concerts.some((concert) => concert.sourceProvider === 'ticketmaster'), 'missing Ticketmaster source scenario'],
      [concerts.some((concert) => concert.sourceProvider === 'tavily_groq'), 'missing Tavily/Groq source scenario'],
      [concerts.some((concert) => concert.futureFeatureData || concert.unknownProviderFutureField), 'missing unknown future concert field scenario'],
      [news.some((item) => item.category === 'album'), 'missing album alert scenario'],
      [news.some((item) => item.category === 'ep'), 'missing EP alert scenario'],
      [news.some((item) => item.category === 'single'), 'missing single alert scenario'],
      [news.some((item) => item.category === 'concert'), 'missing concert alert scenario'],
      [news.some((item) => item.category === 'news'), 'missing general news scenario'],
      [news.some((item) => item.read === true) && news.some((item) => item.read === false), 'missing read/unread scenarios'],
      [news.some((item) => item.saved === true) && news.some((item) => item.saved === false), 'missing saved/unsaved scenarios'],
    ];
    for (const [ok, message] of checks) if (!ok) errors.push(message);
    for (const provider of ['ticketmaster', 'tavily', 'groq', 'setlistfm', 'spotify', 'musicbrainz', 'geocode', 'weather']) if (!apiUsage[provider]) errors.push(`apiUsage is missing ${provider}`);

    return { valid: errors.length === 0, errors: [...new Set(errors)], summary: { bands: bands.length, concerts: concerts.length, news: news.length } };
  }

  const api = { validateQaFixtures };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LiveVaultQaFixtureValidator = api;
})(typeof window !== 'undefined' ? window : globalThis);
