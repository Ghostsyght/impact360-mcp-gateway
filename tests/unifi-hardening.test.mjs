// Authoring only: run in Cloudflare Builds, never on the employee workstation.
// These are mocked schema/output contract tests; they do not prove live vendor access.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { z } from "zod";

await mkdir("test-build", { recursive: true });
await build({
  entryPoints: ["src/services/unifi-docs.ts", "src/lib/unifi-policy.ts"],
  bundle: true, platform: "node", format: "esm", outdir: "test-build",
  outExtension: { ".js": ".mjs" }, external: ["cloudflare:workers"]
});
const docs = await import(new URL("../test-build/services/unifi-docs.mjs", import.meta.url).href);
const policy = await import(new URL("../test-build/lib/unifi-policy.mjs", import.meta.url).href);
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
class Server {
  tools = new Map();
  registerTool(name, config, fn) { assert(!this.tools.has(name)); this.tools.set(name, { config, fn }); }
}
const server = new Server();
docs.registerDocs(server);
async function call(name, args) {
  const tool = server.tools.get(name);
  return tool.fn(z.object(tool.config.inputSchema).parse(args));
}
const originalFetch = globalThis.fetch;
let outboundRequests = 0;
globalThis.fetch = async () => { outboundRequests++; throw Error("Documentation/schema tests must never fetch a vendor."); };

