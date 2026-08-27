'use strict';

(function installNextConcertEventGroupV169(root) {
  function cardConcertId(card) {
    if (!card) return '';
    return String(
      card.querySelector('.concert-prep-group[data-concert-id]')?.dataset.concertId
      || card.querySelector('.delete-corner-btn[data-concert-id]')?.dataset.concertId
      || ''
    );
  }

  function upcomingAttendingRecords() {
    if (typeof concerts === 'undefined' || !Array.isArray(concerts) || typeof dlIsUpcoming !== 'function') return [];
    return concerts.filter((concert) => concert?.attending && dlIsUpcoming(concert));
  }

  function nextEventRecordIds(firstCard) {
    const firstId = cardConcertId(firstCard);
    if (!firstId) return [];
    if (typeof EventModelV156 === 'undefined' || typeof EventModelV156.groupConcertPerformances !== 'function') return [firstId];
    const event = EventModelV156.groupConcertPerformances(upcomingAttendingRecords())
      .find((candidate) => candidate.records.some((record) => String(record?.id) === firstId));
    if (!event || event.records.length < 2 || !event.validation?.valid) return [firstId];
    return EventModelV156.stablePerformanceOrder(event.records).map((record) => String(record.id));
  }

  function countEvents(records) {
    const list = records || [];
    if (!list.length || typeof EventModelV156 === 'undefined' || typeof EventModelV156.groupConcertPerformances !== 'function') return list.length;
    return EventModelV156.groupConcertPerformances(list).reduce((count, event) => {
      if (event.records.length > 1 && event.validation?.valid) return count + 1;
      return count + event.records.length;
    }, 0);
  }

  function remainingYearDivider(sourceDivider, upcomingLabel, removedIds) {
    const next = upcomingLabel?.nextElementSibling;
    if (!sourceDivider || !next?.classList?.contains('row-card-mc')) return null;
    const year = String(sourceDivider.querySelector('span')?.textContent || '').trim();
    if (!year) return null;
    const remainingRecords = upcomingAttendingRecords().filter((record) => {
      return !removedIds.has(String(record?.id)) && String(record?.date || '').slice(0, 4) === year;
    });
    const count = countEvents(remainingRecords);
    if (!count) return null;
    const clone = sourceDivider.cloneNode(true);
    clone.classList.remove('year-divider-v169-spacer');
    clone.classList.add('year-divider-v167-upcoming', 'year-divider-v169-upcoming');
    const countNode = clone.querySelector('.year-divider-count');
    if (countNode) countNode.textContent = `${count} more ${count === 1 ? 'show' : 'shows'}`;
    return clone;
  }

  function hasRemainingUpcoming(removedIds) {
    return upcomingAttendingRecords().some((record) => !removedIds.has(String(record?.id)));
  }

  function applyEventGroupPresentation() {
    const container = root.document?.getElementById('screen-myconcerts');
    if (!container) return false;
    const firstCard = container.querySelector(':scope > .next-concert-merged-v167');
    const upcomingLabel = [...container.children].find((node) => node.classList?.contains('section-label-v143-upcoming'));
    if (!firstCard || !upcomingLabel) return false;

    const sourceDivider = firstCard.previousElementSibling?.classList?.contains('year-divider')
      ? firstCard.previousElementSibling : null;
    const orderedIds = nextEventRecordIds(firstCard);
    if (!orderedIds.length) return false;
    const removedIds = new Set(orderedIds);
    const cardsById = new Map(
      [...container.children]
        .filter((node) => node.classList?.contains('row-card-mc'))
        .map((card) => [cardConcertId(card), card])
        .filter(([id]) => id)
    );
    const eventCards = orderedIds.map((id) => cardsById.get(id)).filter(Boolean);
    if (!eventCards.length) return false;

    const oldRemainingDivider = upcomingLabel.nextElementSibling?.classList?.contains('year-divider-v167-upcoming')
      ? upcomingLabel.nextElementSibling : null;
    oldRemainingDivider?.remove();

    if (sourceDivider) sourceDivider.classList.add('year-divider-v169-spacer');
    let anchor = sourceDivider || firstCard.previousElementSibling;
    for (const card of eventCards) {
      card.classList.add('next-concert-event-card-v169');
      card.classList.remove('next-concert-event-last-v169');
      anchor.after(card);
      anchor = card;
    }
    eventCards[eventCards.length - 1].classList.add('next-concert-event-last-v169');
    anchor.after(upcomingLabel);

    const divider = remainingYearDivider(sourceDivider, upcomingLabel, removedIds);
    if (divider) upcomingLabel.after(divider);
    if (!hasRemainingUpcoming(removedIds)) upcomingLabel.remove();
    return true;
  }

  root.NextConcertEventGroupV169 = Object.freeze({
    cardConcertId,
    nextEventRecordIds,
    countEvents,
    applyEventGroupPresentation,
  });

  if (typeof root.renderMyConcertsScreen === 'function') {
    const render = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV169(...args) {
      const result = render.apply(this, args);
      applyEventGroupPresentation();
      return result;
    };
  }

  applyEventGroupPresentation();
})(typeof globalThis !== 'undefined' ? globalThis : this);
