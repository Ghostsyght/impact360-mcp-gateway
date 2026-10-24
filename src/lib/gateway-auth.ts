import { createRemoteJWKSet, jwtVerify } from "jose";

export interface GatewayAuthEnv {
  MCP_ACCESS_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

export interface GatewayPrincipal {
  kind: "service_connection" | "access_identity";
  id: string;
}

// Public signing keys may be reused across requests; employee claims are never cached.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const encoder = new TextEncoder();

function accessIssuer(team: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/i.test(team)) return null;
  return `https://${team.toLowerCase()}`;
}

async function tokenId(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Verifies the configured service credential or an actual signed Access identity.
 * Portal bearer authentication establishes a service connection, never an employee.
 */
export async function authenticateGateway(request: Request, env: GatewayAuthEnv): Promise<GatewayPrincipal | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  const expected = env.MCP_ACCESS_TOKEN;
  if (expected && expected.length <= 4096 && authorization.startsWith("Bearer ")) {
    const supplied = authorization.slice(7);
    const left = encoder.encode(supplied);
    const right = encoder.encode(expected);
    if (left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right)) {
      return { kind: "service_connection", id: await tokenId(expected) };
    }
  }

  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  const issuer = env.CF_ACCESS_TEAM_DOMAIN ? accessIssuer(env.CF_ACCESS_TEAM_DOMAIN) : null;
  if (!issuer || !env.CF_ACCESS_AUD || !assertion || assertion.length > 16384) return null;
  try {
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
      });
      // Configuration normally has one issuer; bound cache size if an isolate is reused.
      if (keySets.size >= 4) keySets.clear();
      keySets.set(issuer, keys);
    }
    const { payload } = await jwtVerify(assertion, keys, {
      issuer, audience: env.CF_ACCESS_AUD, algorithms: ["RS256"],
      requiredClaims: ["sub", "exp"], clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { kind: "access_identity", id: `${issuer}:${payload.sub}` };
  } catch {
    // Never return JWTs, signing-key responses, or verification internals to a client.
    return null;
  }
}
