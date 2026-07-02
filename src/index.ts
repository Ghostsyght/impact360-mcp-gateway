/**
 * Cloudflare Worker entry point.
 *
 * Auth strategy (two independent paths — either satisfies the gate):
 *   1. Static bearer token: Authorization: Bearer <MCP_ACCESS_TOKEN>
 *   2. Cloudflare Access JWT assertion: Cf-Access-Jwt-Assertion header
 *      (only active when CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set)
 *
 * Routes:
 *   GET  /healthz  → 200 OK (no auth required)
 *   POST /mcp      → MCP handler (auth required)
 *   GET  /mcp      → MCP SSE / upgrade (auth required)
 */

import { createMcpHandler } from "agents/mcp";
import { importJWK, jwtVerify } from "jose";
import { Env, isCfAccessConfigured } from "./env.js";
import { buildMcpServer } from "./server.js";

// ── Cloudflare Access JWT verification ──────────────────────────────────────

async function verifyCfAccessJwt(env: Env, token: string): Promise<boolean> {
  try {
    const certsUrl = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
    const res = await fetch(certsUrl);
    if (!res.ok) return false;

    const { keys } = await res.json<{ keys: JsonWebKey[] }>();

    for (const jwk of keys) {
      try {
        const key = await importJWK(jwk as Parameters<typeof importJWK>[0], "RS256");
        await jwtVerify(token, key, { audience: env.CF_ACCESS_AUD });
        return true;
      } catch {
        // Try next key
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ── Auth gate ────────────────────────────────────────────────────────────────

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  // Path 1: static bearer token
  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === env.MCP_ACCESS_TOKEN) return true;
  }

  // Path 2: Cloudflare Access JWT
  if (isCfAccessConfigured(env)) {
    const cfJwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (cfJwt && (await verifyCfAccessJwt(env, cfJwt))) return true;
  }

  return false;
}

// ── Worker fetch ─────────────────────────────────────────────────────────────
// createMcpHandler takes a pre-built McpServer, so we build one per request
// (stateless — no Durable Objects required, works on the free Workers plan).

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check (no auth)
    if (url.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Auth gate for all other routes
    if (!(await isAuthorized(request, env))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // MCP endpoint — fresh server per request (stateless)
    if (url.pathname === "/mcp") {
      const mcpServer = buildMcpServer(env);
      const handleMcp = createMcpHandler(mcpServer, { route: "/mcp" });
      return handleMcp(request, env, _ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
