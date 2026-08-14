'use strict';

(function attachGau5PreparationIntegration(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrGau5PreparationIntegrationV121 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  let runningPromise = null;
  let observer = null;

  function dependencies() {
    return {
      gau5: root?.BandmarkrListeningPreparationV121,
      activation: root?.BandmarkrListeningCanonicalActivation,
      migration: root?.BandmarkrListeningDerivedMigration,
    };
  }

  function activationStore() {
    return dependencies().activation?.stateStore?.(root?.localStorage) || null;
  }

  function gau5Store() {
    return dependencies().gau5?.stateStore?.(root?.localStorage) || null;
  }

  function setCanonicalPreparing() {
    const store = activationStore();
    if (!store) return null;
    const current = store.load();
    return store.save({ ...current, status: 'gau5_preparing', error: null });
  }

  function setCanonicalReady(state) {
    const store = activationStore();
    if (!store) return null;
    const current = store.load();
    return store.save({
      ...current,
      status: 'ready',
      sourceEventCount: Number(state.sourceEventCount) || 0,
      canonicalRecordCount: Number(state.verifiedCanonicalCount) || 0,
      duplicateCount: Number(state.verifiedDuplicateCount) || 0,
      reviewGroupCount: Number(state.reviewGroupCount) || 0,
      preparedAt: state.completedAt || new Date().toISOString(),
      activatedAt: null,
      error: null,
    });
  }

  function setCanonicalError(error) {
    const store = activationStore();
    if (!store) return null;
    return store.save({ ...store.load(), status: 'error', error: error?.message || 'Listening preparation stopped safely.' });
  }

  async function currentSourceCount() {
    const migration = dependencies().migration;
    if (!migration?.sourceCount) throw new Error('Private listening history is unavailable.');
    return migration.sourceCount();
  }

  async function resetFreshPreparation() {
    const { gau5, migration } = dependencies();
    const store = gau5Store();
    if (!gau5 || !store) throw new Error('Resumable listening preparation is unavailable.');
    await gau5.preparationStorage()?.clear?.();
    migration?.checkpointStore?.(root?.localStorage)?.clear?.();
    store.clear();
    return store.load();
  }

  async function ensureSourceCompatible({ freshIfIdle = false } = {}) {
    const { gau5 } = dependencies();
    const store = gau5Store();
    if (!gau5 || !store) throw new Error('Resumable listening preparation is unavailable.');
    const state = store.load();
    const count = await currentSourceCount();
    if (!count) throw new Error('No private listening history is stored on this device.');
    if (state.sourceEventCount != null && state.sourceEventCount !== count) {
      await resetFreshPreparation();
      return { reset: true, sourceEventCount: count };
    }
    if (freshIfIdle && state.status === 'idle') {
      await resetFreshPreparation();
      return { reset: true, sourceEventCount: count };
    }
    return { reset: false, sourceEventCount: count };
  }

  function options() {
    return {
      bands: typeof bands === 'undefined' ? [] : bands,
      localStorage: root?.localStorage,
      documentRef: root?.document,
    };
  }

  async function runPreparation({ userInitiated = false } = {}) {
    if (runningPromise) return runningPromise;
    runningPromise = (async () => {
      const { gau5 } = dependencies();
      const store = gau5Store();
      if (!gau5?.prepare || !store) throw new Error('Resumable listening preparation is unavailable.');
      await ensureSourceCompatible({ freshIfIdle: userInitiated });
      setCanonicalPreparing();
      render();
      try {
        const result = await gau5.prepare(options());
        if (result.state?.status === 'complete') setCanonicalReady(result.state);
        else setCanonicalPreparing();
        render();
        return result;
      } catch (error) {
        setCanonicalError(error);
        render();
        throw error;
      }
    })().finally(() => { runningPromise = null; });
    return runningPromise;
  }

  function setVisible(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    if (visible) element.style.removeProperty('display');
    else element.style.display = 'none';
  }

  function render(container = root?.document?.querySelector?.('[data-canonical-activation]')) {
    if (!container) return false;
    const { gau5 } = dependencies();
    const state = gau5Store()?.load?.();
    if (!gau5 || !state || state.status === 'idle') return false;
    const status = container.querySelector('[data-canonical-activation-status]');
    const prepare = container.querySelector('[data-canonical-prepare]');
    const activate = container.querySelector('[data-canonical-activate]');
    const deactivate = container.querySelector('[data-canonical-deactivate]');
    const canonical = activationStore()?.load?.();
    if (canonical?.status === 'active') return false;
    if (status) status.textContent = gau5.progressText(state);
    if (prepare) {
      setVisible(prepare, state.status !== 'complete');
      prepare.disabled = Boolean(runningPromise);
      prepare.textContent = state.status === 'paused' || state.status === 'running' || state.status === 'error' ? 'Resume preparation' : 'Prepare cleaned totals';
    }
    setVisible(activate, state.status === 'complete');
    setVisible(deactivate, false);
    return true;
  }

  function takeOverPrepareButton() {
    const card = root?.document?.querySelector?.('[data-canonical-activation]');
    const button = card?.querySelector?.('[data-canonical-prepare]');
    if (!card || !button || button.dataset.gau5Owned === 'true') return false;
    const replacement = button.cloneNode(true);
    replacement.dataset.gau5Owned = 'true';
    button.replaceWith(replacement);
    replacement.addEventListener('click', async () => {
      replacement.disabled = true;
      try { await runPreparation({ userInitiated: true }); }
      catch (_) {}
      finally { replacement.disabled = false; render(card); }
    });
    render(card);
    return true;
  }

  async function resumePersistedWork() {
    const store = gau5Store();
    if (!store) return false;
    const state = store.load();
    if (!['paused', 'running'].includes(state.status)) return false;
    if (root?.document?.visibilityState === 'hidden') return false;
    try {
      await runPreparation();
      return true;
    } catch (_) {
      return false;
    }
  }

  function install() {
    if (!root?.document || root.__gau5PreparationIntegrationInstalled) return false;
    root.__gau5PreparationIntegrationInstalled = true;
    const onReady = () => {
      takeOverPrepareButton();
      const { gau5 } = dependencies();
      gau5?.installAutoResume?.({ documentRef: root.document, store: gau5Store(), resume: resumePersistedWork });
      root.setTimeout?.(resumePersistedWork, 0);
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', onReady, { once: true });
    else onReady();
    if (root.MutationObserver) {
      observer = new root.MutationObserver(() => takeOverPrepareButton());
      observer.observe(root.document.documentElement, { subtree: true, childList: true });
    }
    return true;
  }

  if (typeof root?.document !== 'undefined') install();

  return {
    dependencies,
    activationStore,
    gau5Store,
    setCanonicalPreparing,
    setCanonicalReady,
    setCanonicalError,
    currentSourceCount,
    resetFreshPreparation,
    ensureSourceCompatible,
    runPreparation,
    setVisible,
    render,
    takeOverPrepareButton,
    resumePersistedWork,
    install,
  };
});
