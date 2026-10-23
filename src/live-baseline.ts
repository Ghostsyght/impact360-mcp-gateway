// @ts-nocheck
// Recovered verbatim application sections from production version eb3af49a.
// Dependency bundle is rebuilt; vendor application behavior is preserved.
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as external_exports from "zod";
import { importJWK, jwtVerify } from "jose";
import { registerExpandedUnifiTools } from "./services/unifi-network.js";
const __name = (value, name) => Object.defineProperty(value, "name", {value:name, configurable:true});
// src/env.ts
function isHaloConfigured(env2) {
  return !!(env2.HALO_AUTH_URL && env2.HALO_RESOURCE_URL && env2.HALO_CLIENT_ID && env2.HALO_CLIENT_SECRET);
}
__name(isHaloConfigured, "isHaloConfigured");
function isNableConfigured(env2) {
  return !!(env2.NABLE_BASE_URL && env2.NABLE_JWT);
}
__name(isNableConfigured, "isNableConfigured");
function isUnifiConfigured(env2) {
  return !!env2.UNIFI_API_KEY;
}
__name(isUnifiConfigured, "isUnifiConfigured");
function isMerakiConfigured(env2) {
  return !!env2.MERAKI_API_KEY;
}
__name(isMerakiConfigured, "isMerakiConfigured");
function isSentinelOneConfigured(env2) {
  return !!(env2.S1_BASE_URL && env2.S1_API_TOKEN);
}
__name(isSentinelOneConfigured, "isSentinelOneConfigured");
function isCfAccessConfigured(env2) {
  return !!(env2.CF_ACCESS_TEAM_DOMAIN && env2.CF_ACCESS_AUD);
}
__name(isCfAccessConfigured, "isCfAccessConfigured");


