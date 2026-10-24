// Intended for the Cloudflare Workers Builds environment. Never starts an MCP listener.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (!process.env.CF_PAGES && !process.env.WORKERS_CI && process.env.IMPACT360_CLOUD_CHECK !== "1") {
  throw new Error("Run this check in Cloudflare Builds with IMPACT360_CLOUD_CHECK=1. Local runtime testing is disabled for this workflow.");
}
if (existsSync(resolve(".dev.vars")) || existsSync(resolve(".env"))) {
  throw new Error("Cloud validation must not load local credential files.");
}
const run = async (file, args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [file, ...args], {
    stdio: "inherit", shell: false,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolveRun() : reject(new Error(`Cloud check failed: ${file} (exit ${code})`)));
});

await run("node_modules/typescript/bin/tsc", ["--noEmit"]);
await run("tests/unifi.test.mjs", []);
await run("tests/unifi-hardening.test.mjs", []);
await run("tests/gateway-hardening.test.mjs", []);
await run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--dry-run", "--outdir", "dist"]);
await run("tests/worker.test.mjs", []);
console.log(JSON.stringify({cloud_validation:"passed",live_vendor_requests:0,production_deployments:0}));
