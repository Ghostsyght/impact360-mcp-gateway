export interface Env {
  // Gateway auth
  MCP_ACCESS_TOKEN: string;

  // Cloudflare Access (optional)
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;

  // HaloPSA
  HALO_AUTH_URL?: string;
  HALO_RESOURCE_URL?: string;
  HALO_TENANT?: string;
  HALO_CLIENT_ID?: string;
  HALO_CLIENT_SECRET?: string;
  HALO_SCOPE?: string;

  // N-able N-central
  NABLE_BASE_URL?: string;
  NABLE_JWT?: string;

  // UniFi Site Manager
  UNIFI_API_KEY?: string;

  // Meraki Dashboard
  MERAKI_API_KEY?: string;
  MERAKI_DEFAULT_ORG_ID?: string;
}

export function isHaloConfigured(env: Env): boolean {
  return !!(
    env.HALO_AUTH_URL &&
    env.HALO_RESOURCE_URL &&
    env.HALO_CLIENT_ID &&
    env.HALO_CLIENT_SECRET
  );
}

export function isNableConfigured(env: Env): boolean {
  return !!(env.NABLE_BASE_URL && env.NABLE_JWT);
}

export function isUnifiConfigured(env: Env): boolean {
  return !!env.UNIFI_API_KEY;
}

export function isMerakiConfigured(env: Env): boolean {
  return !!env.MERAKI_API_KEY;
}

export function isCfAccessConfigured(env: Env): boolean {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}
