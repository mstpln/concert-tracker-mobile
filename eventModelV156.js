'use strict';

(function exposeEventModel(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EventModelV156 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const GROUP_RE = /^event-[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function normalize(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'); }
  function validGroupId(value) { return typeof value === 'string' && GROUP_RE.test(value); }
  function roleRank(concert) { return concert?.lineupRole === 'support' ? 0 : 1; }
  function stablePerformanceOrder(records) {
    return (records || []).map((record, index) => ({ record, index }))
      .sort((a, b) => roleRank(a.record) - roleRank(b.record) || a.index - b.index)
      .map((item) => item.record);
  }

  function createGroupId(randomUUID = root?.crypto?.randomUUID?.bind(root.crypto)) {
    let token;
    if (typeof randomUUID === 'function') token = String(randomUUID()).replace(/[^A-Za-z0-9_-]/g, '');
    else if (typeof root?.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      token = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    } else token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 14)}`;
    return `event-${token}`;
  }

  // Automatic v157 inference deliberately fails closed. In particular, a
  // missing city is not evidence: two normalized empty strings must never
  // make two performances look like the same real-world event.
  function validateEventGroup(records) {
    const list = records || [];
    if (!list.length) return { valid: false, reasons: ['empty'] };
    if (list.length === 1) return { valid: true, reasons: [] };
    const dates = new Set(list.map((record) => String(record?.date || '').trim()).filter(Boolean));
    const venues = new Set(list.map((record) => normalize(record?.venue)).filter(Boolean));
    const cities = new Set(list.map((record) => normalize(record?.city)).filter(Boolean));
    const reasons = [];
    if (dates.size !== 1 || list.some((record) => !String(record?.date || '').trim())) reasons.push('date');
    if (venues.size !== 1 || list.some((record) => !normalize(record?.venue))) reasons.push('venue');
    if (cities.size !== 1 || list.some((record) => !normalize(record?.city))) reasons.push('city');
    return { valid: reasons.length === 0, reasons };
  }

  // Existing v156 eventGroupId relationships are user-established identity.
  // Preserve their historical compatibility: blank/missing city is tolerated,
  // but two different known cities still fail closed as an actual conflict.
  function validateExplicitEventGroup(records) {
    const list = records || [];
    if (!list.length) return { valid: false, reasons: ['empty'] };
    if (list.length === 1) return { valid: true, reasons: [] };
    const dates = new Set(list.map((record) => String(record?.date || '').trim()).filter(Boolean));
    const venues = new Set(list.map((record) => normalize(record?.venue)).filter(Boolean));
    const cities = new Set(list.map((record) => normalize(record?.city)).filter(Boolean));
    const reasons = [];
    if (dates.size !== 1 || list.some((record) => !String(record?.date || '').trim())) reasons.push('date');
    if (venues.size !== 1 || list.some((record) => !normalize(record?.venue))) reasons.push('venue');
    if (cities.size > 1) reasons.push('city');
    return { valid: reasons.length === 0, reasons };
  }

  function strongAutomaticContext(record) {
    if (!record?.attending) return null;
    const date = String(record.date || '').trim();
    const venue = normalize(record.venue);
    const city = normalize(record.city);
    if (!date || !venue || !city) return null;
    return { date, venue, city, key: `${date}\u001f${venue}\u001f${city}` };
  }

  function automaticGroupId(contextKey) {
    // Deterministic internal ID only. It is returned by the event model so
    // existing event-level accounting can treat the derived relationship as
    // one event, but it is never written back to concert records.
    let hash = 2166136261;
    for (let i = 0; i < contextKey.length; i += 1) {
      hash ^= contextKey.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `event-auto-${hash.toString(36).padStart(8, '0')}`;
  }

  // v157 keeps v156's persisted eventGroupId relationships intact, while
  // deriving conservative automatic relationships for otherwise ungrouped
  // attended performances with exact date + normalized venue + non-empty
  // matching city. Explicit groups remain authoritative and are never
  // silently expanded or rewritten by this read-time interpretation.
  function groupConcertPerformances(concerts) {
    const groups = new Map();
    (concerts || []).forEach((concert, index) => {
      const explicit = validGroupId(concert?.eventGroupId);
      const context = explicit ? null : strongAutomaticContext(concert);
      const key = explicit
        ? `group:${concert.eventGroupId}`
        : context ? `auto:${context.key}` : `concert:${concert?.id ?? index}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          eventGroupId: explicit ? concert.eventGroupId : (context ? automaticGroupId(context.key) : null),
          relationship: explicit ? 'explicit' : (context ? 'automatic' : 'single'),
          records: [], indexes: [], firstIndex: index,
        });
      }
      const group = groups.get(key);
      group.records.push(concert);
      group.indexes.push(index);
    });
    return [...groups.values()].map((event) => ({
      ...event,
      validation: event.relationship === 'explicit'
        ? validateExplicitEventGroup(event.records)
        : validateEventGroup(event.records),
    }));
  }

  // Keep every unrelated card in its existing chronological slot. Only the
  // slots occupied by performances in one valid effective event exchange
  // places, and same-role order remains stable.
  function orderPerformances(concerts) {
    const input = [...(concerts || [])];
    const output = [...input];
    for (const event of groupConcertPerformances(input)) {
      if (event.records.length < 2 || !event.validation.valid) continue;
      const ordered = stablePerformanceOrder(event.records);
      event.indexes.forEach((index, offset) => { output[index] = ordered[offset]; });
    }
    return output;
  }

  function sameCandidateContext(first, second) {
    if (!first || !second || first.id === second.id || !first.attending || !second.attending) return false;
    const firstCity = normalize(first.city);
    const secondCity = normalize(second.city);
    return !!first.date && first.date === second.date
      && !!normalize(first.venue) && normalize(first.venue) === normalize(second.venue)
      && !!firstCity && !!secondCity && firstCity === secondCity;
  }

  function candidateConcerts(source, concerts) {
    return (concerts || []).filter((candidate) => sameCandidateContext(source, candidate));
  }

  function cleanupSingletonGroup(concerts, groupId) {
    if (!validGroupId(groupId)) return concerts;
    const members = concerts.filter((record) => record?.eventGroupId === groupId);
    if (members.length !== 1) return concerts;
    return concerts.map((record) => {
      if (record?.id !== members[0].id) return record;
      const next = { ...record }; delete next.eventGroupId; return next;
    });
  }

  function unlinkConcert(concerts, concertId) {
    const source = (concerts || []).find((record) => String(record?.id) === String(concertId));
    if (!source || !validGroupId(source.eventGroupId)) return clone(concerts || []);
    const oldGroup = source.eventGroupId;
    let next = (concerts || []).map((record) => {
      if (String(record?.id) !== String(concertId)) return clone(record);
      const updated = clone(record); delete updated.eventGroupId; return updated;
    });
    next = cleanupSingletonGroup(next, oldGroup);
    return next;
  }

  function linkConcerts(concerts, sourceId, targetId, idFactory = createGroupId) {
    const list = clone(concerts || []);
    const source = list.find((record) => String(record?.id) === String(sourceId));
    const target = list.find((record) => String(record?.id) === String(targetId));
    if (!source || !target || source === target) throw new Error('Choose two existing concerts.');
    if (!sameCandidateContext(source, target)) throw new Error('Only attended concerts with the same date, venue and non-empty city can be linked.');
    const oldGroup = validGroupId(source.eventGroupId) ? source.eventGroupId : null;
    const sameExistingGroup = validGroupId(source.eventGroupId) && source.eventGroupId === target.eventGroupId;
    let groupId = sameExistingGroup ? source.eventGroupId
      : validGroupId(target.eventGroupId) ? target.eventGroupId : null;
    if (!groupId) {
      const occupied = new Set(list.map((record) => record?.eventGroupId).filter(validGroupId));
      for (let attempt = 0; attempt < 4 && !groupId; attempt += 1) {
        const candidate = idFactory();
        if (validGroupId(candidate) && !occupied.has(candidate)) groupId = candidate;
      }
    }
    if (!validGroupId(groupId)) throw new Error('Could not create a safe event relationship.');
    let next = list.map((record) => {
      if (![String(sourceId), String(targetId)].includes(String(record?.id))) return record;
      return { ...record, eventGroupId: groupId };
    });
    if (oldGroup && oldGroup !== groupId) next = cleanupSingletonGroup(next, oldGroup);
    return next;
  }

  function scalarResolution(records, read, accept) {
    const values = (records || []).map(read).filter(accept);
    const unique = [...new Set(values)];
    if (!values.length) return { value: null, conflict: false, knownCount: 0, values: [] };
    return { value: Math.min(...unique), conflict: unique.length > 1, knownCount: values.length, values: unique };
  }

  function numericField(record, key) {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function resolveEventTicketQuantity(records) {
    return scalarResolution(records, (record) => numericField(record, 'ticketQuantity'), (value) => Number.isInteger(value) && value > 0);
  }

  function resolveEventTicketCost(records) {
    const quantity = resolveEventTicketQuantity(records);
    const prices = scalarResolution(records, (record) => numericField(record, 'ticketPrice'), (value) => Number.isFinite(value) && value >= 0);
    const totals = (records || []).map((record) => {
      const price = numericField(record, 'ticketPrice');
      if (!Number.isFinite(price) || price < 0) return null;
      const ownQuantity = numericField(record, 'ticketQuantity');
      const qty = Number.isInteger(ownQuantity) && ownQuantity > 0 ? ownQuantity : (quantity.value || 1);
      return price * qty;
    }).filter((value) => value !== null);
    const uniqueTotals = [...new Set(totals)];
    return {
      value: uniqueTotals.length ? Math.min(...uniqueTotals) : null,
      unitPrice: prices.value,
      conflict: prices.conflict || quantity.conflict || uniqueTotals.length > 1,
      knownCount: totals.length,
      values: uniqueTotals,
    };
  }

  function resolveEventDistance(records) {
    return scalarResolution(records, (record) => numericField(record, 'distanceKm'), (value) => Number.isFinite(value) && value >= 0);
  }

  function representativeRecord(records) {
    const ordered = stablePerformanceOrder(records || []);
    return [...ordered].reverse().find((record) => record?.lineupRole === 'headliner') || ordered[ordered.length - 1] || null;
  }

  function presentationForEvent(records) {
    const ordered = stablePerformanceOrder(records || []);
    const representative = representativeRecord(ordered);
    if (!representative) return null;
    const quantity = resolveEventTicketQuantity(ordered);
    const ticketOwner = [representative, ...ordered].find((record, index, all) => index === all.findIndex((candidate) => candidate?.id === record?.id) && Array.isArray(record?.ownedTickets) && record.ownedTickets.length) || representative;
    return {
      ...representative,
      id: ticketOwner.id,
      ownedTickets: ticketOwner.ownedTickets,
      ticketQuantity: quantity.value,
      eventTicketQuantityConflict: quantity.conflict,
      eventPerformances: ordered.map((record) => ({ id: record.id, bandName: record.bandName, lineupRole: record.lineupRole })),
    };
  }

  function nextEventPresentation(upcoming) {
    const first = upcoming?.[0];
    if (!first) return null;
    const firstId = String(first.id);
    const event = groupConcertPerformances(upcoming || []).find((candidate) => candidate.records.some((record) => String(record?.id) === firstId));
    return event?.records.length > 1 && event.validation.valid ? presentationForEvent(event.records) : first;
  }

  return Object.freeze({
    validGroupId, createGroupId, validateEventGroup, validateExplicitEventGroup,
    strongAutomaticContext, groupConcertPerformances, stablePerformanceOrder,
    orderPerformances, sameCandidateContext, candidateConcerts, linkConcerts,
    unlinkConcert, resolveEventTicketQuantity, resolveEventTicketCost,
    resolveEventDistance, representativeRecord, presentationForEvent,
    nextEventPresentation,
  });
});
