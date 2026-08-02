'use strict';

const DEFAULT_TIMEOUT_MS = 30000;
const WRAPPED = Symbol.for('livevault.node-fetch-timeout-wrapped');

function timeoutError(timeoutMs) {
  const error = new Error(`Provider request timed out after ${timeoutMs}ms.`);
  error.name = 'TimeoutError';
  error.code = 'ETIMEDOUT';
  return error;
}

function install(target = globalThis, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!target || typeof target.fetch !== 'function') return null;
  if (target.fetch[WRAPPED]) return target.fetch;

  const originalFetch = target.fetch.bind(target);
  const wrappedFetch = async (input, init = {}) => {
    if (init.signal || typeof target.AbortController !== 'function') return originalFetch(input, init);
    const controller = new target.AbortController();
    const timer = target.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await originalFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(timeoutMs);
      throw error;
    } finally {
      target.clearTimeout(timer);
    }
  };
  Object.defineProperty(wrappedFetch, WRAPPED, { value: true });
  target.fetch = wrappedFetch;
  return wrappedFetch;
}

module.exports = { DEFAULT_TIMEOUT_MS, install, timeoutError };
