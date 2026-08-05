'use strict';

(function attachListeningCanonicalActivation(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningCanonicalActivation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const STATE_KEY = 'bandmarkr-listening-canonical-activation-v1';
  const STATE_VERSION = 1;
  const PAGE_SIZE = 500;

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim() || null;

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

  async function listAll(pageReader, cursorField = 'nextAfterSourceEventId') {
    const output = [];
    let afterSourceEventId = null;
    do {
      const page = await pageReader({ limit: PAGE_SIZE, afterSourceEventId });
      output.push(...(page.items || []));
      afterSourceEventId = clean(page[cursorField]);
    } while (afterSourceEventId);
    return output;
  }

  function canonicalizeEvents(events = [], canonicalRecords = [], identityRecords = []) {
    const canonicalById = new Map(canonicalRecords.map((record) => [clean(record.sourceEventId), record]));
    const identityById = new Map(identityRecords.map((record) => [clean(record.sourceEventId), record]));
    const output = [];
    let duplicateCount = 0;
    for (const event of events) {
      const sourceEventId = clean(event?.stableListenId || event?.sourceEventId);
      const canonical = canonicalById.get(sourceEventId);
      if (!sourceEventId || !canonical) throw new Error('Canonical listening data is incomplete.');
      if (canonical.duplicateOf || canonical.canonicalListenId !== sourceEventId) {
        duplicateCount += 1;
        continue;
      }
      const identity = identityById.get(sourceEventId);
      output.push({
        ...clone(event),
        localBandId: clean(identity?.bandId || identity?.localBandId || event?.localBandId),
        canonicalListenId: sourceEventId,
      });
    }
    return { events: output, duplicateCount };
  }

  async function prepare(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const rollout = options.rollout || root?.BandmarkrListeningReviewRollout;
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const store = options.stateStore || stateStore(options.localStorage);
    const events = options.events || [];
    const bands = options.bands || [];
    if (!migration?.runToCompletion || !rollout?.generateCandidates || !rollout?.persistCandidatePlan || !storage?.storageSummary) {
      throw new Error('Listening activation tools are unavailable.');
    }
    store.save({ ...store.load(), status: 'preparing', error: null });
    try {
      const migrationResult = await migration.runToCompletion({ bands, chunkSize: PAGE_SIZE });
      const plan = rollout.generateCandidates(events, { contracts: options.contracts || root?.BandmarkrListeningIdentityContracts });
      plan.assignment = rollout.assignOneToOne(plan.candidates);
      const persisted = await rollout.persistCandidatePlan(plan, { storage, reviewStorage: options.reviewStorage || rollout.reviewStorage, contracts: options.contracts || root?.BandmarkrListeningIdentityContracts, batchSize: PAGE_SIZE });
      const summary = await storage.storageSummary();
      if (summary.canonicalCount !== events.length || migrationResult.checkpoint?.integrityStatus !== 'passed') {
        throw new Error('Listening activation integrity check failed.');
      }
      const prepared = store.save({
        status: 'ready',
        sourceEventCount: events.length,
        canonicalRecordCount: summary.canonicalCount,
        duplicateCount: persisted.assignment.automatic.length,
        reviewGroupCount: rollout.reviewComponents(persisted.assignment.review).length,
        preparedAt: new Date().toISOString(),
        activatedAt: null,
        error: null,
      });
      return { state: prepared, audit: rollout.safeAudit({ ...plan, assignment: persisted.assignment }, { sourceCount: events.length, contracts: options.contracts || root?.BandmarkrListeningIdentityContracts }) };
    } catch (error) {
      store.save({ ...store.load(), status: 'error', error: error?.message || 'Listening activation failed.' });
      throw error;
    }
  }

  async function activate(options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const store = options.stateStore || stateStore(options.localStorage);
    const current = store.load();
    const events = options.events || [];
    if (current.status !== 'ready' && current.status !== 'active') throw new Error('Prepare cleaned listening totals first.');
    if (events.length !== current.sourceEventCount) throw new Error('Listening history changed. Prepare cleaned totals again.');
    const canonicalRecords = await listAll((page) => storage.listCanonical(page));
    const identityRecords = await listAll((page) => storage.listIdentities(page));
    if (canonicalRecords.length !== events.length) throw new Error('Canonical listening data is incomplete.');
    const result = canonicalizeEvents(events, canonicalRecords, identityRecords);
    const active = store.save({ ...current, status: 'active', duplicateCount: result.duplicateCount, activatedAt: current.activatedAt || new Date().toISOString(), error: null });
    return { ...result, state: active };
  }

  async function applyToApp(options = {}) {
    try {
      if (typeof listeningEvents === 'undefined') return { applied: false, reason: 'app_unavailable' };
      const store = options.stateStore || stateStore(options.localStorage);
      const current = store.load();
      if (current.status !== 'active') return { applied: false, reason: 'inactive' };
      const result = await activate({ ...options, events: options.events || listeningEvents, stateStore: store });
      listeningEvents = result.events;
      if (typeof renderStatsScreen === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'stats') renderStatsScreen();
      if (typeof renderTopBandsScreen === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'top-bands') renderTopBandsScreen();
      if (typeof renderProfileScreen === 'function' && typeof currentScreen !== 'undefined' && currentScreen === 'profile') renderProfileScreen(activeProfileBandId);
      if (typeof renderMyConcertsScreen === 'function' && typeof currentTab !== 'undefined' && currentTab === 'myconcerts') renderMyConcertsScreen();
      return { applied: true, count: result.events.length, duplicateCount: result.duplicateCount };
    } catch (error) {
      return { applied: false, reason: error?.message || 'activation_failed' };
    }
  }

  function installApplyWrapper() {
    const history = root?.LiveVaultSpotifyHistory;
    if (!history?.applyToApp || history.__canonicalActivationWrapped) return;
    const original = history.applyToApp.bind(history);
    history.applyToApp = async (...args) => {
      const count = await original(...args);
      await applyToApp();
      return count;
    };
    history.__canonicalActivationWrapped = true;
  }

  function renderSettingsCard(container) {
    const store = stateStore();
    const state = store.load();
    const status = container.querySelector('[data-canonical-activation-status]');
    const prepareButton = container.querySelector('[data-canonical-prepare]');
    const activateButton = container.querySelector('[data-canonical-activate]');
    const count = Number(state.duplicateCount) || 0;
    status.textContent = state.status === 'active'
      ? `Cleaned totals are active. ${count.toLocaleString()} confirmed duplicate listen${count === 1 ? '' : 's'} are excluded.`
      : state.status === 'ready'
        ? `Preparation complete. ${count.toLocaleString()} confirmed duplicate listen${count === 1 ? '' : 's'} found. Your visible totals have not changed yet.`
        : state.status === 'preparing'
          ? 'Preparing cleaned totals on this device…'
          : state.status === 'error'
            ? `Preparation stopped safely: ${state.error || 'Unknown error'}`
            : 'Your current listening statistics still use the original source records.';
    prepareButton.textContent = state.status === 'ready' || state.status === 'active' ? 'Prepare again' : 'Prepare cleaned totals';
    activateButton.hidden = state.status !== 'ready';
  }

  function ensureSettingsUi() {
    const screen = root?.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-canonical-activation]')) return;
    const reviewCard = screen.querySelector('#listening-review-maintenance');
    if (!reviewCard) return;
    const wrapper = root.document.createElement('div');
    wrapper.dataset.canonicalActivation = 'true';
    wrapper.className = 'settings-card';
    wrapper.innerHTML = `<p class="section-label" style="margin-top:0">Cleaned listening totals</p><p class="settings-hint" data-canonical-activation-status aria-live="polite"></p><div class="show-buttons" style="margin-top:8px"><button type="button" class="btn-primary" data-canonical-prepare>Prepare cleaned totals</button><button type="button" class="btn-secondary" data-canonical-activate hidden>Use cleaned totals</button></div>`;
    reviewCard.after(wrapper);
    const prepareButton = wrapper.querySelector('[data-canonical-prepare]');
    const activateButton = wrapper.querySelector('[data-canonical-activate]');
    prepareButton.addEventListener('click', async () => {
      prepareButton.disabled = true;
      wrapper.querySelector('[data-canonical-activation-status]').textContent = 'Preparing cleaned totals on this device…';
      try {
        await prepare({ events: typeof listeningEvents === 'undefined' ? [] : listeningEvents, bands: typeof bands === 'undefined' ? [] : bands });
      } catch (_) {}
      prepareButton.disabled = false;
      renderSettingsCard(wrapper);
    });
    activateButton.addEventListener('click', async () => {
      activateButton.disabled = true;
      try {
        const result = await activate({ events: typeof listeningEvents === 'undefined' ? [] : listeningEvents });
        if (typeof listeningEvents !== 'undefined') listeningEvents = result.events;
        renderSettingsCard(wrapper);
      } catch (error) {
        wrapper.querySelector('[data-canonical-activation-status]').textContent = error?.message || 'Cleaned totals could not be activated.';
      }
      activateButton.disabled = false;
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
    root.addEventListener('DOMContentLoaded', () => {
      installApplyWrapper();
      observeSettings();
      root.setTimeout(() => applyToApp(), 1200);
      root.setTimeout(() => applyToApp(), 3200);
    }, { once: true });
  }

  return { STATE_KEY, STATE_VERSION, PAGE_SIZE, defaultState, stateStore, listAll, canonicalizeEvents, prepare, activate, applyToApp, installApplyWrapper };
});
