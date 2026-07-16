'use strict';
// Browser-only Open-Meteo adapter.  It persists compact normalized cache data
// in chrome.storage.local and deliberately never touches remote concert data.
(function () {
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const CACHE_HOURS = 6;
  const FAILED_LOCATION_HOURS = 24;
  const inFlight = new Map();
  const normalize = (value) => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const partsFor = (date, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const localDate = (date, timezone) => { const p = partsFor(date, timezone); return `${p.year}-${p.month}-${p.day}`; };
  const dateDays = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
  const hour = (value) => Number(String(value || '').slice(11, 13));
  const condition = (code, time) => {
    const night = hour(time) < 6 || hour(time) >= 20;
    if (code === 0) return { key: night ? 'clearNight' : 'clearDay', text: 'Clear' };
    if ([1, 2].includes(code)) return { key: night ? 'partlyCloudyNight' : 'partlyCloudyDay', text: code === 1 ? 'Mostly clear' : 'Partly cloudy' };
    if (code === 3) return { key: 'cloudy', text: 'Cloudy' };
    if ([45, 48].includes(code)) return { key: 'fog', text: 'Fog' };
    if ([51, 53, 55, 56, 57].includes(code)) return { key: 'drizzle', text: 'Light rain' };
    if ([61, 63, 66, 67, 80, 81].includes(code)) return { key: 'rain', text: 'Rain' };
    if ([65, 82].includes(code)) return { key: 'heavyRain', text: 'Heavy rain' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { key: 'snow', text: 'Snow' };
    if ([95, 96, 99].includes(code)) return { key: 'thunderstorm', text: 'Thunderstorms' };
    return { key: 'unknown', text: 'Weather unavailable' };
  };
  function coordinateFrom(concert) {
    const latitude = Number(concert.latitude ?? concert.lat ?? concert.venueLatitude ?? concert.venueLat);
    const longitude = Number(concert.longitude ?? concert.lng ?? concert.venueLongitude ?? concert.venueLng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude, timezone: concert.timezone || null } : null;
  }
  function storageKey(concert, location) { return `weather:forecast:${concert.id}:${concert.date}:${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`; }
  function locationKey(concert) { return `weather:location:${normalize(concert.venue)}:${normalize(concert.city)}:${normalize(concert.country)}`; }
  async function getStored(key) { return (await chrome.storage.local.get(key))[key] || null; }
  async function setStored(key, value) { await chrome.storage.local.set({ [key]: value }); }
  function availability(concert, timezone, now = new Date()) {
    if (!concert?.date) return { available: false, days: Infinity, availableDate: null };
    const days = dateDays(concert.date, localDate(now, timezone));
    return { available: days >= 0 && days <= 10, days, availableDate: days > 10 ? new Date(Date.parse(`${concert.date}T00:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10) : null };
  }
  async function resolveLocation(concert, fetchImpl = fetch) {
    const direct = coordinateFrom(concert); if (direct) return { kind: 'ok', ...direct };
    const key = locationKey(concert); const cached = await getStored(key); const now = Date.now();
    if (cached?.expiresAt && Date.parse(cached.expiresAt) > now) return cached;
    const city = String(concert.city || '').trim(); const country = normalize(concert.country);
    if (!city || !country) { const unavailable = { kind: 'unavailable', expiresAt: new Date(now + FAILED_LOCATION_HOURS * 3600000).toISOString() }; await setStored(key, unavailable); return unavailable; }
    const url = new URL(GEOCODE_URL); url.searchParams.set('name', city); url.searchParams.set('count', '5'); url.searchParams.set('language', 'en');
    let data; try { const response = await fetchImpl(url.toString()); if (!response.ok) throw new Error('geocode'); data = await response.json(); } catch { data = null; }
    const matches = (data?.results || []).filter((item) => normalize(item.country) === country && normalize(item.name) === normalize(city));
    const unique = matches.length === 1 ? matches[0] : null;
    const result = unique ? { kind: 'ok', latitude: unique.latitude, longitude: unique.longitude, timezone: unique.timezone || null, expiresAt: new Date(now + 30 * 86400000).toISOString() } : { kind: 'unavailable', expiresAt: new Date(now + FAILED_LOCATION_HOURS * 3600000).toISOString() };
    await setStored(key, result); return result;
  }
  function desiredHours(concert) {
    const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(String(concert.time || ''));
    if (!match) return [17, 19, 21, 23]; const start = Number(match[0].slice(0, 2)); return [...new Set([Math.max(0, start - 2), start, Math.min(23, start + 2), start <= 20 ? Math.min(23, start + 4) : null].filter(Number.isFinite))];
  }
  function normalizeForecast(data, concert, location, now = new Date()) {
    const hourly = data?.hourly; const times = hourly?.time;
    if (!Array.isArray(times) || !times.length) return null;
    const wanted = desiredHours(concert); const values = times.map((time, index) => ({ time, index })).filter((entry) => entry.time.slice(0, 10) === concert.date && wanted.includes(hour(entry.time))).slice(0, 4).map(({ time, index }) => {
      const weatherCode = Number(hourly.weather_code?.[index]); const mapped = condition(weatherCode, time);
      return { time, temperatureC: Math.round(Number(hourly.temperature_2m?.[index])), apparentTemperatureC: Math.round(Number(hourly.apparent_temperature?.[index])), precipitationProbability: Math.round(Number(hourly.precipitation_probability?.[index])), windSpeedKmh: Math.round(Number(hourly.wind_speed_10m?.[index])), weatherCode, conditionKey: mapped.key, conditionText: mapped.text };
    }).filter((item) => Number.isFinite(item.temperatureC) && Number.isFinite(item.precipitationProbability) && Number.isFinite(item.windSpeedKmh));
    if (!values.length) return null;
    return { concertId: concert.id, concertDate: concert.date, fetchedAt: now.toISOString(), expiresAt: new Date(now.getTime() + CACHE_HOURS * 3600000).toISOString(), latitude: location.latitude, longitude: location.longitude, timezone: data.timezone || location.timezone || null, provider: 'open-meteo', hours: values };
  }
  async function load(concert, { fetchImpl = fetch, force = false, now = new Date() } = {}) {
    // This first local-date guard is intentionally before location lookup:
    // an 11-day-away concert must cause neither forecast nor geocoding I/O.
    const initialGate = availability(concert, concert.timezone || 'UTC', now);
    if (!initialGate.available) return { kind: 'before_window', availability: initialGate };
    const location = await resolveLocation(concert, fetchImpl);
    const timezone = location.timezone || concert.timezone || 'UTC'; const gate = availability(concert, timezone, now);
    if (!gate.available) return { kind: 'before_window', availability: gate };
    if (location.kind !== 'ok') return { kind: 'location_unavailable' };
    const key = storageKey(concert, location); const cached = await getStored(key);
    if (!force && cached?.expiresAt && Date.parse(cached.expiresAt) > now.getTime()) return { kind: 'ok', forecast: cached, cached: true };
    const flight = inFlight.get(key); if (flight) return flight;
    const task = (async () => {
      const url = new URL(FORECAST_URL); url.searchParams.set('latitude', location.latitude); url.searchParams.set('longitude', location.longitude); url.searchParams.set('hourly', 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m'); url.searchParams.set('timezone', 'auto'); url.searchParams.set('forecast_days', '16'); url.searchParams.set('temperature_unit', 'celsius'); url.searchParams.set('wind_speed_unit', 'kmh');
      try { const response = await fetchImpl(url.toString()); if (!response.ok) throw new Error('forecast'); const forecast = normalizeForecast(await response.json(), concert, location, now); if (!forecast) throw new Error('malformed'); await setStored(key, forecast); return { kind: 'ok', forecast, cached: false }; }
      catch { return cached ? { kind: 'stale', forecast: cached } : { kind: 'unavailable' }; }
      finally { inFlight.delete(key); }
    })(); inFlight.set(key, task); return task;
  }
  window.ConcertWeather = { availability, condition, desiredHours, normalizeForecast, resolveLocation, load, storageKey, CACHE_HOURS };
})();
