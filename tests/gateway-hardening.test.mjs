// Run in Cloudflare Builds. This is an isolated workerd test, not a vendor request.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { MockAgent } from "undici";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { fileURLToPath } from "node:url";

const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "cloud-test", alg: "RS256", use: "sig" };
const issuer = "https://test-team.cloudflareaccess.com";
const compiled = await build({
  stdin: { contents: `
    import { authenticateGateway } from "./src/lib/gateway-auth.ts";
    import { fetchJson, formatError } from "./src/lib/http.ts";
    export default { async fetch(req, env) {
      const path = new URL(req.url).pathname;
      if (path === "/auth") {
        const principal = await authenticateGateway(req, env);
        return Response.json(principal ?? {error:"Unauthorized"}, {status:principal?200:401});
      }
      try {
        const data = await fetchJson(path === "/insecure" ? "http://vendor.example/v1/data" : "https://vendor.example/v1/data", {
          method: path === "/write" || path === "/ack" ? "POST" : "GET",
          ...(path === "/ack" ? {responseMode:"acknowledgement"} : {}),
          ...(path === "/cancelled" ? {signal:AbortSignal.abort()} : {}),
          headers:{Authorization:"Bearer never-return-this-secret"}
        });
        return Response.json({data});
      } catch(error) { return Response.json({error:formatError(error)}, {status:502}); }
    }};`, resolveDir: fileURLToPath(new URL("..", import.meta.url)), sourcefile: "cloud-test-entry.ts" },
  bundle: true, platform: "neutral", format: "esm", write: false,
  conditions: ["workerd", "worker", "browser"], external: ["cloudflare:workers"],
});
const mocks = new MockAgent();
mocks.disableNetConnect();
const mf = new Miniflare({
  modules: true, script: compiled.outputFiles[0].text,
  compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"],
  bindings: { MCP_ACCESS_TOKEN: "test-bearer", CF_ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com", CF_ACCESS_AUD: "expected-audience" },
  fetchMock: mocks,
});
mocks.get(issuer).intercept({path:"/cdn-cgi/access/certs",method:"GET"})
  .reply(200, JSON.stringify({keys:[jwk]}), {headers:{"Content-Type":"application/json"}}).times(1);
const sign = async (claims = {}) => new SignJWT({sub:"employee-a", ...claims})
  .setProtectedHeader({alg:"RS256",kid:"cloud-test"}).setIssuer(issuer)
  .setAudience("expected-audience").setIssuedAt().setExpirationTime("5m").sign(privateKey);
const request = (path, headers = {}) => mf.dispatchFetch(`https://test.invalid${path}`, {headers});
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
const reply = (status, body, options = {}, method = "GET") => mocks.get("https://vendor.example")
  .intercept({path:"/v1/data",method}).reply(status,body,options);
try {
  await test("absent credentials and spoofed employee headers are denied",async()=>{
    assert.equal((await request("/auth",{"X-Forwarded-User-Agent":"boss@example.invalid"})).status,401);
    assert.equal((await request("/auth",{Authorization:"Bearer "})).status,401);
    assert.equal((await request("/auth",{Authorization:"Bearer test-bearer-wrong"})).status,401);
  });
  await test("service bearer establishes a connection, never an employee",async()=>{
    const r=await request("/auth",{Authorization:"Bearer test-bearer"}); assert.equal(r.status,200);
    const principal=await r.json();assert.equal(principal.kind,"service_connection");
    assert.match(principal.id,/^[a-f0-9]{64}$/);assert(!JSON.stringify(principal).includes("test-bearer"));
  });
  await test("signed Access JWT verifies and signing keys are reused",async()=>{
    const token=await sign();
    for(let i=0;i<2;i++){
      const r=await request("/auth",{"Cf-Access-Jwt-Assertion":token});assert.equal(r.status,200);
      assert.deepEqual(await r.json(),{kind:"access_identity",id:issuer+":employee-a"});
    }
  });
  await test("wrong issuer, audience, missing subject and expired Access JWTs are denied",async()=>{
    const base=()=>new SignJWT({sub:"employee-a"}).setProtectedHeader({alg:"RS256",kid:"cloud-test"}).setIssuedAt();
    const tokens=[
      await base().setIssuer("https://other-team.cloudflareaccess.com").setAudience("expected-audience").setExpirationTime("5m").sign(privateKey),
      await base().setIssuer(issuer).setAudience("wrong-audience").setExpirationTime("5m").sign(privateKey),
      await new SignJWT({}).setProtectedHeader({alg:"RS256",kid:"cloud-test"}).setIssuer(issuer).setAudience("expected-audience").setExpirationTime("5m").sign(privateKey),
      await base().setIssuer(issuer).setAudience("expected-audience").setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey),
    ];
    for(const token of tokens)assert.equal((await request("/auth",{"Cf-Access-Jwt-Assertion":token})).status,401);
  });
  await test("oversized assertions fail closed without exposing them",async()=>{
    const r=await request("/auth",{"Cf-Access-Jwt-Assertion":"x".repeat(16385)});assert.equal(r.status,401);
    assert.deepEqual(await r.json(),{error:"Unauthorized"});
  });
  await test("JSON response succeeds and empty204 is handled",async()=>{
    reply(200,JSON.stringify({ok:true}));assert.deepEqual(await (await request("/read")).json(),{data:{ok:true}});
    reply(204,"");assert.deepEqual(await (await request("/read")).json(),{data:{}});
  });
  await test("redirects are rejected without forwarding credentials",async()=>{
    reply(302,"never-return-this-secret",{headers:{Location:"https://other.example/collect"}});
    const r=await request("/read");assert.equal(r.status,502);const body=await r.text();
    assert(body.includes("HTTP 302"));assert(!body.includes("never-return-this-secret"));
  });
  await test("upstream errors never include the response body",async()=>{
    reply(429,"private-vendor-body-token");const r=await request("/read");assert.equal(r.status,502);
    const body=await r.text();assert(body.includes("HTTP 429"));assert(!body.includes("private-vendor-body-token"));
  });
  await test("invalid JSON and oversized response fail visibly",async()=>{
    reply(200,"not-json");assert.match((await (await request("/read")).json()).error,/invalid JSON/);
    reply(200,"x".repeat(4*1024*1024+1));assert.match((await (await request("/read")).json()).error,/exceeds 4 MiB/);
  });
  await test("write failure is not automatically retried",async()=>{
    reply(500,"private-write-error",{},"POST");const r=await request("/write");assert.equal(r.status,502);
    const body=await r.text();assert(body.includes("No automatic retries"));assert(!body.includes("private-write-error"));
  });
  await test("successful empty and text command acknowledgments are preserved",async()=>{
    reply(202,"",{},"POST");assert.deepEqual(await (await request("/ack")).json(),{data:{accepted:true,status:202}});
    reply(200,"Command accepted",{},"POST");assert.deepEqual(await (await request("/ack")).json(),{data:{accepted:true,status:200}});
  });
  await test("insecure upstream and cancelled requests are rejected",async()=>{
    assert.match((await (await request("/insecure")).json()).error,/HTTPS/);
    assert.match((await (await request("/cancelled")).json()).error,/cancelled/);
  });
  console.log(JSON.stringify({gateway_hardening:passed,live_vendor_requests:0,live_mutations:0}));
} finally { await mf.dispose(); await mocks.close(); }
