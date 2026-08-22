'use strict';

(function exposeLineupRole(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LineupRoleV155 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const HEADLINER = 'headliner';
  const SUPPORT = 'support';
  const VALID_ROLES = new Set([HEADLINER, SUPPORT]);

  function isValid(role) {
    return VALID_ROLES.has(role);
  }

  function displayRole(concert) {
    return isValid(concert?.lineupRole) ? concert.lineupRole : HEADLINER;
  }

  // AUB2 uses a lazy, idempotent initialization: records are normalized in
  // memory when read and persisted on their next ordinary safe write. This
  // avoids a production-wide backfill while ensuring no invalid third state
  // can be written by the app or research pipeline.
  function initializeConcert(concert) {
    if (!concert || typeof concert !== 'object' || Array.isArray(concert)) return concert;
    if (isValid(concert.lineupRole)) return concert;
    return { ...concert, lineupRole: HEADLINER };
  }

  function initializeConcerts(concerts) {
    return Array.isArray(concerts) ? concerts.map(initializeConcert) : [];
  }

  function withRole(concert, role) {
    if (!isValid(role)) throw new TypeError('Lineup role must be headliner or support.');
    return { ...concert, lineupRole: role };
  }

  function withAttending(concert, attending) {
    const next = { ...concert, attending: !!attending };
    return attending ? initializeConcert(next) : next;
  }

  function performanceStats(attendedPast) {
    const concerts = Array.isArray(attendedPast) ? attendedPast : [];
    const total = concerts.length;
    const support = concerts.reduce((count, concert) => count + (displayRole(concert) === SUPPORT ? 1 : 0), 0);
    const headliner = total - support;
    const percentage = (count) => total ? Math.round((count / total) * 100) : 0;
    return {
      total,
      headliner: { count: headliner, percentage: percentage(headliner) },
      support: { count: support, percentage: percentage(support) },
    };
  }

  return { HEADLINER, SUPPORT, isValid, displayRole, initializeConcert, initializeConcerts, withRole, withAttending, performanceStats };
});
