# impact360-mcp-gateway

One MCP server, deployed as a single Cloudflare Worker, covering:

- **HaloPSA** — tickets, notes, clients, sites, agents, assets, reports (20 tools)
- **N-able N-central** — customers, sites, devices, device tasks (6 tools)
- **UniFi Site Manager** — hosts, sites, devices (3 tools, read-only — that's all the official API offers right now)
- **Meraki Dashboard** — organizations, networks, devices, device status, clients (5 tools)

It runs stateless (`createMcpHandler`, a fresh server per request) so it deploys to the
**free Cloudflare Workers plan** — no Durable Objects, no $5/mo plan required.

A service is skipped (no tools registered, no error) if its required env vars aren't set —
you can deploy with just one or two services wired up and add the rest later.

## 1. Install dependencies

```powershell
npm install
```

## 2. Get credentials for each service you want to enable

| Service | What you need | Where to get it |
| --- | --- | --- |
| HaloPSA | Auth URL, Resource URL, Client ID/Secret | Configuration > Integrations > Halo API |
| N-able N-central | Base URL, JWT | Administration > User Management > Users > (API-only user) > API Access > Generate JSON Web Token |
| UniFi Site Manager | API key | unifi.ui.com > Settings > API Keys |
| Meraki Dashboard | API key | dashboard.meraki.com > Organization > Settings > Dashboard API access |

Full variable list with notes is in `.dev.vars.example`.

> **N-able note:** the exact path for `nable_list_device_tasks` may need adjusting for your
> N-central version — check `https://<your-fqdn>/api-explorer` if it 404s.
>
> **UniFi note:** the Site Manager API is currently read-only, so these tools only list data —
> no write/control endpoints exist yet on Ubiquiti's side.

## 3. Local testing

```powershell
copy .dev.vars.example .dev.vars
# edit .dev.vars with real values
npm run dev
```

This starts the worker at `http://localhost:8787`. Test it with the MCP Inspector:

```powershell
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:8787/mcp` with header `Authorization: Bearer <your MCP_ACCESS_TOKEN>`.

## 4. Deploy to Cloudflare

First time, log in:

```powershell
npx wrangler login
```

Set each secret (you'll be prompted to paste the value):

```powershell
npx wrangler secret put MCP_ACCESS_TOKEN
npx wrangler secret put HALO_AUTH_URL
npx wrangler secret put HALO_RESOURCE_URL
npx wrangler secret put HALO_CLIENT_ID
npx wrangler secret put HALO_CLIENT_SECRET
npx wrangler secret put HALO_TENANT
npx wrangler secret put HALO_SCOPE
npx wrangler secret put NABLE_BASE_URL
npx wrangler secret put NABLE_JWT
npx wrangler secret put UNIFI_API_KEY
npx wrangler secret put MERAKI_API_KEY
npx wrangler secret put MERAKI_DEFAULT_ORG_ID
```

(Skip the secrets for any service you're not enabling yet. `CF_ACCESS_TEAM_DOMAIN` and
`CF_ACCESS_AUD` come later, in Section 6, once Cloudflare Access is set up.)

Then deploy:

```powershell
npm run deploy
```

Wrangler prints your live URL — something like:
`https://impact360-mcp-gateway.<your-account>.workers.dev/mcp`

If you've already got this hostname fronted by your own domain (e.g. via a Cloudflare
custom domain on the Worker), use that instead — same `/mcp` path either way.

## 5. Connect Claude Desktop (direct, with the static token)

Add this to `claude_desktop_config.json`, same pattern as your existing N-able entry —
`mcp-remote` bridges the remote HTTP server to Claude Desktop's local stdio transport:

```json
"impact360-gateway": {
  "command": "C:\\Users\\JayDaniel\\AppData\\Roaming\\npm\\mcp-remote.cmd",
  "args": [
    "https://impact360-mcp-gateway.<your-account>.workers.dev/mcp",
    "--header",
    "Authorization:Bearer <your MCP_ACCESS_TOKEN>"
  ]
}
```

Restart Claude Desktop fully after editing the config.

## 6. Connect coworkers via a Claude Connector (Cloudflare Access + Entra ID)

The Worker accepts a second, independent auth path: a valid `Cf-Access-Jwt-Assertion`
header, which Cloudflare Access attaches once you put it in front of this Worker. This is
what lets coworkers add the connector with just a URL and log in with their own Impact360
Entra ID account — no token to copy, no JSON to edit.

Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` as secrets once Access is configured
(both values are shown in the Cloudflare dashboard when you enable Access on the Worker):

```powershell
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

The static-token path (Section 5) keeps working unchanged — the two auth methods are
independent, so your own `mcp-remote` config doesn't need to change.

## Project layout

```
src/
  index.ts          Worker entry point: bearer-token gate, /healthz, createMcpHandler wiring
  server.ts         Assembles the McpServer, registers each service that's configured
  env.ts            Env interface + "is this service configured" check
  lib/
    http.ts         Shared fetch-based JSON client, error formatting, pagination helper
    types.ts        Shared ResponseFormat enum
  services/
    halo.ts         HaloPSA OAuth client_credentials + 20 tools
    nable.ts        N-central JWT->access-token exchange + 6 tools
    unifi.ts        UniFi Site Manager API-key auth + 3 tools
    meraki.ts       Meraki Dashboard Bearer auth + 5 tools
```

## Adding more tools later

Each service file follows the same shape: an auth helper, a small `fetch`-based client
function, and `server.registerTool(...)` calls with a Zod input schema. To add a new
endpoint, copy the pattern of an existing tool in the same file — there's no framework
glue beyond that.
