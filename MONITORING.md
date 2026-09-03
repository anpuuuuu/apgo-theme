# Website monitoring moved to the central repository

Production monitoring for APGO MY is maintained in [apgo-storefront-monitoring](https://github.com/anpuuuuu/apgo-storefront-monitoring).

- Layer 1 uptime and Layer 3 errors keep using the existing Cloudflare Error Monitor URL and D1.
- Central Actions owns Layer 2 Daily/post-deploy, GA4 Layer 4 and self-health.
- The GitHub App/Dispatcher sends Theme main updates with their exact commit SHA; no monitoring workflow or cross-repository credential belongs here.
- Keep `snippets/apgo-error-monitor.liquid`, its four layout references and frontend `apgo_cart_error` reporting. These remain part of the Theme and were not changed during migration.

## Recovery

The pre-retirement tag `monitoring-pre-retirement-20260903` preserves all 65 removed monitoring files and workflows. Scoped restoration was verified without changing the frontend tree.

Follow [the central cutover and rollback record](https://github.com/anpuuuuu/apgo-storefront-monitoring/blob/main/docs/FINAL-CUTOVER.md). Do not restore the entire old Theme or run both monitoring owners simultaneously. Revoked credentials require freshly authorized replacements before legacy tasks can run.
