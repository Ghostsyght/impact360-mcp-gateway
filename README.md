# impact360-mcp-gateway

One MCP server, deployed as a single Cloudflare Worker, covering:

- **HaloPSA** — tickets, notes, clients, sites, agents, assets, reports (20 tools)
- **N-able N-central** — customers, sites, devices, device tasks (6 tools)
- **UniFi Site Manager** — hosts, sites, devices (3 tools, read-only — that's all the official API offers right now)
- **Meraki Dashboard** — organizations, networks, devices, device status, clients (5 tools)
- **SentinelOne** — agents, threats, verdict updates, sites, activities, network isolation (8 tools)

It runs stateless (`createMcpHandler`, a fresh server per request) so it deploys to the
**free Cloudflare Workers plan** — no Durable Objects, no $5/mo plan required.

A service is skipped (no tools registered, no error) if its required env vars aren't set —
you can deploy with just one or two services wired up and add the rest later.

---

## 1. Install dependencies

```powershell
npm install
```

---

## 2. Secrets & credentials — where to find everything

### 🔑 MCP_ACCESS_TOKEN (always required)

A shared secret you generate yourself. Anyone calling your worker needs it in the `Authorization: Bearer <token>` header.

**Generate one:**
```powershell
openssl rand -hex 32
```
Copy the output and save it — that's your token.

---

### 🟦 HaloPSA

| Variable | Where to find it |
|---|---|
| `HALO_AUTH_URL` | HaloPSA → **Configuration** → **Integrations** → **Halo API** → "Auth URL" field |
| `HALO_RESOURCE_URL` | Same page → "Resource Server URL" field |
| `HALO_CLIENT_ID` | Same page → "Client ID" field |
| `HALO_CLIENT_SECRET` | Same page → "Client Secret" field (shown when you create the API app) |
| `HALO_TENANT` | Your HaloPSA tenant name — the subdomain in your HaloPSA URL (e.g. `yourcompany` from `yourcompany.halopsa.com`). Often optional. |
| `HALO_SCOPE` | Leave as `all` unless you want to restrict scope |

**Step-by-step:**
1. Log in to HaloPSA as an admin
2. Go to **Configuration** → **Integrations** → **Halo API**
3. Click **New Application** (or edit an existing one)
4. Set the grant type to **Client Credentials**
5. Copy the Auth URL, Resource URL, Client ID, and Client Secret

---

### 🟧 N-able N-central

| Variable | Where to find it |
|---|---|
| `NABLE_BASE_URL` | Your N-central server URL — e.g. `https://nc.yourcompany.com` (no trailing slash) |
| `NABLE_JWT` | N-central → **Administration** → **User Management** → **Users** → (select your API user) → **API Access** → **Generate JSON Web Token** |

**Step-by-step:**
1. Log in to N-central as an admin
2. Go to **Administration** → **User Management** → **Users**
3. Select the user you want to use for API access (create a dedicated API-only user if you don't have one)
4. Click **API Access** → **Generate JSON Web Token**
5. Copy the JWT — it's shown once

> **Note:** The path for `nable_list_device_tasks` may need adjusting depending on your N-central version. Check `https://<your-fqdn>/api-explorer` if it returns a 404.

---

### 🟩 UniFi Site Manager

| Variable | Where to find it |
|---|---|
| `UNIFI_API_KEY` | [unifi.ui.com](https://unifi.ui.com) → **Settings** (gear icon) → **API Keys** → **Create API Key** |

**Step-by-step:**
1. Log in to [unifi.ui.com](https://unifi.ui.com)
2. Click the gear icon → **API Keys**
3. Click **Create API Key**, give it a name, copy the key

> **Note:** The Site Manager API is currently read-only — no write/control endpoints exist yet on Ubiquiti's side.

---

### 🟥 Meraki Dashboard

| Variable | Where to find it |
|---|---|
| `MERAKI_API_KEY` | [dashboard.meraki.com](https://dashboard.meraki.com) → **Organization** → **Settings** → scroll to **Dashboard API access** → Enable API → **My Profile** → **Generate new API key** |
| `MERAKI_DEFAULT_ORG_ID` | Optional. Run `meraki_list_organizations` once without this set — copy your org ID from the results and set it here to skip passing it on every tool call. |

**Step-by-step:**
1. Log in to [dashboard.meraki.com](https://dashboard.meraki.com)
2. Go to **Organization** → **Settings** → enable **Dashboard API access**
3. Click your profile avatar (top right) → **My Profile**
4. Scroll to **API access** → **Generate new API key**
5. Copy the key immediately — it's only shown once

---

### 🟪 SentinelOne

| Variable | Where to find it |
|---|---|
| `S1_BASE_URL` | Your management console URL — e.g. `https://usea1-partners.sentinelone.net` (no trailing slash). This is the URL you log in to. |
| `S1_API_TOKEN` | See below — use a Service User token (recommended) or your personal token |

**Option A — Service User token (recommended for production):**
> Service user tokens have a configurable expiry, aren't tied to a human account, and survive password changes.

1. Log in to the SentinelOne console as an admin
2. Go to **Settings** → **Users** → **Service Users**
3. Click **Actions** → **Create New Service User**
4. Give it a name (e.g. `impact360-mcp`), set an expiry date, and assign a scope/role (Viewer for read-only, or Admin for full access including isolation)
5. Click **Create User** — the API token is shown **one time only**. Copy it immediately.

**Option B — Personal API token:**
1. Log in to the SentinelOne console
2. Click your username in the top-right corner → **My User**
3. Click **Actions** → **API Token Operations** → **Generate API Token**
4. Copy the token — shown once only

> **Note:** The `s1_isolate_agent` tool sends a network-disconnect command to the endpoint. Make sure your token has Admin scope if you want to use that tool. Viewer scope is sufficient for all read-only tools.

---

### ☁️ Cloudflare Access (optional — for coworker SSO access)

| Variable | Where to find it |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare dashboard → **Zero Trust** → **Settings** → **Custom Pages** — your team domain is shown (e.g. `yourcompany.cloudflareaccess.com`) |
| `CF_ACCESS_AUD` | Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → click your app → **Overview** — the "Application Audience (AUD) Tag" |

Set these only after you've put Cloudflare Access in front of the Worker (see Section 6 below).

---

## 3. Local testing

```powershell
copy .dev.vars.example .dev.vars
# Edit .dev.vars with real values
npm run dev
```

This starts the worker at `http://localhost:8787`. Test it with the MCP Inspector:

```powershell
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:8787/mcp` with header `Authorization: Bearer <your MCP_ACCESS_TOKEN>`.

---

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
npx wrangler secret put S1_BASE_URL
npx wrangler secret put S1_API_TOKEN
```

Skip any secrets for services you're not enabling yet. Then deploy:

```powershell
npm run deploy
```

Wrangler prints your live URL — something like:
`https://impact360-mcp-gateway.<your-account>.workers.dev/mcp`

> **Why can't this be deployed from the Cloudflare dashboard connector?**
> The connected Cloudflare API covers DNS, KV, cache, certificates, and firewall rules —
> it does not expose a Workers *code deploy* endpoint. Worker deployments require
> `wrangler deploy` (which bundles and uploads your TypeScript) or the Cloudflare CI/CD
> integration in your GitHub repo. Run `npm run deploy` from your terminal after cloning
> the repo.

---

## 5. Connect Claude Desktop (direct, with the static token)

Add this to `claude_desktop_config.json` — `mcp-remote` bridges the remote HTTP server to Claude Desktop's local stdio transport:

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

---

## 6. Connect coworkers via a Claude Connector (Cloudflare Access + Entra ID)

The Worker accepts a second, independent auth path: a valid `Cf-Access-Jwt-Assertion`
header, which Cloudflare Access attaches once you put it in front of this Worker. This lets
coworkers add the connector with just a URL and log in with their own Impact360 Entra ID
account — no token to copy, no JSON to edit.

Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` as secrets once Access is configured
(both values are shown in the Cloudflare dashboard when you enable Access on the Worker):

```powershell
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

The static-token path (Section 5) keeps working unchanged — the two auth methods are
independent, so your own `mcp-remote` config doesn't need to change.

---

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
    sentinelone.ts  SentinelOne ApiToken auth + 8 tools
```

## Adding more tools later

Each service file follows the same shape: an auth helper, a small `fetch`-based client
function, and `server.registerTool(...)` calls with a Zod input schema. To add a new
endpoint, copy the pattern of an existing tool in the same file — there's no framework
glue beyond that.