// src/lib/http.ts
var ApiError = class extends Error {
  constructor(status, body, message2) {
    super(message2);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
  status;
  body;
  static {
    __name(this, "ApiError");
  }
};
async function fetchJson(url2, init = {}) {
  const res = await fetch(url2, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers
    }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      text,
      `HTTP ${res.status} from ${url2}: ${text.slice(0, 300)}`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
__name(fetchJson, "fetchJson");
function formatError2(err) {
  if (err instanceof ApiError) {
    return `Error ${err.status}: ${err.body.slice(0, 500)}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Unknown error: ${String(err)}`;
}
__name(formatError2, "formatError");


// src/services/halo.ts
var tokenCache = null;
async function getHaloToken(env2) {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 6e4) {
    return tokenCache.token;
  }
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env2.HALO_CLIENT_ID,
    client_secret: env2.HALO_CLIENT_SECRET,
    scope: env2.HALO_SCOPE ?? "all"
  });
  if (env2.HALO_TENANT) params.set("tenant", env2.HALO_TENANT);
  const data = await fetchJson(
    `${env2.HALO_AUTH_URL}/token`,
    { method: "POST", body: params, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1e3
  };
  return tokenCache.token;
}
__name(getHaloToken, "getHaloToken");
async function haloFetch(env2, path, init = {}) {
  const token = await getHaloToken(env2);
  const base = env2.HALO_RESOURCE_URL.replace(/\/$/, "");
  return fetchJson(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers
    }
  });
}
__name(haloFetch, "haloFetch");
var formatSchema = external_exports.enum(["summary", "full"]).optional().default("summary").describe(
  'Response verbosity: "summary" (default) returns key fields; "full" returns the raw JSON.'
);
function registerHaloTools(server, env2) {
  server.registerTool("halo_list_tickets", {
    description: "List HaloPSA tickets with optional filters.",
    inputSchema: {
      status: external_exports.string().optional().describe("Filter by status name, e.g. 'Open', 'In Progress'"),
      client_id: external_exports.number().optional().describe("Filter by client ID"),
      agent_id: external_exports.number().optional().describe("Filter by assigned agent ID"),
      page_size: external_exports.number().optional().default(50).describe("Max results (default 50)"),
      format: formatSchema
    }
  }, async ({ status, client_id, agent_id, page_size, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (status) qs.set("ticketstatus", status);
      if (client_id) qs.set("client_id", String(client_id));
      if (agent_id) qs.set("agent_id", String(agent_id));
      const data = await haloFetch(env2, `/Tickets?${qs}`);
      const tickets = data.tickets ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(tickets, null, 2) }] };
      }
      const summary = tickets.map((t2) => ({
        id: t2.id,
        summary: t2.summary,
        status: t2.status?.name,
        client: t2.client_name,
        agent: t2.agent?.name,
        priority: t2.priority?.name,
        date_occurred: t2.dateoccurred
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_get_ticket", {
    description: "Get a single HaloPSA ticket by ID.",
    inputSchema: {
      ticket_id: external_exports.number().describe("The ticket ID"),
      format: formatSchema
    }
  }, async ({ ticket_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Tickets/${ticket_id}`);
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s2 = {
        id: data.id,
        summary: data.summary,
        status: data.status?.name,
        client: data.client_name,
        agent: data.agent?.name,
        description: data.details,
        date_occurred: data.dateoccurred
      };
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_create_ticket", {
    description: "Create a new HaloPSA ticket.",
    inputSchema: {
      summary: external_exports.string().describe("Ticket summary / title"),
      details: external_exports.string().optional().describe("Ticket description / body"),
      client_id: external_exports.number().optional().describe("Client ID to associate"),
      agent_id: external_exports.number().optional().describe("Agent ID to assign"),
      priority_id: external_exports.number().optional().describe("Priority ID"),
      tickettype_id: external_exports.number().optional().describe("Ticket type ID")
    }
  }, async ({ summary, details, client_id, agent_id, priority_id, tickettype_id }) => {
    try {
      const body = { summary, details };
      if (client_id) body.client_id = client_id;
      if (agent_id) body.agent_id = agent_id;
      if (priority_id) body.priority_id = priority_id;
      if (tickettype_id) body.tickettype_id = tickettype_id;
      const data = await haloFetch(env2, "/Tickets", {
        method: "POST",
        body: JSON.stringify([body])
      });
      return { content: [{ type: "text", text: `Ticket created: ${JSON.stringify(data)}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_update_ticket", {
    description: "Update an existing HaloPSA ticket.",
    inputSchema: {
      ticket_id: external_exports.number().describe("The ticket ID to update"),
      summary: external_exports.string().optional(),
      details: external_exports.string().optional(),
      agent_id: external_exports.number().optional(),
      priority_id: external_exports.number().optional(),
      status_id: external_exports.number().optional().describe("Status ID to set")
    }
  }, async ({ ticket_id, summary, details, agent_id, priority_id, status_id }) => {
    try {
      const body = { id: ticket_id };
      if (summary) body.summary = summary;
      if (details) body.details = details;
      if (agent_id) body.agent_id = agent_id;
      if (priority_id) body.priority_id = priority_id;
      if (status_id) body.status_id = status_id;
      const data = await haloFetch(env2, "/Tickets", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Ticket updated: ${JSON.stringify(data)}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_close_ticket", {
    description: "Close a HaloPSA ticket by setting its status to Closed (status_id 9 by default; override if your instance differs).",
    inputSchema: {
      ticket_id: external_exports.number().describe("Ticket ID to close"),
      close_status_id: external_exports.number().optional().default(9).describe("Status ID that represents 'Closed' in your Halo instance (default 9)")
    }
  }, async ({ ticket_id, close_status_id }) => {
    try {
      await haloFetch(env2, "/Tickets", {
        method: "POST",
        body: JSON.stringify([{ id: ticket_id, status_id: close_status_id ?? 9 }])
      });
      return { content: [{ type: "text", text: `Ticket ${ticket_id} closed.` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_list_ticket_notes", {
    description: "List notes/actions on a HaloPSA ticket.",
    inputSchema: {
      ticket_id: external_exports.number().describe("Ticket ID"),
      format: formatSchema
    }
  }, async ({ ticket_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Actions?ticket_id=${ticket_id}`);
      const notes = data.actions ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
      }
      const s2 = notes.map((n2) => ({
        id: n2.id,
        note: n2.note,
        who: n2.who_name,
        date: n2.date
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_add_ticket_note", {
    description: "Add a note/action to a HaloPSA ticket.",
    inputSchema: {
      ticket_id: external_exports.number().describe("Ticket ID"),
      note: external_exports.string().describe("Note body text"),
      outcome: external_exports.string().optional().describe("Outcome / resolution note"),
      send_email: external_exports.boolean().optional().default(false).describe("Email the note to the client")
    }
  }, async ({ ticket_id, note, outcome, send_email }) => {
    try {
      const body = { ticket_id, note, outcome, sendemail: send_email ?? false };
      const data = await haloFetch(env2, "/Actions", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Note added: ${JSON.stringify(data)}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_list_clients", {
    description: "List HaloPSA clients.",
    inputSchema: {
      search: external_exports.string().optional().describe("Name search string"),
      page_size: external_exports.number().optional().default(50),
      format: formatSchema
    }
  }, async ({ search, page_size, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (search) qs.set("search", search);
      const data = await haloFetch(env2, `/Client?${qs}`);
      const clients = data.clients ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
      }
      const s2 = clients.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.client_contact_email,
        phone: c.client_telephone
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_get_client", {
    description: "Get a HaloPSA client by ID.",
    inputSchema: { client_id: external_exports.number(), format: formatSchema }
  }, async ({ client_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Client/${client_id}`);
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      const s2 = { id: data.id, name: data.name, email: data.client_contact_email, phone: data.client_telephone };
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_create_client", {
    description: "Create a new HaloPSA client.",
    inputSchema: {
      name: external_exports.string().describe("Client name"),
      email: external_exports.string().optional(),
      phone: external_exports.string().optional(),
      notes: external_exports.string().optional()
    }
  }, async ({ name, email: email3, phone, notes }) => {
    try {
      const body = { name };
      if (email3) body.client_contact_email = email3;
      if (phone) body.client_telephone = phone;
      if (notes) body.notes = notes;
      const data = await haloFetch(env2, "/Client", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Client created: ${JSON.stringify(data)}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_list_sites", {
    description: "List HaloPSA sites, optionally filtered by client.",
    inputSchema: {
      client_id: external_exports.number().optional(),
      page_size: external_exports.number().optional().default(50),
      format: formatSchema
    }
  }, async ({ client_id, page_size, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (client_id) qs.set("client_id", String(client_id));
      const data = await haloFetch(env2, `/Site?${qs}`);
      const sites = data.sites ?? [];
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      const s2 = sites.map((s3) => ({ id: s3.id, name: s3.name, client_id: s3.client_id }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_get_site", {
    description: "Get a HaloPSA site by ID.",
    inputSchema: { site_id: external_exports.number(), format: formatSchema }
  }, async ({ site_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Site/${site_id}`);
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, name: data.name, client_id: data.client_id, address: data.address }, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_list_agents", {
    description: "List HaloPSA agents (technicians).",
    inputSchema: { page_size: external_exports.number().optional().default(50), format: formatSchema }
  }, async ({ page_size, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Agent?count=${page_size ?? 50}`);
      const agents = data.agents ?? [];
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
      const s2 = agents.map((a2) => ({ id: a2.id, name: a2.name, email: a2.email }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_get_agent", {
    description: "Get a HaloPSA agent by ID.",
    inputSchema: { agent_id: external_exports.number(), format: formatSchema }
  }, async ({ agent_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Agent/${agent_id}`);
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, name: data.name, email: data.email, team: data.team }, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_list_assets", {
    description: "List HaloPSA assets/CIs.",
    inputSchema: {
      client_id: external_exports.number().optional(),
      site_id: external_exports.number().optional(),
      search: external_exports.string().optional(),
      page_size: external_exports.number().optional().default(50),
      format: formatSchema
    }
  }, async ({ client_id, site_id, search, page_size, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (client_id) qs.set("client_id", String(client_id));
      if (site_id) qs.set("site_id", String(site_id));
      if (search) qs.set("search", search);
      const data = await haloFetch(env2, `/Asset?${qs}`);
      const assets = data.assets ?? [];
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(assets, null, 2) }] };
      const s2 = assets.map((a2) => ({
        id: a2.id,
        name: a2.inventory_number,
        type: a2.assettype?.name,
        client: a2.client_name,
        site: a2.site?.name
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_get_asset", {
    description: "Get a HaloPSA asset by ID.",
    inputSchema: { asset_id: external_exports.number(), format: formatSchema }
  }, async ({ asset_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Asset/${asset_id}`);
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, name: data.inventory_number, type: data.assettype?.name, client: data.client_name }, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_create_asset", {
    description: "Create a new HaloPSA asset.",
    inputSchema: {
      inventory_number: external_exports.string().describe("Asset name / inventory number"),
      assettype_id: external_exports.number().optional().describe("Asset type ID"),
      client_id: external_exports.number().optional(),
      site_id: external_exports.number().optional(),
      notes: external_exports.string().optional()
    }
  }, async ({ inventory_number, assettype_id, client_id, site_id, notes }) => {
    try {
      const body = { inventory_number };
      if (assettype_id) body.assettype_id = assettype_id;
      if (client_id) body.client_id = client_id;
      if (site_id) body.site_id = site_id;
      if (notes) body.notes = notes;
      const data = await haloFetch(env2, "/Asset", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Asset created: ${JSON.stringify(data)}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_update_asset", {
    description: "Update an existing HaloPSA asset.",
    inputSchema: {
      asset_id: external_exports.number(),
      inventory_number: external_exports.string().optional(),
      client_id: external_exports.number().optional(),
      site_id: external_exports.number().optional(),
      notes: external_exports.string().optional()
    }
  }, async ({ asset_id, inventory_number, client_id, site_id, notes }) => {
    try {
      const body = { id: asset_id };
      if (inventory_number) body.inventory_number = inventory_number;
      if (client_id) body.client_id = client_id;
      if (site_id) body.site_id = site_id;
      if (notes) body.notes = notes;
      const data = await haloFetch(env2, "/Asset", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Asset updated: ${JSON.stringify(data)}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_list_reports", {
    description: "List available HaloPSA reports.",
    inputSchema: { format: formatSchema }
  }, async ({ format: format2 }) => {
    try {
      const data = await haloFetch(env2, "/Report");
      const reports = data.reports ?? [];
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(reports, null, 2) }] };
      const s2 = reports.map((r2) => ({ id: r2.id, name: r2.name }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("halo_run_report", {
    description: "Run a HaloPSA report by ID and return results.",
    inputSchema: {
      report_id: external_exports.number().describe("Report ID from halo_list_reports"),
      format: formatSchema
    }
  }, async ({ report_id, format: format2 }) => {
    try {
      const data = await haloFetch(env2, `/Report/${report_id}`);
      if (format2 === "full" /* Full */) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
}
__name(registerHaloTools, "registerHaloTools");


// src/services/nable.ts
var nableTokenCache = null;
async function getNableToken(env2) {
  const jwt = String(env2.NABLE_JWT || "").trim().replace(/^Bearer\s+/i, "");
  const now = Date.now();
  if (nableTokenCache && nableTokenCache.expiresAt > now + 60000) return nableTokenCache.token;
  try {
    const segment = jwt.split(".")[1];
    if (segment) {
      const payload = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
      if (typeof payload.exp === "number" && payload.exp * 1000 <= now) {
        throw new Error("N-central: the stored User-API JWT has expired; refresh NABLE_JWT in Worker secrets");
      }
    }
  } catch (error) {
    if (String(error.message).includes("stored User-API JWT has expired")) throw error;
  }
  const base = env2.NABLE_BASE_URL.replace(/\/$/, "");
  if (new URL(base).hostname.toLowerCase() !== "3.3-vue.com") throw new Error("N-central: configured NABLE_BASE_URL does not target the approved 3.3-vue.com server");
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) throw new Error("N-central: stored JWT is not in the expected three-part JWT format");
  const data = await fetchJson(base + "/api/auth/authenticate", {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, Accept: "application/json" }
  });
  const access = data?.tokens?.access;
  if (!access || typeof access.token !== "string" || !access.token) throw new Error("N-central: authentication response did not contain an access token");
  const ttl = Number(access.expirySeconds);
  const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 3600;
  nableTokenCache = { token: access.token, expiresAt: now + seconds * 1000 };
  return access.token;
}
__name(getNableToken, "getNableToken");
async function nableFetch(env2, path, init = {}) {
  const token = await getNableToken(env2);
  const base = env2.NABLE_BASE_URL.replace(/\/$/, "");
  return fetchJson(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers
    }
  });
}
__name(nableFetch, "nableFetch");
var formatSchema2 = external_exports.enum(["summary", "full"]).optional().default("summary");
function registerNableTools(server, env2) {
  server.registerTool("nable_list_customers", {
    description: "List all customers in N-able N-central.",
    inputSchema: { format: formatSchema2 }
  }, async ({ format: format2 }) => {
    try {
      const customers = [];
      const seen = new Set();
      for (let page = 1; ; page++) {
        if (page > 200) throw new Error("N-central customer pagination exceeded safety limit");
        const response = await nableFetch(env2, `/api/customers?pageSize=50&pageNumber=${page}`);
        const rows = response.data ?? response;
        if (!Array.isArray(rows)) throw new Error("N-central returned an unexpected customer list");
        for (const customer of rows) {
          const id = String(customer.customerId ?? customer.id);
          if (seen.has(id)) throw new Error("N-central returned duplicate customers across pages; count cannot be verified");
          seen.add(id);
          customers.push(customer);
        }
        if (Number.isFinite(Number(response.totalPages)) && Number(response.totalPages) > 0) {
          if (page >= Number(response.totalPages)) break;
        } else if (rows.length < 50) break;
      }
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(customers, null, 2) }] };
      }
      const s2 = customers.map((c) => ({
        id: c.customerId ?? c.id,
        name: c.customerName ?? c.name,
        type: c.customerType
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("nable_list_sites", {
    description: "List sites for a customer in N-able N-central.",
    inputSchema: {
      customer_id: external_exports.number().describe("Customer ID from nable_list_customers"),
      format: formatSchema2
    }
  }, async ({ customer_id, format: format2 }) => {
    try {
      const data = await nableFetch(env2, `/api/customers/${customer_id}/sites`);
      const sites = data.data ?? data;
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      }
      const s2 = sites.map((s3) => ({
        id: s3.siteId ?? s3.id,
        name: s3.siteName ?? s3.name
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("nable_list_devices", {
    description: "List devices, optionally filtered by customer or site.",
    inputSchema: {
      customer_id: external_exports.number().optional().describe("Filter by customer ID"),
      site_id: external_exports.number().optional().describe("Filter by site ID"),
      page_size: external_exports.number().optional().default(50),
      format: formatSchema2
    }
  }, async ({ customer_id, site_id, format: format2, page_size }) => {
    try {
      const qs = new URLSearchParams({ pageSize: String(page_size ?? 50) });
      if (customer_id) qs.set("customerId", String(customer_id));
      if (site_id) qs.set("siteId", String(site_id));
      const data = await nableFetch(env2, `/api/devices?${qs}`);
      const devices = data.data ?? data;
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
      }
      const s2 = devices.map((d2) => ({
        id: d2.deviceId ?? d2.id,
        name: d2.deviceName ?? d2.name ?? d2.longName,
        os: d2.deviceClass,
        status: d2.deviceStatus,
        customer_id: d2.customerId,
        site_id: d2.siteId
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("nable_get_device", {
    description: "Get details for a specific N-central device.",
    inputSchema: {
      device_id: external_exports.number().describe("Device ID"),
      format: formatSchema2
    }
  }, async ({ device_id, format: format2 }) => {
    try {
      const data = await nableFetch(env2, `/api/devices/${device_id}`);
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const device = data.data ?? data;
      const s2 = {
        id: device.deviceId ?? device.id,
        name: device.deviceName ?? device.longName ?? device.discoveredName ?? device.name,
        os: device.supportedOsLabel ?? device.deviceClassLabel ?? device.deviceClass,
        status: device.deviceStatus,
        last_logged_in_user: device.lastLoggedInUser,
        customer_id: device.customerId,
        site_id: device.siteId
      };
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("nable_list_device_tasks", {
    description: "List scheduled tasks for an N-central device.",
    inputSchema: {
      device_id: external_exports.number().describe("Device ID"),
      format: formatSchema2
    }
  }, async ({ device_id, format: format2 }) => {
    try {
      const data = await nableFetch(env2, `/api/devices/${device_id}/scheduled-tasks`);
      const tasks = data.data ?? data;
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
      const s2 = tasks.map((t2) => ({
        id: t2.taskId ?? t2.id,
        name: t2.taskName ?? t2.name,
        status: t2.taskStatus ?? t2.status,
        next_run: t2.nextRunTime
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("nable_run_device_task", {
    description: "Trigger a scheduled task on an N-central device immediately.",
    inputSchema: {
      device_id: external_exports.number().describe("Device ID"),
      task_id: external_exports.number().describe("Task ID from nable_list_device_tasks")
    }
  }, async ({ device_id, task_id }) => {
    try {
      await nableFetch(env2, `/api/devices/${device_id}/scheduled-tasks/${task_id}/run`, {
        method: "POST"
      });
      return { content: [{ type: "text", text: `Task ${task_id} triggered on device ${device_id}.` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
}
__name(registerNableTools, "registerNableTools");


// src/services/unifi.ts
// Replacement for the deployed bundle's src/services/unifi.ts section.
// Keeps the existing tool names and UNIFI_API_KEY binding.
var UNIFI_BASE = "https://api.ui.com";
var formatSchema3 = external_exports.enum(["summary", "full"]).optional().default("summary");
async function unifiFetch(env2, path, args) {
  if (!env2.UNIFI_API_KEY) throw new Error("UniFi API key is not configured on the gateway.");
  const url = new URL(path, UNIFI_BASE);
  url.searchParams.set("pageSize", String(args.page_size ?? 25));
  if (args.next_token) url.searchParams.set("nextToken", args.next_token);
  if (args.host_id) url.searchParams.append("hostIds[]", args.host_id);
  if (args.time) url.searchParams.set("time", args.time);
  const response = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": env2.UNIFI_API_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
    // Workers supports manual/follow, not the standard Fetch "error" mode.
    // Treat a redirect as an error below so the API key is never forwarded.
    redirect: "manual"
  });
  if (!response.ok) {
    if (response.body) await response.body.cancel();
    // Never return an upstream error body: it may echo request credentials.
    const retry = response.headers.get("Retry-After");
    const safeRetry = retry && /^\d{1,6}$/.test(retry) ? "; retry after " + retry + " seconds" : "";
    throw new Error("UniFi Site Manager returned HTTP " + response.status + safeRetry + ".");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("UniFi returned an empty response.");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("UniFi page exceeds the response limit; request a smaller page_size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("UniFi returned an invalid JSON response."); }
  if (!data || !Array.isArray(data.data)) throw new Error("UniFi response is missing its data array.");
  if (data.nextToken != null && typeof data.nextToken !== "string") throw new Error("UniFi returned an invalid pagination token.");
  if (data.httpStatusCode != null && data.httpStatusCode !== 200) throw new Error("UniFi response reported an unsuccessful status.");
  return data;
}
function registerUnifiTools(server, env2) {
  const paging = {
    page_size: external_exports.number().int().min(1).max(100).optional().default(25).describe("Items per upstream page; device pages contain host groups. Gateway limit: 100."),
    next_token: external_exports.string().min(1).optional().describe("next_token from the preceding response; keep the same page_size and filters."),
    format: formatSchema3
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const outputSchema = {
    source: external_exports.string(), fetched_at: external_exports.string(),
    data: external_exports.array(external_exports.unknown()),
    returned_count: external_exports.number().int(), upstream_page_item_count: external_exports.number().int(),
    device_count: external_exports.number().int().optional(),
    next_token: external_exports.string().nullable(), has_more: external_exports.boolean(), terminal_page: external_exports.boolean(),
    query: external_exports.object({page_size:external_exports.number(),host_id:external_exports.string().nullable(),time:external_exports.string().nullable()}),
    coverage: external_exports.string()
  };
  const definitions = [
    ["unifi_list_hosts", "/v1/hosts", "Read one page of UniFi consoles/hosts visible to the API key. Continue with next_token until has_more is false.", paging,
      h => ({ id: h.id, name: h.reportedState?.hostname ?? h.reportedState?.name ?? h.hostname ?? null, type: h.type ?? null, ip_address: h.ipAddress ?? null, state: h.reportedState?.state ?? null, last_connection_state_change: h.lastConnectionStateChange ?? null })],
    ["unifi_list_sites", "/v1/sites", "Read one page of UniFi sites and site health. Continue with next_token until has_more is false.", paging,
      s => ({ id: s.siteId, name: s.meta?.desc ?? s.meta?.name ?? null, host_id: s.hostId, time_zone: s.meta?.timezone ?? null, counts: s.statistics?.counts ?? null, wan_uptime: s.statistics?.percentages?.wanUptime ?? null, internet_issues: s.statistics?.internetIssues ?? null })],
    ["unifi_list_devices", "/v1/devices", "Read one page of device host groups. Summary flattens nested devices while preserving host IDs. Continue with next_token until has_more is false.", {
      ...paging,
      host_id: external_exports.string().min(1).optional().describe("Optional host ID from unifi_list_hosts; sent as hostIds[]."),
      time: external_exports.string().datetime({ offset: true }).optional().describe("Optional RFC3339 last-processed timestamp; preserve while paginating.")
    }, null]
  ];
  for (const [name, path, description, inputSchema, summarize] of definitions) {
    server.registerTool(name, { title: name.replace(/^unifi_/, "UniFi ").replace(/_/g, " "), description, inputSchema, outputSchema, annotations }, async (args) => {
      try {
        const result = await unifiFetch(env2, path, args);
        const groups = result.data;
        if (!groups.every(item => item && typeof item === "object" && !Array.isArray(item))) throw new Error("UniFi returned an invalid item.");
        const isDevices = path === "/v1/devices";
        if (isDevices && !groups.every(group => Array.isArray(group.devices) && group.devices.every(d => d && typeof d === "object" && !Array.isArray(d)))) throw new Error("UniFi device response is missing its nested devices array.");
        const data = args.format === "full" ? groups : isDevices ? groups.flatMap(group => group.devices.map(d => ({
          id: d.id, mac: d.mac, name: d.name ?? null, model: d.model ?? d.shortname ?? null,
          status: d.status ?? null, ip: d.ip ?? null, version: d.version ?? null,
          product_line: d.productLine ?? null, host_id: group.hostId, host_name: group.hostName ?? null,
          source_updated_at: group.updatedAt ?? null
        }))) : groups.map(summarize);
        const next = result.nextToken || null;
        const output = {
          source: "UniFi Site Manager v1", fetched_at: new Date().toISOString(),
          data, returned_count: data.length, upstream_page_item_count: groups.length,
          ...(isDevices ? { device_count: groups.reduce((n, g) => n + g.devices.length, 0) } : {}),
          next_token: next, has_more: next !== null, terminal_page: next === null,
          query: { page_size: args.page_size ?? 25, host_id: args.host_id ?? null, time: args.time ?? null },
          coverage: "One page only. Enumerate from the first page through terminal_page before claiming a complete inventory."
        };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      } catch (err) {
        // Only expose known messages, never arbitrary fetch/provider exception text.
        const message = err instanceof Error && /^(UniFi |UniFi Site Manager )/.test(err.message)
          ? err.message : "UniFi request failed or timed out; retry this read-only request.";
        return { content: [{ type: "text", text: message }], isError: true };
      }
    });
  }
  server.registerTool("unifi_connection_health", {
    title: "UniFi connection health",
    description: "Perform one bounded, read-only UniFi Site Manager hosts request to verify the gateway's stored API key. Returns no host inventory. This checks UniFi access; it does not test other vendors or the employee's Portal login.",
    inputSchema: {}, annotations,
    outputSchema: {service:external_exports.string(),status:external_exports.enum(["healthy","unavailable","not_configured"]),checked_at:external_exports.string(),latency_ms:external_exports.number(),detail:external_exports.string()}
  }, async () => {
    const start = Date.now();
    const output = {service:"UniFi Site Manager",status:"healthy",checked_at:new Date().toISOString(),latency_ms:0,detail:"A live, authenticated read succeeded."};
    try { await unifiFetch(env2,"/v1/hosts",{page_size:1}); }
    catch (err) {
      output.status = env2.UNIFI_API_KEY ? "unavailable" : "not_configured";
      output.detail = err instanceof Error && /^UniFi /.test(err.message) ? err.message : "UniFi request failed or timed out; retry this read-only request.";
    }
    output.latency_ms = Date.now() - start;
    return {content:[{type:"text",text:JSON.stringify(output,null,2)}],structuredContent:output};
  });
}



// src/services/meraki.ts
var MERAKI_BASE = "https://api.meraki.com/api/v1";
async function merakiFetch(env2, path) {
  return fetchJson(`${MERAKI_BASE}${path}`, {
    headers: { "X-Cisco-Meraki-API-Key": env2.MERAKI_API_KEY }
  });
}
__name(merakiFetch, "merakiFetch");
function resolveOrgId(env2, organization_id) {
  const id = organization_id ?? env2.MERAKI_DEFAULT_ORG_ID;
  if (!id) throw new Error("organization_id is required (or set MERAKI_DEFAULT_ORG_ID)");
  return id;
}
__name(resolveOrgId, "resolveOrgId");
var formatSchema4 = external_exports.enum(["summary", "full"]).optional().default("summary");
function registerMerakiTools(server, env2) {
  server.registerTool("meraki_list_organizations", {
    description: "List all Meraki organizations accessible with the API key.",
    inputSchema: { format: formatSchema4 }
  }, async ({ format: format2 }) => {
    try {
      const data = await merakiFetch(env2, "/organizations");
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s2 = data.map((o2) => ({
        id: o2.id,
        name: o2.name,
        url: o2.url
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("meraki_list_networks", {
    description: "List networks in a Meraki organization.",
    inputSchema: {
      organization_id: external_exports.string().optional().describe("Org ID (falls back to MERAKI_DEFAULT_ORG_ID)"),
      format: formatSchema4
    }
  }, async ({ organization_id, format: format2 }) => {
    try {
      const orgId = resolveOrgId(env2, organization_id);
      const data = await merakiFetch(env2, `/organizations/${orgId}/networks`);
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s2 = data.map((n2) => ({
        id: n2.id,
        name: n2.name,
        type: n2.productTypes,
        timezone: n2.timeZone
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("meraki_list_devices", {
    description: "List devices in a Meraki organization.",
    inputSchema: {
      organization_id: external_exports.string().optional().describe("Org ID (falls back to MERAKI_DEFAULT_ORG_ID)"),
      network_id: external_exports.string().optional().describe("Filter by network ID"),
      format: formatSchema4
    }
  }, async ({ organization_id, network_id, format: format2 }) => {
    try {
      const orgId = resolveOrgId(env2, organization_id);
      const path = network_id ? `/networks/${network_id}/devices` : `/organizations/${orgId}/devices`;
      const data = await merakiFetch(env2, path);
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s2 = data.map((d2) => ({
        serial: d2.serial,
        name: d2.name,
        model: d2.model,
        network_id: d2.networkId,
        mac: d2.mac,
        lan_ip: d2.lanIp,
        firmware: d2.firmware
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("meraki_get_device_status", {
    description: "Get the live status of a Meraki device.",
    inputSchema: {
      serial: external_exports.string().describe("Device serial number"),
      format: formatSchema4
    }
  }, async ({ serial, format: format2 }) => {
    try {
      const data = await merakiFetch(env2, `/devices/${serial}/managementInterface`);
      const status = await merakiFetch(env2, `/devices/${serial}/lldpCdp`).catch(() => ({}));
      const combined = { ...data, lldpCdp: status };
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(combined, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("meraki_list_clients", {
    description: "List clients connected to a Meraki network.",
    inputSchema: {
      network_id: external_exports.string().describe("Network ID from meraki_list_networks"),
      timespan: external_exports.number().optional().default(86400).describe("Timespan in seconds to look back (default 86400 = 1 day)"),
      format: formatSchema4
    }
  }, async ({ network_id, timespan, format: format2 }) => {
    try {
      const data = await merakiFetch(env2, `/networks/${network_id}/clients?timespan=${timespan ?? 86400}`);
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s2 = data.map((c) => ({
        id: c.id,
        description: c.description,
        mac: c.mac,
        ip: c.ip,
        vlan: c.vlan,
        ssid: c.ssid,
        status: c.status,
        usage: c.usage
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
}
__name(registerMerakiTools, "registerMerakiTools");


// src/services/sentinelone.ts
async function s1Fetch(env2, path, init = {}) {
  const base = env2.S1_BASE_URL.replace(/\/$/, "");
  return fetchJson(`${base}/web/api/v2.1${path}`, {
    ...init,
    headers: {
      Authorization: `ApiToken ${env2.S1_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}
__name(s1Fetch, "s1Fetch");
var formatSchema5 = external_exports.enum(["summary", "full"]).optional().default("summary").describe('"summary" (default) returns key fields; "full" returns raw JSON.');
function registerSentinelOneTools(server, env2) {
  server.registerTool("s1_list_agents", {
    description: "List SentinelOne agents (endpoints), with optional filters.",
    inputSchema: {
      computer_name: external_exports.string().optional().describe("Filter by partial hostname"),
      site_ids: external_exports.string().optional().describe("Comma-separated site IDs to filter"),
      network_status: external_exports.enum(["connected", "disconnected", "not_applicable", "connecting", "disconnecting"]).optional().describe("Filter by network status"),
      is_active: external_exports.boolean().optional().describe("Filter by active status"),
      limit: external_exports.number().optional().default(50).describe("Max results (default 50)"),
      format: formatSchema5
    }
  }, async ({ computer_name, site_ids, network_status, is_active, limit, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ limit: String(limit ?? 50) });
      if (computer_name) qs.set("computerName__like", computer_name);
      if (site_ids) qs.set("siteIds", site_ids);
      if (network_status) qs.set("networkStatuses", network_status);
      if (is_active !== void 0) qs.set("isActive", String(is_active));
      const data = await s1Fetch(env2, `/agents?${qs}`);
      const agents = data.data ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
      }
      const s2 = agents.map((a2) => ({
        id: a2.id,
        computer_name: a2.computerName,
        os: a2.osName,
        version: a2.agentVersion,
        network_status: a2.networkStatus,
        last_active: a2.lastActiveDate,
        is_active: a2.isActive,
        site_name: a2.siteName,
        threat_count: a2.activeThreats
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_get_agent", {
    description: "Get details for a specific SentinelOne agent by ID.",
    inputSchema: {
      agent_id: external_exports.string().describe("Agent ID from s1_list_agents"),
      format: formatSchema5
    }
  }, async ({ agent_id, format: format2 }) => {
    try {
      const data = await s1Fetch(env2, `/agents?ids=${agent_id}`);
      const agent = (data.data ?? [])[0];
      if (!agent) return { content: [{ type: "text", text: `Agent ${agent_id} not found.` }] };
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
      }
      const s2 = {
        id: agent.id,
        computer_name: agent.computerName,
        os: agent.osName,
        version: agent.agentVersion,
        network_status: agent.networkStatus,
        last_active: agent.lastActiveDate,
        is_active: agent.isActive,
        site_name: agent.siteName,
        group_name: agent.groupName,
        threat_count: agent.activeThreats,
        uuid: agent.uuid,
        external_ip: agent.externalIp,
        internal_ip: agent?.networkInterfaces?.[0]?.inet?.[0]
      };
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_list_threats", {
    description: "List SentinelOne threats with optional filters.",
    inputSchema: {
      site_ids: external_exports.string().optional().describe("Comma-separated site IDs"),
      agent_id: external_exports.string().optional().describe("Filter by agent ID"),
      resolved: external_exports.boolean().optional().describe("Filter by resolved status"),
      confidence_levels: external_exports.string().optional().describe('Comma-separated confidence levels: "malicious", "suspicious", "n/a"'),
      analyst_verdict: external_exports.enum(["true_positive", "false_positive", "suspicious", "undefined"]).optional(),
      limit: external_exports.number().optional().default(50),
      format: formatSchema5
    }
  }, async ({ site_ids, agent_id, resolved, confidence_levels, analyst_verdict, limit, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ limit: String(limit ?? 50) });
      if (site_ids) qs.set("siteIds", site_ids);
      if (agent_id) qs.set("agentId", agent_id);
      if (resolved !== void 0) qs.set("resolved", String(resolved));
      if (confidence_levels) qs.set("confidenceLevels", confidence_levels);
      if (analyst_verdict) qs.set("analystVerdicts", analyst_verdict);
      const data = await s1Fetch(env2, `/threats?${qs}`);
      const threats = data.data ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(threats, null, 2) }] };
      }
      const s2 = threats.map((t2) => {
        const info = t2.threatInfo ?? t2;
        return {
          id: t2.id,
          threat_name: info.threatName,
          confidence: info.confidenceLevel,
          verdict: info.analystVerdict,
          status: info.incidentStatus,
          agent: info.agentComputerName,
          file_path: info.filePath,
          created_at: info.createdAt,
          resolved: info.resolved,
          mitigated: info.mitigationStatus
        };
      });
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_get_threat", {
    description: "Get details for a specific SentinelOne threat by ID.",
    inputSchema: {
      threat_id: external_exports.string().describe("Threat ID from s1_list_threats"),
      format: formatSchema5
    }
  }, async ({ threat_id, format: format2 }) => {
    try {
      const data = await s1Fetch(env2, `/threats?ids=${threat_id}`);
      const threat = (data.data ?? [])[0];
      if (!threat) return { content: [{ type: "text", text: `Threat ${threat_id} not found.` }] };
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(threat, null, 2) }] };
      }
      const info = threat.threatInfo ?? threat;
      const s2 = {
        id: threat.id,
        threat_name: info.threatName,
        sha1: info.sha1,
        confidence: info.confidenceLevel,
        verdict: info.analystVerdict,
        status: info.incidentStatus,
        agent: info.agentComputerName,
        file_path: info.filePath,
        created_at: info.createdAt,
        resolved: info.resolved,
        mitigation_status: info.mitigationStatus,
        classification: info.classification
      };
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_update_threat_verdict", {
    description: "Update the analyst verdict on a SentinelOne threat (mark as true/false positive, etc.).",
    inputSchema: {
      threat_ids: external_exports.string().describe("Comma-separated threat IDs to update"),
      verdict: external_exports.enum(["true_positive", "false_positive", "suspicious", "undefined"]).describe("New analyst verdict")
    }
  }, async ({ threat_ids, verdict }) => {
    try {
      const ids = threat_ids.split(",").map((s2) => s2.trim());
      await s1Fetch(env2, "/threats/analyst-verdict", {
        method: "POST",
        body: JSON.stringify({
          filter: { ids },
          data: { analystVerdict: verdict }
        })
      });
      return { content: [{ type: "text", text: `Verdict updated to "${verdict}" for threats: ${threat_ids}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_list_sites", {
    description: "List SentinelOne sites in the account.",
    inputSchema: {
      name: external_exports.string().optional().describe("Filter by site name"),
      state: external_exports.enum(["active", "expired", "deleted"]).optional(),
      limit: external_exports.number().optional().default(50),
      format: formatSchema5
    }
  }, async ({ name, state, limit, format: format2 }) => {
    try {
      const qs = new URLSearchParams({ limit: String(limit ?? 50) });
      if (name) qs.set("name", name);
      if (state) qs.set("state", state);
      const data = await s1Fetch(env2, `/sites?${qs}`);
      const sites = data.data?.sites ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      }
      const s2 = sites.map((s3) => ({
        id: s3.id,
        name: s3.name,
        state: s3.state,
        account_name: s3.accountName,
        total_licenses: s3.totalLicenses,
        active_agents: s3.activeLicenses
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_list_activities", {
    description: "List recent SentinelOne activity log entries.",
    inputSchema: {
      site_ids: external_exports.string().optional().describe("Comma-separated site IDs"),
      agent_ids: external_exports.string().optional().describe("Comma-separated agent IDs"),
      activity_types: external_exports.string().optional().describe("Comma-separated activity type IDs"),
      limit: external_exports.number().optional().default(50),
      format: formatSchema5
    }
  }, async ({ site_ids, agent_ids, activity_types, limit, format: format2 }) => {
    try {
      const qs = new URLSearchParams({
        limit: String(limit ?? 50),
        sortBy: "createdAt",
        sortOrder: "desc"
      });
      if (site_ids) qs.set("siteIds", site_ids);
      if (agent_ids) qs.set("agentIds", agent_ids);
      if (activity_types) qs.set("activityTypes", activity_types);
      const data = await s1Fetch(env2, `/activities?${qs}`);
      const activities = data.data ?? [];
      if (format2 === "full" /* Full */) {
        return { content: [{ type: "text", text: JSON.stringify(activities, null, 2) }] };
      }
      const s2 = activities.map((a2) => ({
        id: a2.id,
        type: a2.activityType,
        description: a2.description ?? a2.primaryDescription,
        agent: a2.agentUpdatedVersion ?? a2.data?.computerName,
        user: a2.userId,
        created_at: a2.createdAt,
        site_id: a2.siteId
      }));
      return { content: [{ type: "text", text: JSON.stringify(s2, null, 2) }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
  server.registerTool("s1_isolate_agent", {
    description: "Network-isolate a SentinelOne agent (disconnect it from the network while keeping S1 communication). Use with caution \u2014 this immediately cuts the endpoint off.",
    inputSchema: {
      agent_ids: external_exports.string().describe("Comma-separated agent IDs to isolate")
    }
  }, async ({ agent_ids }) => {
    try {
      const ids = agent_ids.split(",").map((s2) => s2.trim());
      await s1Fetch(env2, "/agents/actions/disconnect", {
        method: "POST",
        body: JSON.stringify({ filter: { ids } })
      });
      return { content: [{ type: "text", text: `Isolation command sent to agents: ${agent_ids}` }] };
    } catch (e2) {
      return { content: [{ type: "text", text: formatError2(e2) }], isError: true };
    }
  });
}
__name(registerSentinelOneTools, "registerSentinelOneTools");


// src/server.ts
function buildMcpServer(env2) {
  const server = new McpServer({
    name: "impact360-mcp-gateway",
    version: "1.0.0"
  });
  if (isHaloConfigured(env2)) {
    registerHaloTools(server, env2);
    console.log("[gateway] HaloPSA tools registered (20 tools)");
  }
  if (isNableConfigured(env2)) {
    registerNableTools(server, env2);
    console.log("[gateway] N-able N-central tools registered (6 tools)");
  }
  if (isUnifiConfigured(env2)) {
    registerUnifiTools(server, env2);
    registerExpandedUnifiTools(server, env2);
    console.log("[gateway] UniFi Site Manager tools registered (3 tools)");
  }
  if (isMerakiConfigured(env2)) {
    registerMerakiTools(server, env2);
    console.log("[gateway] Meraki Dashboard tools registered (5 tools)");
  }
  if (isSentinelOneConfigured(env2)) {
    registerSentinelOneTools(server, env2);
    console.log("[gateway] SentinelOne tools registered (8 tools)");
  }
  return server;
}
__name(buildMcpServer, "buildMcpServer");


// src/index.ts
async function verifyCfAccessJwt(env2, token) {
  try {
    const certsUrl = `https://${env2.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
    const res = await fetch(certsUrl);
    if (!res.ok) return false;
    const { keys } = await res.json();
    for (const jwk of keys) {
      try {
        const key = await importJWK(jwk, "RS256");
        await jwtVerify(token, key, { audience: env2.CF_ACCESS_AUD });
        return true;
      } catch {
      }
    }
    return false;
  } catch {
    return false;
  }
}
__name(verifyCfAccessJwt, "verifyCfAccessJwt");
async function isAuthorized(request, env2) {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === env2.MCP_ACCESS_TOKEN) return true;
  }
  if (isCfAccessConfigured(env2)) {
    const cfJwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (cfJwt && await verifyCfAccessJwt(env2, cfJwt)) return true;
  }
  return false;
}
__name(isAuthorized, "isAuthorized");
var index_default = {
  async fetch(request, env2, _ctx) {
    const url2 = new URL(request.url);
    if (url2.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!await isAuthorized(request, env2)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url2.pathname === "/mcp") {
      const mcpServer = buildMcpServer(env2);
      const handleMcp = createMcpHandler(mcpServer, { route: "/mcp" });
      return handleMcp(request, env2, _ctx);
    }
    return new Response("Not Found", { status: 404 });
  }
};

export { buildMcpServer, isAuthorized };
export default index_default;
