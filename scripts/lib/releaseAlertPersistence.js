'use strict';
async function persistLifecyclePlan({ plan, readAlerts, writeAlerts, readBands, writeBands, now = new Date().toISOString() }) {
  const latestAlerts = await readAlerts(); let alerts = [...latestAlerts];
  for (const item of plan.alertsToCreate || []) if (!alerts.some((alert) => alert.id === item.id)) alerts.push(item);
  for (const item of plan.alertsToEnrich || []) { const index = alerts.findIndex((alert) => alert.id === item.id); if (index >= 0) alerts[index] = { ...alerts[index], lifecycleStage: alerts[index].lifecycleStage || item.lifecycleStage }; }
  if (JSON.stringify(alerts) !== JSON.stringify(latestAlerts)) await writeAlerts(alerts);
  const present = new Set(alerts.map((alert) => alert.id)); const latestBands = await readBands();
  const updates = new Map(); for (const update of plan.lifecycleUpdates || []) if (present.has(update.alertId)) updates.set(`${update.bandId || ''}|${update.canonicalReleaseId}`, update);
  const bands = latestBands.map((band) => ({ ...band, structuredResearch: { ...(band.structuredResearch || {}), releases: { ...(band.structuredResearch?.releases || {}), canonical: (band.structuredResearch?.releases?.canonical || []).map((release) => { const update = updates.get(`${band.id}|${release.canonicalReleaseId}`) || updates.get(`|${release.canonicalReleaseId}`); return update ? { ...release, lifecycle: { ...(release.lifecycle || {}), [update.stage]: { alertId: update.alertId, generatedAt: release.lifecycle?.[update.stage]?.generatedAt || now } } } : release; }) } } }));
  if (updates.size) await writeBands(bands); return { alerts, bands, applied: updates.size };
}
module.exports = { persistLifecyclePlan };
