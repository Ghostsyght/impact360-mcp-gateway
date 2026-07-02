/**
 * N-able N-central service — JWT → access-token exchange + 6 tools.
 *
 * Tools:
 *   nable_list_customers, nable_list_sites, nable_list_devices,
 *   nable_get_device, nable_list_device_tasks, nable_run_device_task
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env } from "../env.js";
import { fetchJson, formatError } from "../lib/http.js";
import { ResponseFormat } from "../lib/types.js";

// ── Auth ─────────────────────────────────────────────────────────────────────

interface NableTokenCache {
  token: string;
  expiresAt: number;
}

let nableTokenCache: NableTokenCache | null = null;

async function getNableToken(env: Env): Promise<string> {
  const now = Date.now();
  if (nableTokenCache && nableTokenCache.expiresAt > now + 60_000) {
    return nableTokenCache.token;
  }

  const base = env.NABLE_BASE_URL!.replace(/\/$/, "");
  const data = await fetchJson<{ tokens: { access_token: string; expires_in?: number }[] }>(
    `${base}/api/auth/authenticate-by-jwt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt: env.NABLE_JWT }),
    }
  );

  const token = data.tokens?.[0]?.access_token;
  if (!token) throw new Error("N-central: no access_token returned from JWT exchange");

  const expiresIn = data.tokens[0].expires_in ?? 3600;
  nableTokenCache = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

async function nableFetch<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getNableToken(env);
  const base = env.NABLE_BASE_URL!.replace(/\/$/, "");
  return fetchJson<T>(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

// ── Tool registration ─────────────────────────────────────────────────────────

const formatSchema = z.enum(["summary", "full"]).optional().default("summary");

export function registerNableTools(server: McpServer, env: Env): void {

  server.registerTool("nable_list_customers", {
    description: "List all customers in N-able N-central.",
    inputSchema: { format: formatSchema },
  }, async ({ format }) => {
    try {
      const data = await nableFetch<{ data: unknown[] }>(env, "/api/customers");
      const customers = data.data ?? (data as unknown as unknown[]);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(customers, null, 2) }] };
      }
      const s = (customers as Record<string, unknown>[]).map((c) => ({
        id: c.customerId ?? c.id,
        name: c.customerName ?? c.name,
        type: c.customerType,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("nable_list_sites", {
    description: "List sites for a customer in N-able N-central.",
    inputSchema: {
      customer_id: z.number().describe("Customer ID from nable_list_customers"),
      format: formatSchema,
    },
  }, async ({ customer_id, format }) => {
    try {
      const data = await nableFetch<{ data: unknown[] }>(env, `/api/customers/${customer_id}/sites`);
      const sites = data.data ?? (data as unknown as unknown[]);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      }
      const s = (sites as Record<string, unknown>[]).map((s) => ({
        id: s.siteId ?? s.id,
        name: s.siteName ?? s.name,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("nable_list_devices", {
    description: "List devices, optionally filtered by customer or site.",
    inputSchema: {
      customer_id: z.number().optional().describe("Filter by customer ID"),
      site_id: z.number().optional().describe("Filter by site ID"),
      page_size: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ customer_id, site_id, format, page_size }) => {
    try {
      const qs = new URLSearchParams({ pageSize: String(page_size ?? 50) });
      if (customer_id) qs.set("customerId", String(customer_id));
      if (site_id) qs.set("siteId", String(site_id));

      const data = await nableFetch<{ data: unknown[] }>(env, `/api/devices?${qs}`);
      const devices = data.data ?? (data as unknown as unknown[]);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
      }
      const s = (devices as Record<string, unknown>[]).map((d) => ({
        id: d.deviceId ?? d.id,
        name: d.deviceName ?? d.name ?? d.longName,
        os: d.deviceClass,
        status: d.deviceStatus,
        customer_id: d.customerId,
        site_id: d.siteId,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("nable_get_device", {
    description: "Get details for a specific N-central device.",
    inputSchema: {
      device_id: z.number().describe("Device ID"),
      format: formatSchema,
    },
  }, async ({ device_id, format }) => {
    try {
      const data = await nableFetch<Record<string, unknown>>(env, `/api/devices/${device_id}`);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s = {
        id: data.deviceId ?? data.id,
        name: data.deviceName ?? data.name,
        os: data.deviceClass,
        status: data.deviceStatus,
        ip: data.lastLoggedInUser,
        customer_id: data.customerId,
        site_id: data.siteId,
      };
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("nable_list_device_tasks", {
    description: "List scheduled tasks for an N-central device.",
    inputSchema: {
      device_id: z.number().describe("Device ID"),
      format: formatSchema,
    },
  }, async ({ device_id, format }) => {
    try {
      // Path may vary by N-central version — check /api-explorer if this 404s
      const data = await nableFetch<{ data: unknown[] }>(env, `/api/devices/${device_id}/scheduled-tasks`);
      const tasks = data.data ?? (data as unknown as unknown[]);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
      const s = (tasks as Record<string, unknown>[]).map((t) => ({
        id: t.taskId ?? t.id,
        name: t.taskName ?? t.name,
        status: t.taskStatus ?? t.status,
        next_run: t.nextRunTime,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("nable_run_device_task", {
    description: "Trigger a scheduled task on an N-central device immediately.",
    inputSchema: {
      device_id: z.number().describe("Device ID"),
      task_id: z.number().describe("Task ID from nable_list_device_tasks"),
    },
  }, async ({ device_id, task_id }) => {
    try {
      await nableFetch(env, `/api/devices/${device_id}/scheduled-tasks/${task_id}/run`, {
        method: "POST",
      });
      return { content: [{ type: "text", text: `Task ${task_id} triggered on device ${device_id}.` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });
}
