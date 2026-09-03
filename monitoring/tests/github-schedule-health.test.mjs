import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWithinScope, selectMeaningfulScheduledRun, selectWorkflowFreshnessRun } from '../scripts/github-schedule-health-lib.mjs';

test('GA4-only legacy scope excludes browser recovery but preserves rollback default', () => {
  assert.equal(checkWithinScope('monitor-alerts.yml', 'ga4-only'), true);
  assert.equal(checkWithinScope('site-health-v2.yml', 'ga4-only'), false);
  assert.equal(checkWithinScope('site-health-v2.yml'), true);
  assert.throws(() => checkWithinScope('site-health-v2.yml', 'invalid'), /Invalid MONITOR_SELF_HEALTH_SCOPE/);
});

test('GA4-only legacy watchdog never queries or restarts Layer 2', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.match(url, /monitor-alerts\.yml\/runs/);
    return Response.json({ workflow_runs: [{ id: 1, event: 'schedule', status: 'completed', conclusion: 'success', updated_at: new Date().toISOString() }] });
  });
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(JSON.parse(line)));
  const keys = ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'MONITOR_SELF_HEALTH_SCOPE'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.GITHUB_TOKEN = 'test';
    process.env.GITHUB_REPOSITORY = 'example/theme';
    process.env.MONITOR_SELF_HEALTH_SCOPE = 'ga4-only';
    await import('../scripts/github-schedule-health.mjs?scope-test');
    assert.equal(globalThis.fetch.mock.callCount(), 1);
    assert.ok(logged.some((entry) => entry.workflow === 'site-health-v2.yml' && entry.status === 'owned_by_central'));
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('GA4-only legacy workflow skips Worker and Layer 3 work, retaining GA4 schedule checks', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/monitor-self-health.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Check Worker and Layer 1 heartbeat\s+if: inputs\.rollout_validation != true && vars\.MONITOR_SELF_HEALTH_SCOPE != 'ga4-only'/);
  assert.match(workflow, /Refresh Layer 3 beacon self-test\s+if: always\(\) && inputs\.rollout_validation != true && vars\.MONITOR_SELF_HEALTH_SCOPE != 'ga4-only'/);
  assert.match(workflow, /MONITOR_SELF_HEALTH_SCOPE: \$\{\{ vars\.MONITOR_SELF_HEALTH_SCOPE \|\| 'all' \}\}/);
});

test('ignores a cancelled pending schedule and uses the latest meaningful result', () => {
  const cancelled = { id: 3, status: 'completed', conclusion: 'cancelled' };
  const success = { id: 2, status: 'completed', conclusion: 'success' };
  const olderFailure = { id: 1, status: 'completed', conclusion: 'failure' };
  const result = selectMeaningfulScheduledRun([cancelled, success, olderFailure]);
  assert.equal(result.run, success);
  assert.deepEqual(result.ignored, [cancelled]);
});

test('does not hide a real workflow failure', () => {
  const failed = { id: 4, status: 'completed', conclusion: 'failure' };
  const success = { id: 3, status: 'completed', conclusion: 'success' };
  assert.equal(selectMeaningfulScheduledRun([failed, success]).run, failed);
});

test('does not treat an in-progress run as a completed health result', () => {
  const running = { id: 5, status: 'in_progress', conclusion: null };
  const success = { id: 4, status: 'completed', conclusion: 'success' };
  assert.equal(selectMeaningfulScheduledRun([running, success]).run, success);
});

test('workflow freshness accepts dispatch recovery and exposes an active run', () => {
  const active = { id: 7, event: 'workflow_dispatch', status: 'in_progress', conclusion: null };
  const recovery = { id: 6, event: 'workflow_dispatch', status: 'completed', conclusion: 'success' };
  const push = { id: 5, event: 'push', status: 'completed', conclusion: 'success' };
  const result = selectWorkflowFreshnessRun([active, recovery, push]);
  assert.equal(result.active, active);
  assert.equal(result.run, recovery);
});

test('Layer 2 daily freshness ignores successful post-deploy pushes', () => {
  const push = { id: 8, event: 'push', status: 'completed', conclusion: 'success' };
  const schedule = { id: 7, event: 'schedule', status: 'completed', conclusion: 'success' };
  assert.equal(selectWorkflowFreshnessRun([push, schedule]).run, schedule);
});

