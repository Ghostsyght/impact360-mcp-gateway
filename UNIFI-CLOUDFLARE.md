# UniFi Cloudflare integration

The live Orbit connection and employee Microsoft sign-in stay unchanged. UniFi uses the existing backend UNIFI_API_KEY secret.

## Entry points

src/index.ts wraps src/live-baseline.ts. The baseline contains the exact recovered application sections from deployed version eb3af49a-2674-4b22-96f3-6d31832b4a71, including the October Site Manager v1, N-central and SentinelOne fixes not present in main. Older src/server.ts and src/services/*.ts are retained as historical source and are not this entrypoint's execution path. Do not rebuild from those older files or dist/worker.min.js.

The recovered baseline's only integration change is registration of registerExpandedUnifiTools after the original four UniFi tools. New code is in src/services/unifi-network.ts, src/services/unifi-docs.ts, src/lib/unifi-policy.ts and src/lib/unifi-approvals.ts.

## Capabilities and boundary

18 UniFi tools: existing four inventory/health tools, ten API documentation tools, catalog, read, preview, confirm. Network only. Uses the official cloud Connector API and requires compatible console firmware, Network API version and key scope. It does not install or run Python and does not reproduce all of sirkirby's session/legacy APIs.

KallistoX/mcp-unifi-applications supplies Network documentation scraped October 12, 2026, version 10.6.106; preserve its MIT notice in src/data/unifi/KallistoX-LICENSE. This is a versioned snapshot rather than live schema discovery. The implementation follows sirkirby/unifi-mcp's preview/confirm safety approach; it does not claim to run that project's server.

Create and update require confirm mode, explicit enabled gates, a displayed preview and user approval. Confirmation is scoped to the authenticated backend connection (Orbit uses a shared backend bearer credential, not individual user OAuth upstream). Tokens expire after ten minutes, are bound to an exact target/body and are consumed atomically before a write. Updates reject stale read-before-write state. A response timeout consumes the token and requires manual live-state inspection before any new preview. Delete and action endpoints are denied regardless of client input. No arbitrary origin, path or method is accepted.

## Build and tests

npm ci
npm run typecheck
npm run test:unifi
npm run build
node tests/worker.test.mjs

The Workers runtime integration tests must run outside the restricted shell launcher on this workstation; the launcher crashes workerd before startup. All 23 policy/docs/SQLite tests passed under the normal Node process. Full Worker HTTP tests passed for 401 without auth, MCP initialization, 18 UniFi tools, docs retrieval and delete denial. No live network mutation was performed.

## Deployment

Worker impact360-mcp-gateway, account 51fb1028b7bd7e89d9f0a25e0418d93a. Existing bindings are inherited, not exported. New SQLite Durable Object UnifiApproval is bound as UNIFI_APPROVALS. Permission variables are in wrangler.jsonc. Orbit mounts impact360-service with the same bearer backend and on_behalf=false. Portal-specific existing vendor overrides are preserved; all 18 UniFi tools are enabled.

Deployed bundle SHA-256: 744eebdc4d7f5a0b941946eb74568a21565c55d6a51a45ba37c8eb6fcff57b4f. Deployment response ID: 3288f4f49dab43f69b4f76983793e9c0. Original version is retained in Cloudflare version history for rollback.

Production connection and tools/list sync passed October 23, 2026. An authenticated live inventory call through an end-user Orbit session still needs separate acceptance evidence; MCP capability sync alone does not verify it. Do not treat create/update as live tested.
