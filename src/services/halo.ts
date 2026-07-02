/**
 * HaloPSA service — OAuth client_credentials + 20 tools.
 *
 * Tools:
 *  Tickets:  halo_list_tickets, halo_get_ticket, halo_create_ticket,
 *            halo_update_ticket, halo_close_ticket
 *  Notes:    halo_list_ticket_notes, halo_add_ticket_note
 *  Clients:  halo_list_clients, halo_get_client, halo_create_client
 *  Sites:    halo_list_sites, halo_get_site
 *  Agents:   halo_list_agents, halo_get_agent
 *  Assets:   halo_list_assets, halo_get_asset, halo_create_asset, halo_update_asset
 *  Reports:  halo_list_reports, halo_run_report
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env } from "../env.js";
import { fetchJson, formatError } from "../lib/http.js";
import { ResponseFormat } from "../lib/types.js";

// ── Auth ─────────────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getHaloToken(env: Env): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.HALO_CLIENT_ID!,
    client_secret: env.HALO_CLIENT_SECRET!,
    scope: env.HALO_SCOPE ?? "all",
  });
  if (env.HALO_TENANT) params.set("tenant", env.HALO_TENANT);

  const data = await fetchJson<{ access_token: string; expires_in: number }>(
    `${env.HALO_AUTH_URL}/token`,
    { method: "POST", body: params, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return tokenCache.token;
}

async function haloFetch<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getHaloToken(env);
  const base = env.HALO_RESOURCE_URL!.replace(/\/$/, "");
  return fetchJson<T>(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

// ── Tool registration ─────────────────────────────────────────────────────────

const formatSchema = z.enum(["summary", "full"]).optional().default("summary").describe(
  'Response verbosity: "summary" (default) returns key fields; "full" returns the raw JSON.'
);

export function registerHaloTools(server: McpServer, env: Env): void {

  // ── Tickets ──────────────────────────────────────────────────────────────

  server.registerTool("halo_list_tickets", {
    description: "List HaloPSA tickets with optional filters.",
    inputSchema: {
      status: z.string().optional().describe("Filter by status name, e.g. 'Open', 'In Progress'"),
      client_id: z.number().optional().describe("Filter by client ID"),
      agent_id: z.number().optional().describe("Filter by assigned agent ID"),
      page_size: z.number().optional().default(50).describe("Max results (default 50)"),
      format: formatSchema,
    },
  }, async ({ status, client_id, agent_id, page_size, format }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (status) qs.set("ticketstatus", status);
      if (client_id) qs.set("client_id", String(client_id));
      if (agent_id) qs.set("agent_id", String(agent_id));

      const data = await haloFetch<{ tickets: unknown[] }>(env, `/Tickets?${qs}`);
      const tickets = data.tickets ?? [];

      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(tickets, null, 2) }] };
      }

      const summary = (tickets as Record<string, unknown>[]).map((t) => ({
        id: t.id, summary: t.summary, status: (t as any).status?.name,
        client: (t as any).client_name, agent: (t as any).agent?.name,
        priority: (t as any).priority?.name, date_occurred: t.dateoccurred,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_get_ticket", {
    description: "Get a single HaloPSA ticket by ID.",
    inputSchema: {
      ticket_id: z.number().describe("The ticket ID"),
      format: formatSchema,
    },
  }, async ({ ticket_id, format }) => {
    try {
      const data = await haloFetch<Record<string, unknown>>(env, `/Tickets/${ticket_id}`);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s = { id: data.id, summary: data.summary, status: (data as any).status?.name,
        client: (data as any).client_name, agent: (data as any).agent?.name,
        description: data.details, date_occurred: data.dateoccurred };
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_create_ticket", {
    description: "Create a new HaloPSA ticket.",
    inputSchema: {
      summary: z.string().describe("Ticket summary / title"),
      details: z.string().optional().describe("Ticket description / body"),
      client_id: z.number().optional().describe("Client ID to associate"),
      agent_id: z.number().optional().describe("Agent ID to assign"),
      priority_id: z.number().optional().describe("Priority ID"),
      tickettype_id: z.number().optional().describe("Ticket type ID"),
    },
  }, async ({ summary, details, client_id, agent_id, priority_id, tickettype_id }) => {
    try {
      const body: Record<string, unknown> = { summary, details };
      if (client_id) body.client_id = client_id;
      if (agent_id) body.agent_id = agent_id;
      if (priority_id) body.priority_id = priority_id;
      if (tickettype_id) body.tickettype_id = tickettype_id;

      const data = await haloFetch<Record<string, unknown>>(env, "/Tickets", {
        method: "POST",
        body: JSON.stringify([body]),
      });
      return { content: [{ type: "text", text: `Ticket created: ${JSON.stringify(data)}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_update_ticket", {
    description: "Update an existing HaloPSA ticket.",
    inputSchema: {
      ticket_id: z.number().describe("The ticket ID to update"),
      summary: z.string().optional(),
      details: z.string().optional(),
      agent_id: z.number().optional(),
      priority_id: z.number().optional(),
      status_id: z.number().optional().describe("Status ID to set"),
    },
  }, async ({ ticket_id, summary, details, agent_id, priority_id, status_id }) => {
    try {
      const body: Record<string, unknown> = { id: ticket_id };
      if (summary) body.summary = summary;
      if (details) body.details = details;
      if (agent_id) body.agent_id = agent_id;
      if (priority_id) body.priority_id = priority_id;
      if (status_id) body.status_id = status_id;

      const data = await haloFetch(env, "/Tickets", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Ticket updated: ${JSON.stringify(data)}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_close_ticket", {
    description: "Close a HaloPSA ticket by setting its status to Closed (status_id 9 by default; override if your instance differs).",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID to close"),
      close_status_id: z.number().optional().default(9).describe("Status ID that represents 'Closed' in your Halo instance (default 9)"),
    },
  }, async ({ ticket_id, close_status_id }) => {
    try {
      await haloFetch(env, "/Tickets", {
        method: "POST",
        body: JSON.stringify([{ id: ticket_id, status_id: close_status_id ?? 9 }]),
      });
      return { content: [{ type: "text", text: `Ticket ${ticket_id} closed.` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Notes ────────────────────────────────────────────────────────────────

  server.registerTool("halo_list_ticket_notes", {
    description: "List notes/actions on a HaloPSA ticket.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID"),
      format: formatSchema,
    },
  }, async ({ ticket_id, format }) => {
    try {
      const data = await haloFetch<{ actions: unknown[] }>(env, `/Actions?ticket_id=${ticket_id}`);
      const notes = data.actions ?? [];
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
      }
      const s = (notes as Record<string, unknown>[]).map((n) => ({
        id: n.id, note: n.note, who: (n as any).who_name, date: n.date,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_add_ticket_note", {
    description: "Add a note/action to a HaloPSA ticket.",
    inputSchema: {
      ticket_id: z.number().describe("Ticket ID"),
      note: z.string().describe("Note body text"),
      outcome: z.string().optional().describe("Outcome / resolution note"),
      send_email: z.boolean().optional().default(false).describe("Email the note to the client"),
    },
  }, async ({ ticket_id, note, outcome, send_email }) => {
    try {
      const body = { ticket_id, note, outcome, sendemail: send_email ?? false };
      const data = await haloFetch(env, "/Actions", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Note added: ${JSON.stringify(data)}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Clients ──────────────────────────────────────────────────────────────

  server.registerTool("halo_list_clients", {
    description: "List HaloPSA clients.",
    inputSchema: {
      search: z.string().optional().describe("Name search string"),
      page_size: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ search, page_size, format }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (search) qs.set("search", search);
      const data = await haloFetch<{ clients: unknown[] }>(env, `/Client?${qs}`);
      const clients = data.clients ?? [];
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
      }
      const s = (clients as Record<string, unknown>[]).map((c) => ({
        id: c.id, name: c.name, email: c.client_contact_email, phone: c.client_telephone,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_get_client", {
    description: "Get a HaloPSA client by ID.",
    inputSchema: { client_id: z.number(), format: formatSchema },
  }, async ({ client_id, format }) => {
    try {
      const data = await haloFetch<Record<string, unknown>>(env, `/Client/${client_id}`);
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      const s = { id: data.id, name: data.name, email: data.client_contact_email, phone: data.client_telephone };
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_create_client", {
    description: "Create a new HaloPSA client.",
    inputSchema: {
      name: z.string().describe("Client name"),
      email: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
    },
  }, async ({ name, email, phone, notes }) => {
    try {
      const body: Record<string, unknown> = { name };
      if (email) body.client_contact_email = email;
      if (phone) body.client_telephone = phone;
      if (notes) body.notes = notes;
      const data = await haloFetch(env, "/Client", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Client created: ${JSON.stringify(data)}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Sites ────────────────────────────────────────────────────────────────

  server.registerTool("halo_list_sites", {
    description: "List HaloPSA sites, optionally filtered by client.",
    inputSchema: {
      client_id: z.number().optional(),
      page_size: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ client_id, page_size, format }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (client_id) qs.set("client_id", String(client_id));
      const data = await haloFetch<{ sites: unknown[] }>(env, `/Site?${qs}`);
      const sites = data.sites ?? [];
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      const s = (sites as Record<string, unknown>[]).map((s) => ({ id: s.id, name: s.name, client_id: s.client_id }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_get_site", {
    description: "Get a HaloPSA site by ID.",
    inputSchema: { site_id: z.number(), format: formatSchema },
  }, async ({ site_id, format }) => {
    try {
      const data = await haloFetch<Record<string, unknown>>(env, `/Site/${site_id}`);
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, name: data.name, client_id: data.client_id, address: data.address }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Agents ───────────────────────────────────────────────────────────────

  server.registerTool("halo_list_agents", {
    description: "List HaloPSA agents (technicians).",
    inputSchema: { page_size: z.number().optional().default(50), format: formatSchema },
  }, async ({ page_size, format }) => {
    try {
      const data = await haloFetch<{ agents: unknown[] }>(env, `/Agent?count=${page_size ?? 50}`);
      const agents = data.agents ?? [];
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
      const s = (agents as Record<string, unknown>[]).map((a) => ({ id: a.id, name: a.name, email: a.email }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_get_agent", {
    description: "Get a HaloPSA agent by ID.",
    inputSchema: { agent_id: z.number(), format: formatSchema },
  }, async ({ agent_id, format }) => {
    try {
      const data = await haloFetch<Record<string, unknown>>(env, `/Agent/${agent_id}`);
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, name: data.name, email: data.email, team: data.team }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Assets ───────────────────────────────────────────────────────────────

  server.registerTool("halo_list_assets", {
    description: "List HaloPSA assets/CIs.",
    inputSchema: {
      client_id: z.number().optional(),
      site_id: z.number().optional(),
      search: z.string().optional(),
      page_size: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ client_id, site_id, search, page_size, format }) => {
    try {
      const qs = new URLSearchParams({ count: String(page_size ?? 50) });
      if (client_id) qs.set("client_id", String(client_id));
      if (site_id) qs.set("site_id", String(site_id));
      if (search) qs.set("search", search);
      const data = await haloFetch<{ assets: unknown[] }>(env, `/Asset?${qs}`);
      const assets = data.assets ?? [];
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(assets, null, 2) }] };
      const s = (assets as Record<string, unknown>[]).map((a) => ({
        id: a.id, name: a.inventory_number, type: (a as any).assettype?.name,
        client: (a as any).client_name, site: (a as any).site?.name,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_get_asset", {
    description: "Get a HaloPSA asset by ID.",
    inputSchema: { asset_id: z.number(), format: formatSchema },
  }, async ({ asset_id, format }) => {
    try {
      const data = await haloFetch<Record<string, unknown>>(env, `/Asset/${asset_id}`);
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, name: data.inventory_number, type: (data as any).assettype?.name, client: (data as any).client_name }, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_create_asset", {
    description: "Create a new HaloPSA asset.",
    inputSchema: {
      inventory_number: z.string().describe("Asset name / inventory number"),
      assettype_id: z.number().optional().describe("Asset type ID"),
      client_id: z.number().optional(),
      site_id: z.number().optional(),
      notes: z.string().optional(),
    },
  }, async ({ inventory_number, assettype_id, client_id, site_id, notes }) => {
    try {
      const body: Record<string, unknown> = { inventory_number };
      if (assettype_id) body.assettype_id = assettype_id;
      if (client_id) body.client_id = client_id;
      if (site_id) body.site_id = site_id;
      if (notes) body.notes = notes;
      const data = await haloFetch(env, "/Asset", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Asset created: ${JSON.stringify(data)}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_update_asset", {
    description: "Update an existing HaloPSA asset.",
    inputSchema: {
      asset_id: z.number(),
      inventory_number: z.string().optional(),
      client_id: z.number().optional(),
      site_id: z.number().optional(),
      notes: z.string().optional(),
    },
  }, async ({ asset_id, inventory_number, client_id, site_id, notes }) => {
    try {
      const body: Record<string, unknown> = { id: asset_id };
      if (inventory_number) body.inventory_number = inventory_number;
      if (client_id) body.client_id = client_id;
      if (site_id) body.site_id = site_id;
      if (notes) body.notes = notes;
      const data = await haloFetch(env, "/Asset", { method: "POST", body: JSON.stringify([body]) });
      return { content: [{ type: "text", text: `Asset updated: ${JSON.stringify(data)}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Reports ──────────────────────────────────────────────────────────────

  server.registerTool("halo_list_reports", {
    description: "List available HaloPSA reports.",
    inputSchema: { format: formatSchema },
  }, async ({ format }) => {
    try {
      const data = await haloFetch<{ reports: unknown[] }>(env, "/Report");
      const reports = data.reports ?? [];
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(reports, null, 2) }] };
      const s = (reports as Record<string, unknown>[]).map((r) => ({ id: r.id, name: r.name }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("halo_run_report", {
    description: "Run a HaloPSA report by ID and return results.",
    inputSchema: {
      report_id: z.number().describe("Report ID from halo_list_reports"),
      format: formatSchema,
    },
  }, async ({ report_id, format }) => {
    try {
      const data = await haloFetch<unknown>(env, `/Report/${report_id}`);
      if (format === ResponseFormat.Full) return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });
}
