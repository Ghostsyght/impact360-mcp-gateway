# Impact 360 MCP gateway

The gateway runs in Cloudflare Workers behind the existing remote MCP portal.
Employees use Microsoft Entra ID (Azure AD) to enter the portal. Vendor credentials
stay in Cloudflare; employees do not need a local server, Python, localhost bridge,
or vendor API keys.

## Teammate connection

1. In a compatible MCP client, add a remote HTTP/OAuth connection using the portal
   URL provided by the administrator. Keep the existing portal URL during testing.
2. Sign in with your own approved company Microsoft account.
3. Complete the client's authorization flow, then check which services are available.
4. Start with a read-only health or inventory request. Report a failed service with
   its name, time and error; do not repeatedly reconnect or supply API secrets.

The client must support the portal's OAuth flow and its callback must be allowed
by the administrator. A successful login or synchronized tool catalog does not
prove that every upstream vendor request works.

## Current execution path

`src/index.ts` authenticates each request once and invokes the recovered vendor
adapters in `src/live-baseline.ts`. The baseline preserves production fixes that
are absent from the older modular `src/server.ts` and service files. Do not rebuild
the live service from those historical files or the checked-in `dist/worker.min.js`.

UniFi currently shares this gateway: four inventory/health tools, ten documentation
tools, plus catalog, read, preview and confirm (18 tools). See
[UNIFI-CLOUDFLARE.md](UNIFI-CLOUDFLARE.md) for deployed-version provenance and
[cloud validation](docs/cloud-validation.md) for the proposed hardening checks.

The portal also mounts dedicated HaloPSA and Meraki backends. Replacing them with
this gateway alone would lose capabilities. Preserve their portal-specific tool
filters, employee sign-in and upstream authentication during changes.

## Authentication and safety

Employee login, upstream backend authentication, and administrator capability sync
are separate operations. With portal `on_behalf=false`, a backend bearer credential
identifies a service connection; it does not prove an individual employee identity.
Signed Cloudflare Access assertions are validated against the configured issuer,
audience, algorithm, subject and expiry when that optional backend path is enabled.

UniFi create/update require an exact preview, explicit confirmation, enabled policy
gates and an expiring single-use approval. Delete and device/client/port actions
remain denied. The existing vendor adapters do not yet provide that same approval
model for every non-UniFi mutation; this remains a release-review requirement.

Network API operations require compatible console firmware, Network version and key
scope. Documentation is a versioned snapshot, not proof of live compatibility.
Endpoint documentation defaults to bounded summaries; retrieve a specific section
or exact field path for detail. Oversized inventory fails explicitly rather than
silently returning partial results.

## Cloud-only development and validation

Source review may take place in this checkout, but application services and runtime
tests belong in Cloudflare. `npm run dev` intentionally refuses to start a local
MCP server. No local credential file is required for cloud validation.

The proposed Cloudflare Builds check is:

```sh
IMPACT360_CLOUD_CHECK=1 npm run check:cloud
```

It checks TypeScript, the original 23 safety tests, new output/schema/authentication
and HTTP tests, a deployment dry run, then complete Worker HTTP tests. The test
fixtures use fake credentials. They do not make live vendor mutations or establish
live employee sign-in and vendor acceptance.

Only upload a preview version after these checks pass. Deploying a version to
production, changing portal routes/policies, moving accounts, sending email, or
enabling ticket automation requires its own reviewed change and approval.

The preserved [legacy setup document](docs/legacy-setup.md) records earlier source
instructions. Its architecture counts, local setup and deployment advice are
historical and must not be used as the current operating procedure.

Primary references: [Cloudflare MCP portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/),
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/),
[Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
