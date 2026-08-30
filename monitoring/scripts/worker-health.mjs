#!/usr/bin/env node
import { findLayerHealth } from './health-response.mjs';

const workerUrl = (process.env.MONITOR_WORKER_URL || '').replace(/\/$/, '');
const siteId = process.env.MONITOR_SITE_ID || '';
if (!workerUrl || !siteId) throw new Error('MONITOR_WORKER_URL and MONITOR_SITE_ID are required');
const response = await fetch(`${workerUrl}/health`, { headers: { 'user-agent': 'APGO-HealthCheck/2.0 GitHub' } });
const body = await response.json().catch(() => ({}));
console.log(JSON.stringify(body, null, 2));
if (!response.ok || !body.ok) throw new Error(`Worker health failed: HTTP ${response.status}`);
const layer1 = findLayerHealth(body, siteId, 'layer1');
if (!layer1 || layer1.stale) throw new Error('Layer 1 heartbeat is missing or stale');
