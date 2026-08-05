'use strict';

(function attachListeningCanonicalActivation(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningCanonicalActivation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const STATE_KEY = 'bandmarkr-listening-canonical-activation-v1';
  const STATE_VERSION = 1;
  const PAGE_SIZE = 500;
  const SOURCE_OWNED_FIELDS = new Set([
    'stableListenId', 'sourceEventId', 'canonicalListenId', 'duplicateOf',
    'source', 'listenedAt', 'listenedAtMs', 'timestamp', 'listenedAtSeconds',
  ]);

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim() || null;
  const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const missingValue = (value) => value == null || value === '' || (Array.isArray(value) && value.length === 0) || (isPlainObject(value) && Object.keys(value).length === 0);

  function defaultState() {
    return {
      stateVersion: STATE_VERSION,
      status: 'inactive',
      sourceEventCount: 0,
      canonicalRecordCount: 0,
      duplicateCount: 0,
      reviewGroupCount: 0,
      preparedAt: null,
      activatedAt: null,
      error: null,
    };
  }

  function stateStore(storage = root?.localStorage) {
    return {
      load() {
        try {
          const value = JSON.parse(storage?.getItem?.(STATE_KEY) || 'null');
          return value?.stateVersion === STATE_VERSION ? { ...defaultState(), ...value } : defaultState();
        } catch (_) { return defaultState(); }
      },
      save(value) {
        const next = { ...defaultState(), ...clone(value), stateVersion: STATE_VERSION };
        storage?.setItem?.(STATE_KEY, JSON.stringify(next));
        return next;
      },
      clear() { storage?.removeItem?.(STATE_KEY); },
    };
  }

  async function listAll(pageReader) {
    const output = [];
    let afterSourceEventId = null;
    do {
      const page = await pageReader({ limit: PAGE_SIZE, afterSourceEventId });
      output.push(...(page.items || []));
      afterSourceEventId = clean(page.nextAfterSourceEventId);
    } while (afterSourceEventId);
    return output;
  }

  function fillMissing(target, source) {
    if (!isPlainObject(source)) return target;
    const output = isPlainObject(target) ? clone(target) : {};
    for (const [key, value] of Object.entries(source)) {
      if (SOURCE_OWNED_FIELDS.has(key) || value == null) continue;
      if (isPlainObject(value)) {
        output[key] = fillMissing(output[key], value);
      } else if (missingValue(output[key])) {
        output[key] = clone(value);
      }
    }
    return output;
  }

  function enrichRepresentative(representative, members = [], identities = new Map()) {
    const representativeId = clean(representative?.stableListenId || representative?.sourceEventId);
    let enriched = clone(representative);
    for (const member of members) {
      if (member === representative) continue;
      enriched = fillMissing(enriched, member);
    }
    const memberIds = members.map((event) => clean(event?.stableListenId || event?.sourceEventId)).filter(Boolean);
    const memberSources = [...new Set(members.map((event) => clean(event?.source)).filter(Boolean))];
    const resolvedBandId = clean(identities.get(representativeId)?.bandId || identities.get(representativeId)?.localBandId || enriched.localBandId)
      || memberIds.map((id) => clean(identities.get(id)?.bandId || identities.get(id)?.localBandId)).find(Boolean)
      || null;
    return {
      ...enriched,
      localBandId: resolvedBandId,
      canonicalListenId: representativeId,
      canonicalSourceEventIds: memberIds,
      canonicalSources: memberSources,
    };
  }

  function canonicalizeEvents(events = [], canonicalRecords = [], identityRecords = []) {
    const canonicalById = new Map(canonicalRecords.map((record) => [clean(record.sourceEventId), record]));
    const identityById = new Map(identityRecords.map((record) => [clean(record.sourceEventId), record]));
    const eventById = new Map();
    const membersByRepresentative = new Map();
    let duplicateCount = 0;

    for (const event of events) {
      const sourceEventId = clean(event?.stableListenId || event?.sourceEventId);
      if (!sourceEventId || eventById.has(sourceEventId)) throw new Error('Canonical listening data is incomplete.');
      eventById.set(sourceEventId, event);
    }

    for (const [sourceEventId] of eventById) {
      const canonical = canonicalById.get(sourceEventId);
      const canonicalListenId = clean(canonical?.canonicalListenId);
      const duplicateOf = clean(canonical?.duplicateOf);
      if (!canonical || !canonicalListenId) throw new Error('Canonical listening data is incomplete.');
      if (duplicateOf) {
        const representative = canonicalById.get(duplicateOf);
        if (canonicalListenId !== duplicateOf || !eventById.has(duplicateOf) || !representative || clean(representative.canonicalListenId) !== duplicateOf || clean(representative.duplicateOf)) {
          throw new Error('Canonical listening relationships are inconsistent.');
        }
        duplicateCount += 1;
      } else if (canonicalListenId !== sourceEventId) {
        throw new Error('Canonical listening relationships are inconsistent.');
      }
      const representativeId = duplicateOf || sourceEventId;
      const members = membersByRepresentative.get(representativeId) || [];
      members.push(eventById.get(sourceEventId));
      membersByRepresentative.set(representativeId, members);
    }

    const output = [];
    for (const event of events) {
      const sourceEventId = clean(event?.stableListenId || event?.sourceEventId);
      const canonical = canonicalById.get(sourceEventId);
      if (clean(canonical?.duplicateOf)) continue;
      output.push(enrichRepresentative(event, membersByRepresentative.get(sourceEventId) || [event], identityById));
    }
    return { events: output, duplicateCount };
  }

  async function sourceEvents(options = {}) {
    if (Array.isArray(options.events)) return clone(options.events);
    const history = options.history || root?.LiveVaultSpotifyHistory;
    if (!history?.loadEvents) throw new Error('Private listening history is unavailable.');
    return history.loadEvents(options.bands || []);
  }

  async function prepare(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const rollout = options.rollout || root?.BandmarkrListeningReviewRollout;
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const store = options.stateStore || stateStore(options.localStorage);
    const bands = options.bands || [];
    if (!migration?.runToCompletion || !rollout?.generateCandidates || !rollout?.persistCandidatePlan || !storage?.storageSummary) throw new Error('Listening activation tools are unavailable.');
    store.save({ ...store.load(), status: 'preparing', error: null });
    try {
      const events = await sourceEvents({ ...options, bands });
      if (!events.length) throw new Error('No private listening history is stored on this device.');
      const checkpoints = options.checkpoints || migration.checkpointStore?.(options.localStorage);
      const previousCheckpoint = checkpoints?.load?.();
      if (previousCheckpoint?.status === 'complete' || (previousCheckpoint?.sourceEventCountAfter != null && previousCheckpoint.sourceEventCountAfter !== events.length)) checkpoints.clear();
      const migrationResult = await migration.runToCompletion({ bands, chunkSize: PAGE_SIZE, checkpoints });
      const contracts = options.contracts || root?.BandmarkrListeningIdentityContracts;
      const plan = rollout.generateCandidates(events, { contracts });
      plan.assignment = rollout.assignOneToOne(plan.candidates);
      const persisted = await rollout.persistCandidatePlan(plan, {
        storage,
        reviewStorage: options.reviewStorage || rollout.reviewStorage,
        contracts,
        batchSize: PAGE_SIZE,
      });
      const summary = await storage.storageSummary();
      if (summary.canonicalCount !== events.length || migrationResult.checkpoint?.integrityStatus !== 'passed') throw new Error('Listening activation integrity check failed.');
      const canonicalRecords = await listAll((page) => storage.listCanonical(page));
      const identityRecords = await listAll((page) => storage.listIdentities(page));
      const verified = canonicalizeEvents(events, canonicalRecords, identityRecords);
      const prepared = store.save({
        status: 'ready',
        sourceEventCount: events.length,
        canonicalRecordCount: summary.canonicalCount,
        duplicateCount: verified.duplicateCount,
        reviewGroupCount: rollout.reviewComponents(persisted.assignment.review).length,
        preparedAt: new Date().toISOString(),
        activatedAt: null,
        error: null,
      });
      return { state: prepared, audit: rollout.safeAudit({ ...plan, assignment: persisted.assignment }, { sourceCount: events.length, contracts }) };
    } catch (error) {
      store.save({ ...store.load(), status: 'error', error: error?.message || 'Listening activation failed.' });
      throw error;
    }
  }

  async function activate(options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const store = options.stateStore || stateStore(options.localStorage);
    const current = store.load();
    const events = await sourceEvents(options);
    if (current.status !== 'ready' && current.status !== 'active') throw new Error('Prepare cleaned listening totals first.');
    if (events.length !== current.sourceEventCount) throw new Error('Listening history changed. Prepare cleaned totals again.');
    const canonicalRecords = await listAll((page) => storage.listCanonical(page));
    const identityRecords = await listAll((page) => storage.listIdentities(page));
    if (canonicalRecords.length !== events.length) throw new Error('Canonical listening data is incomplete.');
    const result = canonicalizeEvents(events, canonicalRecords, identityRecords);
    const active = store.save({ ...current, status: 'active', duplicateCount: result.duplicateCount, activatedAt: current.activatedAt || new Date().toISOString(), error: null });
    return { ...result, state: active };
  }

  async function deactivate(options = {}) {
    const store = options.stateStore || stateStore(options.localStorage);
    const current = store.load();
    const events = await sourceEvents(options);
    const status = current.sourceEventCount === events.length && current.canonicalRecordCount === events.length ? 'ready' : 'stale';
    const next = store.save({ ...current, status, activatedAt: null, error: status === 'stale' ? 'Listening history changed. Prepare cleaned totals again.' : null });
    return { events, state: next };
  }

  function refreshVisibleListeningScreens() {
    if (typeof renderStatsScreen === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'stats') renderStatsScreen();
    if (typeof renderTopBandsScreen === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'top-bands') renderTopBandsScreen();
    if (typeof renderProfileScreen === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'profile') renderProfileScreen(activeProfileBandId);
    if (typeof renderMyConcertsScreen === 'function' && typeof currentTab !== 'undefined' && currentTab === 'myconcerts') renderMyConcertsScreen();
  }

  async function applyToApp(options = {}) {
    if (typeof listeningEvents === 'undefined') return { applied: false, reason: 'app_unavailable' };
    const store = options.stateStore || stateStore(options.localStorage);
    if (store.load().status !== 'active') return { applied: false, reason: 'inactive' };
    try {
      const result = await activate({ ...options, stateStore: store });
      listeningEvents = result.events;
      refreshVisibleListeningScreens();
      return { applied: true, count: result.events.length, duplicateCount: result.duplicateCount };
    } catch (error) {
      store.save({ ...store.load(), status: 'stale', error: error?.message || 'Cleaned totals need to be prepared again.' });
      return { applied: false, reason: error?.message || 'activation_failed' };
    }
  }

  function installApplyWrapper() {
    const history = root?.LiveVaultSpotifyHistory;
    if (!history?.applyToApp || history.__canonicalActivationWrapped) return;
    const original = history.applyToApp.bind(history);
    history.applyToApp = async (...args) => {
      const count = await original(...args);
      await applyToApp({ events: typeof listeningEvents === 'undefined' ? undefined : listeningEvents });
      return count;
    };
    history.__canonicalActivationWrapped = true;
  }

  function installReviewWrapper() {
    const review = root?.BandmarkrListeningReviewRollout;
    if (!review?.applyReview || review.__canonicalActivationWrapped) return;
    const original = review.applyReview.bind(review);
    review.applyReview = async (...args) => {
      const result = await original(...args);
      if (args[1] === 'merge' && stateStore().load().status === 'active') {
        await applyToApp();
        const card = root?.document?.querySelector?.('[data-canonical-activation]');
        if (card) renderSettingsCard(card);
      }
      return result;
    };
    review.__canonicalActivationWrapped = true;
  }

  function renderSettingsCard(container) {
    const state = stateStore().load();
    const status = container.querySelector('[data-canonical-activation-status]');
    const prepareButton = container.querySelector('[data-canonical-prepare]');
    const activateButton = container.querySelector('[data-canonical-activate]');
    const deactivateButton = container.querySelector('[data-canonical-deactivate]');
    const count = Number(state.duplicateCount) || 0;
    if (state.status === 'active') status.textContent = `Cleaned totals are active. ${count.toLocaleString()} confirmed duplicate listen${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} excluded.`;
    else if (state.status === 'ready') status.textContent = `Preparation complete. ${count.toLocaleString()} confirmed duplicate listen${count === 1 ? '' : 's'} found. Your visible totals have not changed yet.`;
    else if (state.status === 'preparing') status.textContent = 'Preparing cleaned totals on this device…';
    else if (state.status === 'stale') status.textContent = 'Your listening history changed. Prepare cleaned totals again before using them.';
    else if (state.status === 'error') status.textContent = `Preparation stopped safely: ${state.error || 'Unknown error'}`;
    else status.textContent = 'Your current listening statistics still use the original source records.';
    prepareButton.hidden = state.status === 'active';
    prepareButton.textContent = ['ready', 'stale', 'error'].includes(state.status) ? 'Prepare again' : 'Prepare cleaned totals';
    activateButton.hidden = state.status !== 'ready';
    deactivateButton.hidden = state.status !== 'active';
  }

  function ensureSettingsUi() {
    const screen = root?.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-canonical-activation]')) return;
    const reviewCard = screen.querySelector('#listening-review-maintenance');
    if (!reviewCard) return;
    const wrapper = root.document.createElement('div');
    wrapper.dataset.canonicalActivation = 'true';
    wrapper.className = 'settings-card';
    wrapper.innerHTML = `<p class="section-label" style="margin-top:0">Cleaned listening totals</p><p class="settings-hint" data-canonical-activation-status aria-live="polite"></p><div class="show-buttons" style="margin-top:8px"><button type="button" class="btn-primary" data-canonical-prepare>Prepare cleaned totals</button><button type="button" class="btn-secondary" data-canonical-activate hidden>Use cleaned totals</button><button type="button" class="btn-secondary" data-canonical-deactivate hidden>Use original totals</button></div>`;
    reviewCard.after(wrapper);
    const prepareButton = wrapper.querySelector('[data-canonical-prepare]');
    const activateButton = wrapper.querySelector('[data-canonical-activate]');
    const deactivateButton = wrapper.querySelector('[data-canonical-deactivate]');
    prepareButton.addEventListener('click', async () => {
      prepareButton.disabled = true;
      wrapper.querySelector('[data-canonical-activation-status]').textContent = 'Preparing cleaned totals on this device…';
      try { await prepare({ bands: typeof bands === 'undefined' ? [] : bands }); } catch (_) {}
      prepareButton.disabled = false;
      renderSettingsCard(wrapper);
    });
    activateButton.addEventListener('click', async () => {
      activateButton.disabled = true;
      try {
        const result = await activate({ bands: typeof bands === 'undefined' ? [] : bands });
        if (typeof listeningEvents !== 'undefined') listeningEvents = result.events;
        refreshVisibleListeningScreens();
      } catch (error) {
        wrapper.querySelector('[data-canonical-activation-status]').textContent = error?.message || 'Cleaned totals could not be activated.';
      }
      activateButton.disabled = false;
      renderSettingsCard(wrapper);
    });
    deactivateButton.addEventListener('click', async () => {
      deactivateButton.disabled = true;
      try {
        const result = await deactivate({ bands: typeof bands === 'undefined' ? [] : bands });
        if (typeof listeningEvents !== 'undefined') listeningEvents = result.events;
        refreshVisibleListeningScreens();
      } catch (error) {
        wrapper.querySelector('[data-canonical-activation-status]').textContent = error?.message || 'Original totals could not be restored.';
      }
      deactivateButton.disabled = false;
      renderSettingsCard(wrapper);
    });
    renderSettingsCard(wrapper);
  }

  function observeSettings() {
    if (!root?.document || !root.MutationObserver) return;
    const observer = new root.MutationObserver(ensureSettingsUi);
    observer.observe(root.document.documentElement, { subtree: true, childList: true });
    ensureSettingsUi();
  }

  if (root?.document) {
    installApplyWrapper();
    installReviewWrapper();
    root.addEventListener('DOMContentLoaded', () => {
      installApplyWrapper();
      installReviewWrapper();
      observeSettings();
    }, { once: true });
  }

  return {
    STATE_KEY, STATE_VERSION, PAGE_SIZE, defaultState, stateStore, listAll,
    fillMissing, enrichRepresentative, canonicalizeEvents, sourceEvents,
    prepare, activate, deactivate, applyToApp, installApplyWrapper, installReviewWrapper,
  };
});
