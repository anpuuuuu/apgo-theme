import assert from 'node:assert/strict';
import test from 'node:test';
import { findLayerHealth } from '../scripts/health-response.mjs';

test('reads a layer from the multi-site health response', () => {
  const row = findLayerHealth({
    sites: [{ siteId: 'apgo-my', layers: [{ layer: 'layer1', storageKey: 'apgo-my:layer1', stale: false }] }],
  }, 'apgo-my', 'layer1');
  assert.equal(row.storageKey, 'apgo-my:layer1');
});

test('falls back to namespaced and then legacy heartbeat keys', () => {
  assert.equal(findLayerHealth({ heartbeats: [{ layer: 'apgo-my:layer4' }] }, 'apgo-my', 'layer4').layer, 'apgo-my:layer4');
  assert.equal(findLayerHealth({ heartbeats: [{ layer: 'layer4' }] }, 'apgo-my', 'layer4').layer, 'layer4');
});

test('never guesses a site id', () => {
  assert.throws(() => findLayerHealth({}, '', 'layer1'), /MONITOR_SITE_ID/);
});
