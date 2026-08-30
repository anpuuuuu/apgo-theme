export function findLayerHealth(payload, siteId, layer) {
  if (!siteId) throw new Error('MONITOR_SITE_ID is required');

  const site = payload?.sites?.find((entry) => entry.siteId === siteId);
  return site?.layers?.find((row) => row.layer === layer)
    || payload?.heartbeats?.find((row) => row.layer === `${siteId}:${layer}`)
    || payload?.heartbeats?.find((row) => row.layer === layer)
    || null;
}
