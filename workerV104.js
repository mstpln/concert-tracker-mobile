import worker from './worker.js';

// Compatibility shim only. Production remains pointed at the watched
// worker.js entry point so future Worker changes continue to trigger the
// existing Cloudflare Builds configuration.
export default worker;
