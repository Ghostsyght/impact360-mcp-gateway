/**
 * Meraki Dashboard service — Bearer auth + 5 tools.
 *
 * Tools:
 *   meraki_list_organizations, meraki_list_networks, meraki_list_devices,
 *   meraki_get_device_status, meraki_list_clients
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env } from "../env.js";
import { fetchJson, formatError } from "../lib/http.js";
import { ResponseFormat } from "../lib/types.js";

const MERAKI_BASE = "https://api.meraki.com/api/v1";

async function merakiFetch<T>(env: Env, path: string): Promise<T> {
  return fetchJson<T>(`${MERAKI_BASE}${path}`, {
    headers: { "X-Cisco-Meraki-API-Key": env.MERAKI_API_KEY! },
  });
}

function resolveOrgId(env: Env, organization_id?: string): string {
  const id = organization_id ?? env.MERAKI_DEFAULT_ORG_ID;
  if (!id) throw new Error("organization_id is required (or set MERAKI_DEFAULT_ORG_ID)");
  return id;
}

const formatSchema = z.enum(["summary", "full"]).optional().default("summary");

export function registerMerakiTools(server: McpServer, env: Env): void {

  server.registerTool("meraki_list_organizations", {
    description: "List all Meraki organizations accessible with the API key.",
    inputSchema: { format: formatSchema },
  }, async ({ format }) => {
    try {
      const data = await merakiFetch<unknown[]>(env, "/organizations");
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s = (data as Record<string, unknown>[]).map((o) => ({
        id: o.id,
        name: o.name,
        url: o.url,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("meraki_list_networks", {
    description: "List networks in a Meraki organization.",
    inputSchema: {
      organization_id: z.string().optional().describe("Org ID (falls back to MERAKI_DEFAULT_ORG_ID)"),
      format: formatSchema,
    },
  }, async ({ organization_id, format }) => {
    try {
      const orgId = resolveOrgId(env, organization_id);
      const data = await merakiFetch<unknown[]>(env, `/organizations/${orgId}/networks`);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s = (data as Record<string, unknown>[]).map((n) => ({
        id: n.id,
        name: n.name,
        type: n.productTypes,
        timezone: n.timeZone,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("meraki_list_devices", {
    description: "List devices in a Meraki organization.",
    inputSchema: {
      organization_id: z.string().optional().describe("Org ID (falls back to MERAKI_DEFAULT_ORG_ID)"),
      network_id: z.string().optional().describe("Filter by network ID"),
      format: formatSchema,
    },
  }, async ({ organization_id, network_id, format }) => {
    try {
      const orgId = resolveOrgId(env, organization_id);
      const path = network_id
        ? `/networks/${network_id}/devices`
        : `/organizations/${orgId}/devices`;
      const data = await merakiFetch<unknown[]>(env, path);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s = (data as Record<string, unknown>[]).map((d) => ({
        serial: d.serial,
        name: d.name,
        model: d.model,
        network_id: d.networkId,
        mac: d.mac,
        lan_ip: d.lanIp,
        firmware: d.firmware,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("meraki_get_device_status", {
    description: "Get the live status of a Meraki device.",
    inputSchema: {
      serial: z.string().describe("Device serial number"),
      format: formatSchema,
    },
  }, async ({ serial, format }) => {
    try {
      const data = await merakiFetch<Record<string, unknown>>(env, `/devices/${serial}/managementInterface`);
      const status = await merakiFetch<Record<string, unknown>>(env, `/devices/${serial}/lldpCdp`).catch(() => ({}));
      const combined = { ...data, lldpCdp: status };
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(combined, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("meraki_list_clients", {
    description: "List clients connected to a Meraki network.",
    inputSchema: {
      network_id: z.string().describe("Network ID from meraki_list_networks"),
      timespan: z.number().optional().default(86400).describe("Timespan in seconds to look back (default 86400 = 1 day)"),
      format: formatSchema,
    },
  }, async ({ network_id, timespan, format }) => {
    try {
      const data = await merakiFetch<unknown[]>(env, `/networks/${network_id}/clients?timespan=${timespan ?? 86400}`);
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      const s = (data as Record<string, unknown>[]).map((c) => ({
        id: c.id,
        description: c.description,
        mac: c.mac,
        ip: c.ip,
        vlan: c.vlan,
        ssid: c.ssid,
        status: c.status,
        usage: c.usage,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });
}
