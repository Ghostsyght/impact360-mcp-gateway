/**
 * SentinelOne service — API token auth + 8 tools.
 *
 * Auth header: Authorization: ApiToken <token>
 * Base URL:    https://<your-console>.sentinelone.net/web/api/v2.1
 *
 * Tools:
 *   s1_list_agents          — list/filter endpoints
 *   s1_get_agent            — get a single agent by ID
 *   s1_list_threats         — list threats with optional filters
 *   s1_get_threat           — get a single threat by ID
 *   s1_update_threat_verdict — mark a threat as true/false positive
 *   s1_list_sites           — list sites in the account
 *   s1_list_activities      — recent activity log
 *   s1_isolate_agent        — network-isolate an endpoint
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env } from "../env.js";
import { fetchJson, formatError } from "../lib/http.js";
import { ResponseFormat } from "../lib/types.js";

// ── Client ────────────────────────────────────────────────────────────────────

async function s1Fetch<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const base = env.S1_BASE_URL!.replace(/\/$/, "");
  return fetchJson<T>(`${base}/web/api/v2.1${path}`, {
    ...init,
    headers: {
      Authorization: `ApiToken ${env.S1_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

// ── Tool registration ─────────────────────────────────────────────────────────

const formatSchema = z
  .enum(["summary", "full"])
  .optional()
  .default("summary")
  .describe('"summary" (default) returns key fields; "full" returns raw JSON.');

export function registerSentinelOneTools(server: McpServer, env: Env): void {

  // ── Agents ───────────────────────────────────────────────────────────────

  server.registerTool("s1_list_agents", {
    description: "List SentinelOne agents (endpoints), with optional filters.",
    inputSchema: {
      computer_name: z.string().optional().describe("Filter by partial hostname"),
      site_ids: z.string().optional().describe("Comma-separated site IDs to filter"),
      network_status: z
        .enum(["connected", "disconnected", "not_applicable", "connecting", "disconnecting"])
        .optional()
        .describe("Filter by network status"),
      is_active: z.boolean().optional().describe("Filter by active status"),
      limit: z.number().optional().default(50).describe("Max results (default 50)"),
      format: formatSchema,
    },
  }, async ({ computer_name, site_ids, network_status, is_active, limit, format }) => {
    try {
      const qs = new URLSearchParams({ limit: String(limit ?? 50) });
      if (computer_name) qs.set("computerName__like", computer_name);
      if (site_ids) qs.set("siteIds", site_ids);
      if (network_status) qs.set("networkStatuses", network_status);
      if (is_active !== undefined) qs.set("isActive", String(is_active));

      const data = await s1Fetch<{ data: unknown[] }>(env, `/agents?${qs}`);
      const agents = data.data ?? [];

      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
      }
      const s = (agents as Record<string, unknown>[]).map((a) => ({
        id: a.id,
        computer_name: a.computerName,
        os: a.osName,
        version: a.agentVersion,
        network_status: a.networkStatus,
        last_active: a.lastActiveDate,
        is_active: a.isActive,
        site_name: a.siteName,
        threat_count: a.activeThreats,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("s1_get_agent", {
    description: "Get details for a specific SentinelOne agent by ID.",
    inputSchema: {
      agent_id: z.string().describe("Agent ID from s1_list_agents"),
      format: formatSchema,
    },
  }, async ({ agent_id, format }) => {
    try {
      const data = await s1Fetch<{ data: unknown[] }>(env, `/agents?ids=${agent_id}`);
      const agent = (data.data ?? [])[0] as Record<string, unknown> | undefined;
      if (!agent) return { content: [{ type: "text", text: `Agent ${agent_id} not found.` }] };
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
      }
      const s = {
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
        internal_ip: (agent as any)?.networkInterfaces?.[0]?.inet?.[0],
      };
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Threats ──────────────────────────────────────────────────────────────

  server.registerTool("s1_list_threats", {
    description: "List SentinelOne threats with optional filters.",
    inputSchema: {
      site_ids: z.string().optional().describe("Comma-separated site IDs"),
      agent_id: z.string().optional().describe("Filter by agent ID"),
      resolved: z.boolean().optional().describe("Filter by resolved status"),
      confidence_levels: z
        .string()
        .optional()
        .describe('Comma-separated confidence levels: "malicious", "suspicious", "n/a"'),
      analyst_verdict: z
        .enum(["true_positive", "false_positive", "suspicious", "undefined"])
        .optional(),
      limit: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ site_ids, agent_id, resolved, confidence_levels, analyst_verdict, limit, format }) => {
    try {
      const qs = new URLSearchParams({ limit: String(limit ?? 50) });
      if (site_ids) qs.set("siteIds", site_ids);
      if (agent_id) qs.set("agentId", agent_id);
      if (resolved !== undefined) qs.set("resolved", String(resolved));
      if (confidence_levels) qs.set("confidenceLevels", confidence_levels);
      if (analyst_verdict) qs.set("analystVerdicts", analyst_verdict);

      const data = await s1Fetch<{ data: unknown[] }>(env, `/threats?${qs}`);
      const threats = data.data ?? [];

      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(threats, null, 2) }] };
      }
      const s = (threats as Record<string, unknown>[]).map((t) => {
        const info = (t as any).threatInfo ?? t;
        return {
          id: t.id,
          threat_name: info.threatName,
          confidence: info.confidenceLevel,
          verdict: info.analystVerdict,
          status: info.incidentStatus,
          agent: info.agentComputerName,
          file_path: info.filePath,
          created_at: info.createdAt,
          resolved: info.resolved,
          mitigated: info.mitigationStatus,
        };
      });
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("s1_get_threat", {
    description: "Get details for a specific SentinelOne threat by ID.",
    inputSchema: {
      threat_id: z.string().describe("Threat ID from s1_list_threats"),
      format: formatSchema,
    },
  }, async ({ threat_id, format }) => {
    try {
      const data = await s1Fetch<{ data: unknown[] }>(env, `/threats?ids=${threat_id}`);
      const threat = (data.data ?? [])[0];
      if (!threat) return { content: [{ type: "text", text: `Threat ${threat_id} not found.` }] };
      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(threat, null, 2) }] };
      }
      const info = (threat as any).threatInfo ?? threat;
      const s = {
        id: (threat as any).id,
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
        classification: info.classification,
      };
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  server.registerTool("s1_update_threat_verdict", {
    description: "Update the analyst verdict on a SentinelOne threat (mark as true/false positive, etc.).",
    inputSchema: {
      threat_ids: z.string().describe("Comma-separated threat IDs to update"),
      verdict: z
        .enum(["true_positive", "false_positive", "suspicious", "undefined"])
        .describe("New analyst verdict"),
    },
  }, async ({ threat_ids, verdict }) => {
    try {
      const ids = threat_ids.split(",").map((s) => s.trim());
      await s1Fetch(env, "/threats/analyst-verdict", {
        method: "POST",
        body: JSON.stringify({
          filter: { ids },
          data: { analystVerdict: verdict },
        }),
      });
      return { content: [{ type: "text", text: `Verdict updated to "${verdict}" for threats: ${threat_ids}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Sites ────────────────────────────────────────────────────────────────

  server.registerTool("s1_list_sites", {
    description: "List SentinelOne sites in the account.",
    inputSchema: {
      name: z.string().optional().describe("Filter by site name"),
      state: z.enum(["active", "expired", "deleted"]).optional(),
      limit: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ name, state, limit, format }) => {
    try {
      const qs = new URLSearchParams({ limit: String(limit ?? 50) });
      if (name) qs.set("name", name);
      if (state) qs.set("state", state);

      const data = await s1Fetch<{ data: { sites: unknown[] } }>(env, `/sites?${qs}`);
      const sites = data.data?.sites ?? [];

      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(sites, null, 2) }] };
      }
      const s = (sites as Record<string, unknown>[]).map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        account_name: s.accountName,
        total_licenses: s.totalLicenses,
        active_agents: s.activeLicenses,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Activities ───────────────────────────────────────────────────────────

  server.registerTool("s1_list_activities", {
    description: "List recent SentinelOne activity log entries.",
    inputSchema: {
      site_ids: z.string().optional().describe("Comma-separated site IDs"),
      agent_ids: z.string().optional().describe("Comma-separated agent IDs"),
      activity_types: z.string().optional().describe("Comma-separated activity type IDs"),
      limit: z.number().optional().default(50),
      format: formatSchema,
    },
  }, async ({ site_ids, agent_ids, activity_types, limit, format }) => {
    try {
      const qs = new URLSearchParams({
        limit: String(limit ?? 50),
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      if (site_ids) qs.set("siteIds", site_ids);
      if (agent_ids) qs.set("agentIds", agent_ids);
      if (activity_types) qs.set("activityTypes", activity_types);

      const data = await s1Fetch<{ data: unknown[] }>(env, `/activities?${qs}`);
      const activities = data.data ?? [];

      if (format === ResponseFormat.Full) {
        return { content: [{ type: "text", text: JSON.stringify(activities, null, 2) }] };
      }
      const s = (activities as Record<string, unknown>[]).map((a) => ({
        id: a.id,
        type: a.activityType,
        description: a.description ?? (a as any).primaryDescription,
        agent: (a as any).agentUpdatedVersion ?? (a as any).data?.computerName,
        user: a.userId,
        created_at: a.createdAt,
        site_id: a.siteId,
      }));
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  server.registerTool("s1_isolate_agent", {
    description: "Network-isolate a SentinelOne agent (disconnect it from the network while keeping S1 communication). Use with caution — this immediately cuts the endpoint off.",
    inputSchema: {
      agent_ids: z.string().describe("Comma-separated agent IDs to isolate"),
    },
  }, async ({ agent_ids }) => {
    try {
      const ids = agent_ids.split(",").map((s) => s.trim());
      await s1Fetch(env, "/agents/actions/disconnect", {
        method: "POST",
        body: JSON.stringify({ filter: { ids } }),
      });
      return { content: [{ type: "text", text: `Isolation command sent to agents: ${agent_ids}` }] };
    } catch (e) { return { content: [{ type: "text", text: formatError(e) }], isError: true }; }
  });
}
