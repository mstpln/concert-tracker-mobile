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
    if (cities.size > 1) reasons.push('city');
    return { valid: reasons.length === 0, reasons };
  }

  function groupConcertPerformances(concerts) {
    const groups = new Map();
    (concerts || []).forEach((concert, index) => {
      const explicit = validGroupId(concert?.eventGroupId);
      const key = explicit ? `group:${concert.eventGroupId}` : `concert:${concert?.id ?? index}`;
      if (!groups.has(key)) groups.set(key, { key, eventGroupId: explicit ? concert.eventGroupId : null, records: [], firstIndex: index });
      groups.get(key).records.push(concert);
    });
    return [...groups.values()].map((event) => ({ ...event, validation: validateEventGroup(event.records) }));
  }

  // Keep every unrelated card in its existing stable chronological slot.
  // Only records occupying slots for the same explicit group exchange places.
  function orderPerformances(concerts) {
    const output = [...(concerts || [])];
    for (const event of groupConcertPerformances(output)) {
      if (!event.eventGroupId || event.records.length < 2 || !event.validation.valid) continue;
      const indexes = [];
      output.forEach((record, index) => { if (record?.eventGroupId === event.eventGroupId) indexes.push(index); });
      const ordered = stablePerformanceOrder(indexes.map((index) => output[index]));
      indexes.forEach((index, offset) => { output[index] = ordered[offset]; });
    }
    return output;
  }

  function sameCandidateContext(first, second) {
    if (!first || !second || first.id === second.id) return false;
    return !!first.date && first.date === second.date
      && !!normalize(first.venue) && normalize(first.venue) === normalize(second.venue)
      && normalize(first.city) === normalize(second.city);
  }

  function candidateConcerts(source, concerts) {
    return (concerts || []).filter((candidate) => candidate?.attending && sameCandidateContext(source, candidate));
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
    if (!sameCandidateContext(source, target)) throw new Error('Only concerts with the same date, venue and city can be linked.');
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
    if (!first || !validGroupId(first.eventGroupId)) return first || null;
    const members = (upcoming || []).filter((record) => record.eventGroupId === first.eventGroupId);
    return members.length > 1 && validateEventGroup(members).valid ? presentationForEvent(members) : first;
  }

  return Object.freeze({
    validGroupId, createGroupId, validateEventGroup, groupConcertPerformances,
    stablePerformanceOrder, orderPerformances, sameCandidateContext, candidateConcerts,
    linkConcerts, unlinkConcert, resolveEventTicketQuantity, resolveEventTicketCost,
    resolveEventDistance, representativeRecord, presentationForEvent, nextEventPresentation,
  });
});
