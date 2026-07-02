/**
 * UniFi Site Manager service — API-key auth + 3 read-only tools.
 *
 * Tools:
 *   unifi_list_hosts, unifi_list_sites, unifi_list_devices
 *
 * Note: The UniFi Site Manager API is currently read-only. No write/control
 * endpoints exist in the official API yet.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env } from "../env.js";
import { fetchJson, formatError } from "../lib/http.js";
import { ResponseFormat } from "../lib/types.js";

const UNIFI_BASE = "https://api.ui.com";

async function unifiFetch<T>(env: Env, path: string): Promise<T> {
  return fetchJson<T>(`${UNIFI_BASE}${path}`, {
    headers: { "X-API-Key": env.UNIFI_API_KEY! },
  });
}

const formatSchema = z.enum(["summary", "full"]).optional().default("summary");

export function registerUnifiTools(server: McpServer, env: Env): void {

  server.registerTool("unifi_list_hosts", {
    description: "List all UniFi hosts (consoles/gateways) visible to your API key.",
    inputSchema: { format: formatSchema },
  }, async ({ format }) => {
    try {
      const data = await unifiFetch<{ data: unknown[] }>(env, "/ea/hosts");
      const hosts = data.data ?? [];
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(hosts, null, 2) }] };
      }
      const s = (hosts as Record<string, unknown>[]).map((h) => ({
        id: h.id,
        name: h.hostname ?? h.reportedState,
        type: (h as any).hardwareId ?? (h as any).type,
        firmware: (h as any).firmwareStatus,
        ip_address: (h as any).ipAddress,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("unifi_list_sites", {
    description: "List all UniFi sites across all hosts.",
    inputSchema: { format: formatSchema },
  }, async ({ format }) => {
    try {
      const data = await unifiFetch<{ data: unknown[] }>(env, "/ea/sites");
      const sites = data.data ?? [];
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      }
      const s = (sites as Record<string, unknown>[]).map((s) => ({
        id: s.siteId ?? s.id,
        name: s.siteName ?? s.name,
        host_id: (s as any).hostId,
        time_zone: (s as any).timezone,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("unifi_list_devices", {
    description: "List all UniFi network devices across all sites.",
    inputSchema: {
      host_id: z.string().optional().describe("Filter by host ID from unifi_list_hosts"),
      format: formatSchema,
    },
  }, async ({ host_id, format }) => {
    try {
      const qs = host_id ? `?hostId=${encodeURIComponent(host_id)}` : "";
      const data = await unifiFetch<{ data: unknown[] }>(env, `/ea/devices${qs}`);
      const devices = data.data ?? [];
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
      }
      const s = (devices as Record<string, unknown>[]).map((d) => ({
        id: d.id ?? d.deviceId,
        mac: d.mac,
        name: (d as any).name ?? (d as any).hostname,
        model: (d as any).model,
        status: (d as any).status,
        ip: (d as any).ip,
        site_id: (d as any).siteId,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });
}
