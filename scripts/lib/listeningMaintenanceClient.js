'use strict';

const { createWorkerClient } = require('./workerClient');

const MAINTENANCE_TOKEN_ENV = 'DATA_MAINTENANCE_TOKEN';

function createListeningMaintenanceClient(options = {}) {
  return createWorkerClient({
    tokenEnv: MAINTENANCE_TOKEN_ENV,
    ...options,
  });
}

module.exports = { MAINTENANCE_TOKEN_ENV, createListeningMaintenanceClient };