try {
  await test("compact text fallback preserves the exact structured JSON", () => {
    const response = docs.result({ count: 2, names: ["router", "switch"], note: "é界" });
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
    assert.equal(response.content[0].text, JSON.stringify(response.structuredContent));
    assert(!response.content[0].text.includes("\n"));
    assert(!response.isError);
  });
  await test("result budget counts UTF-8 bytes and never returns partial inventory", () => {
    const tooLarge = { inventory: ["界".repeat(12000)], terminal_page: true };
    assert(JSON.stringify({ data: tooLarge }).length < docs.MAX_RESULT_BYTES);
    const response = docs.result(tooLarge);
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.data.status, "result_too_large");
    assert.equal(response.structuredContent.data.actual_bytes, bytes({ data: tooLarge }));
    assert.equal(response.structuredContent.data.inventory, undefined);
    assert.equal(response.structuredContent.data.terminal_page, undefined);
    assert(bytes(response.structuredContent) <= docs.MAX_RESULT_BYTES);
    assert(Buffer.byteLength(response.content[0].text, "utf8") <= docs.MAX_RESULT_BYTES);
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
  });
  await test("ASCII output accepts the exact cap and rejects the next byte", () => {
    const overhead = bytes({ data: { value: "" } });
    const value = "a".repeat(docs.MAX_RESULT_BYTES - overhead);
    assert(!docs.result({ value }).isError);
    assert.equal(docs.result({ value: value + "a" }).isError, true);
  });
  await test("oversized submitted mutation retains consumed-token state and cannot suggest a retry", () => {
    const response = docs.result({
      status: "submitted", operation: "updatednspolicy", console_id: "test-console",
      parameters: { siteId: "test-site", dnsPolicyId: "test-policy" },
      response: { config: "x".repeat(docs.MAX_RESULT_BYTES) },
      readback: { config: "x".repeat(docs.MAX_RESULT_BYTES) }, readback_available: true
    });
    assert(!response.isError);
    const view = response.structuredContent.data;
    assert.equal(view.status, "submitted");
    assert.equal(view.token_consumed, true);
    assert.equal(view.retry_allowed, false);
    assert.equal(view.operation, "updatednspolicy");
    assert.equal(view.console_id, "test-console");
    assert.deepEqual(view.parameters, { siteId: "test-site", dnsPolicyId: "test-policy" });
    assert.equal(view.details_omitted, true);
    assert.equal(view.response, undefined);
    assert.equal(view.readback, undefined);
    assert.equal(view.readback_available, false);
    assert.match(view.guidance, /Do not retry the mutation/);
    assert.match(view.guidance, /read-only request/);
    assert(bytes(response.structuredContent) <= docs.MAX_RESULT_BYTES);
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
  });
  await test("all existing documentation tools remain registered", () => {
    assert.equal(server.tools.size, 10);
    for (const name of ["unifi_docs_info", "unifi_docs_get_endpoint", "unifi_docs_get_example", "unifi_docs_find_field", "unifi_docs_get_field_schema"]) assert(server.tools.has(name));
  });
  await test("largest snapshot endpoint defaults to an 8 KiB summary without examples or response bodies", async () => {
    const response = await call("unifi_docs_get_endpoint", { endpoint: "network/updatefirewallpolicy" });
    assert(!response.isError);
    assert(bytes(response.structuredContent) <= 8192);
    const view = response.structuredContent.data;
    assert.equal(view.section, "summary");
    assert.equal(view.examples, undefined);
    assert.equal(view.responses, undefined);
    assert.equal(view.responseSample, undefined);
    assert(view.request.total_fields > 0);
    for (const field of view.request.fields) {
      assert.equal(field.children, undefined);
      for (const variant of field.discriminator ?? []) assert.equal(variant.schema, undefined);
    }
  });
  await test("explicit schema detail stays within a caller-selected UTF-8 budget", async () => {
    const response = await call("unifi_docs_get_endpoint", { endpoint: "createwifibroadcast", section: "all", depth: 4, max_bytes: 2048, limit: 50 });
    assert(!response.isError);
    assert(bytes(response.structuredContent) <= 2048);
    assert.equal(response.structuredContent.data.truncated, true);
  });
  await test("schema field pagination retains total and continuation evidence", async () => {
    docs.docMap.set("hardening-pagination", {
      slug: "hardening-pagination", method: "POST", path: "/v1/test",
      requestBody: Array.from({ length: 5 }, (_, index) => ({ name: "field" + index, type: "string" }))
    });
    const response = await call("unifi_docs_get_endpoint", { endpoint: "hardening-pagination", section: "request", offset: 2, limit: 2, depth: 0 });
    const view = response.structuredContent.data;
    assert.deepEqual(view.fields.map(field => field.name), ["field2", "field3"]);
    assert.equal(view.total_fields, 5);
    assert.equal(view.offset, 2);
    assert.equal(view.has_more, true);
  });
  await test("field detail reduces depth explicitly instead of silently truncating JSON", async () => {
    docs.docMap.set("hardening-depth", {
      slug: "hardening-depth", method: "POST", path: "/v1/test",
      requestBody: [{ name: "settings", type: "object", children: Array.from({ length: 20 }, (_, index) => ({ name: "field" + index, type: "string", description: "界".repeat(384) })) }]
    });
    const response = await call("unifi_docs_get_field_schema", { endpoint: "hardening-depth", field_path: "requestBody.settings", depth: 4, max_bytes: 2048 });
    const view = response.structuredContent.data;
    assert(!response.isError);
    assert(bytes(response.structuredContent) <= 2048);
    assert.equal(view.requested_depth, 4);
    assert.equal(view.returned_depth, 0);
    assert.equal(view.truncated, true);
    assert.equal(view.schema.child_count, 20);
    assert.equal(view.schema.children, undefined);
  });
  await test("original field search and exact-path retrieval inputs remain valid", async () => {
    const found = await call("unifi_docs_find_field", { query: "dhcp", endpoint: "createnetwork", limit: 30 });
    assert(!found.isError);
    assert(found.structuredContent.data.length > 0);
    const field = await call("unifi_docs_get_field_schema", { endpoint: "createnetwork", field_path: found.structuredContent.data[0].path });
    assert(!field.isError);
    assert(bytes(field.structuredContent) <= 8192);
  });
  await test("out-of-range detail budgets and depths fail input validation", async () => {
    for (const args of [{ max_bytes: 1023 }, { max_bytes: 16385 }, { depth: 5 }, { depth: -1 }, { limit: 51 }]) {
      await assert.rejects(() => call("unifi_docs_get_endpoint", { endpoint: "createnetwork", ...args }));
    }
  });
  await test("documented enum values are enforced, including optional null", () => {
    const fields = [{ name: "mode", type: "string", enum: ["allow", "deny"] }];
    policy.validateFields(fields, { mode: "allow" });
    for (const mode of ["drop", null, 1]) assert.throws(() => policy.validateFields(fields, { mode }), /enum/);
    assert.throws(() => policy.validateFields([{ name: "mode", type: "string", enum: [] }], { mode: "allow" }), /Unsupported documented enum/);
  });
  await test("primitive array elements enforce string, finite number, safe integer and boolean types", () => {
    const fields = [
      { name: "names", type: "Array of string" }, { name: "rates", type: "Array of number" },
      { name: "ports", type: "Array of integer" }, { name: "flags", type: "Array of boolean" }
    ];
    policy.validateFields(fields, { names: ["uplink"], rates: [1, 2.5], ports: [443], flags: [true] });
    for (const value of [{ names: [42] }, { rates: ["1"] }, { rates: [Infinity] }, { rates: [NaN] }, { ports: [1.5] }, { ports: [Number.MAX_SAFE_INTEGER + 1] }, { flags: ["true"] }, { names: [null] }]) {
      assert.throws(() => policy.validateFields(fields, value));
    }
  });
  await test("nested object-array enums and primitive arrays fail at the exact item path", () => {
    const fields = [{ name: "rules", type: "Array of object (Rule)", children: [
      { name: "mode", type: "string", required: true, enum: ["allow"] }, { name: "ports", type: "Array of integer" }
    ] }];
    policy.validateFields(fields, { rules: [{ mode: "allow", ports: [443] }] });
    assert.throws(() => policy.validateFields(fields, { rules: [{ mode: "deny" }] }), /body\.rules\[0\]\.mode/);
    assert.throws(() => policy.validateFields(fields, { rules: [{ mode: "allow", ports: ["443"] }] }), /body\.rules\[0\]\.ports\[0\]/);
    assert.throws(() => policy.validateFields(fields, { rules: [{ mode: "allow", unexpected: true }] }), /Unknown body\.rules\[0\] field/);
  });
  await test("unsupported nested constraints and unknown array types fail closed", () => {
    const fields = [{ name: "settings", type: "object", children: [{ name: "value", type: "string", pattern: "^[a-z]+$" }] }];
    assert.throws(() => policy.validateFields(fields, { settings: { value: "abc" } }), /Unsupported documented constraint pattern at body\.settings\.value/);
    assert.throws(() => policy.validateFields([{ name: "values", type: "Array of mystery" }], { values: [] }), /Unsupported documented type/);
    assert.throws(() => policy.validateFields([{ name: "values", type: "array" }], { values: [] }), /Unsupported array item schema/);
  });
  await test("only the selected discriminator variant permits its specific fields", async () => {
    const doc = JSON.parse(await readFile("src/data/unifi/network/creatednspolicy.json", "utf8"));
    const body = { enabled: true, type: "A_RECORD", domain: "example.invalid", ipv4Address: "192.0.2.2" };
    policy.validateFields(doc.requestBody, body);
    assert.throws(() => policy.validateFields(doc.requestBody, { ...body, ipv6Address: "2001:db8::1" }), /Unknown body field: ipv6Address/);
  });
  await test("documentation and validation never issue vendor requests", () => assert.equal(outboundRequests, 0));
} finally {
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({ passed, live_vendor_requests: 0, live_mutations: 0, execution_scope: "Cloudflare Builds only" }));
