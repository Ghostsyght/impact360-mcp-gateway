/**
 * Assembles the McpServer and registers each service's tools
 * if that service's environment variables are present.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Env, isHaloConfigured, isMerakiConfigured, isNableConfigured, isUnifiConfigured } from "./env.js";
import { registerHaloTools } from "./services/halo.js";
import { registerNableTools } from "./services/nable.js";
import { registerUnifiTools } from "./services/unifi.js";
import { registerMerakiTools } from "./services/meraki.js";

export function buildMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: "impact360-mcp-gateway",
    version: "1.0.0",
  });

  if (isHaloConfigured(env)) {
    registerHaloTools(server, env);
    console.log("[gateway] HaloPSA tools registered (20 tools)");
  }

  if (isNableConfigured(env)) {
    registerNableTools(server, env);
    console.log("[gateway] N-able N-central tools registered (6 tools)");
  }

  if (isUnifiConfigured(env)) {
    registerUnifiTools(server, env);
    console.log("[gateway] UniFi Site Manager tools registered (3 tools)");
  }

  if (isMerakiConfigured(env)) {
    registerMerakiTools(server, env);
    console.log("[gateway] Meraki Dashboard tools registered (5 tools)");
  }

  return server;
}
