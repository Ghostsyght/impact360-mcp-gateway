# Cloud validation and release boundary

Status: source changes prepared; no execution result is implied by this document.

All runtime validation runs in Cloudflare Builds. Set the build command to
`IMPACT360_CLOUD_CHECK=1 npm run check:cloud`. Cloudflare installs the locked npm
dependencies before the build command. Do not put real vendor credentials in the
build environment or commit `.dev.vars`/`.env` files.

## Checks in order

1. Typecheck active typed source. The recovered baseline still uses `@ts-nocheck`;
   extracting typed boundaries does not make every historical adapter typechecked.
2. Original 23 UniFi policy/documentation/SQLite Durable Object scenarios.
3. New bounded-output, discriminator, enum and primitive-array scenarios.
4. New authentication and HTTP scenarios in isolated workerd: spoofed identity,
   wrong issuer/audience/expiry/subject, JWKS caching, redirects, response budgets,
   cancellation and safe command acknowledgments. Outbound vendor calls are mocked.
5. `wrangler deploy --dry-run --outdir dist` to build the actual Worker entrypoint.
6. Complete Worker HTTP tests for bearer authentication, MCP initialization,
   18 UniFi tools, documentation retrieval and delete denial.

There is no MCP listener in this workflow. Test Workers are isolated fixtures
within the Cloudflare build environment, not services on an employee computer.

## Preview versus release

The non-production branch trigger may upload a version using
`npx wrangler versions upload` after the build succeeds. Uploading a version is not
approval to deploy it to serving traffic. Inspect the build log, commit and version
before a release proposal. Preserve Worker bindings and the existing approval
Durable Object class/migration; no delete or storage reset is authorized.

The deployed recovered source differs from `main`. Do not deploy the older `main`
or merge the hardening branch directly into it without reconciling the recovered
feature branch and its validation. Mandatory tests must be applied to both release
and preview workflows before treating CI as a release gate.

## Acceptance beyond automated fixtures

Record an actual employee login and denied-login case, supported client callback,
capability sync, read-only vendor health/inventory, complete paging, credentials
rotation/expiry, and incident recovery. Resolve vendor transport failures before
a teammate pilot. Console compatibility and live writes remain separate controlled
acceptance tests. No passing mock suite proves those behaviors.

Remaining architecture reviews include per-employee approval attribution, resource
serialization across distinct UniFi previews, consistent approval controls for
non-UniFi mutations, rate limits, dependency advisories, observability, retention,
backup/restore and company ownership. Production readiness requires those reviews;
this source patch is not a claim of complete system certification.
