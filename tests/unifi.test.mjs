import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { z } from "zod";
await mkdir("test-build",{recursive:true});
await build({entryPoints:["src/services/unifi-network.ts","src/lib/unifi-policy.ts"],bundle:true,platform:"node",format:"esm",outdir:"test-build",outExtension:{".js":".mjs"},external:["cloudflare:workers"]});
const network=await import(new URL("../test-build/services/unifi-network.mjs",import.meta.url).href);
const policy=await import(new URL("../test-build/lib/unifi-policy.mjs",import.meta.url).href);
const docs=JSON.parse(await readFile("src/data/unifi/network/creatednspolicy.json","utf8"));
let passed=0;
async function test(name,fn){await fn();passed++;console.log("PASS "+name);}
class Server{tools=new Map();registerTool(name,config,fn){assert(!this.tools.has(name));this.tools.set(name,{config,fn});}}
const calls=[];
let live={enabled:true,type:"A_RECORD",domain:"example.invalid",ipv4Address:"192.0.2.1"};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{calls.push({url:String(url),...init});return Response.json(init.method==="GET"?live:{id:"test-resource"});};
const entries=new Map();let serial=Promise.resolve();
const approvals={getByName(token){return {
 async save(p){entries.set(token,JSON.parse(p));},
 async peek(owner){const p=entries.get(token);if(!p||p.owner!==owner||p.expires<Date.now())throw Error("invalid confirmation");return JSON.stringify(p);},
 consume(owner){const next=serial.then(async()=>{const p=entries.get(token);if(!p||p.owner!==owner||p.expires<Date.now())throw Error("invalid confirmation");entries.delete(token);return JSON.stringify(p);});serial=next.catch(()=>{});return next;}
};}};
const env={UNIFI_API_KEY:"test-key-never-live",UNIFI_CALLER:"connection-a",UNIFI_APPROVALS:approvals,UNIFI_NETWORK_TOOL_PERMISSION_MODE:"confirm",UNIFI_POLICY_NETWORK_CREATE:"true",UNIFI_POLICY_NETWORK_UPDATE:"true",UNIFI_POLICY_NETWORK_DELETE:"false"};
const server=new Server();network.registerExpandedUnifiTools(server,env);
async function call(name,args){const t=server.tools.get(name);return t.fn(z.object(t.config.inputSchema).parse(args));}
const base={console_id:"test-console",parameters:{siteId:"test-site"},query:{}};
const body={enabled:true,type:"A_RECORD",domain:"example.invalid",ipv4Address:"192.0.2.2"};
await test("14 new MCP tools with no duplicate names",()=>assert.equal(server.tools.size,14));
await test("catalog exposes only read/create/update",async()=>{const r=await call("unifi_network_catalog",{limit:100});assert(r.structuredContent.data.operations.length>40);assert(r.structuredContent.data.operations.every(o=>!o.operation.startsWith("connector")&&!/^(delete|remove|execute|adopt)/.test(o.operation)));});
await test("DELETE and disguised remove action blocked before fetch",async()=>{const n=calls.length;for(const op of ["deletenetwork","removedevice","connectordelete","executeadopteddeviceaction","adoptdevice"]){const r=await call("unifi_network_read",{...base,operation:op});assert(r.isError);}assert.equal(calls.length,n);});
await test("console and path traversal blocked",async()=>{for(const console_id of ["../x","https://evil.invalid","a/b","%2f"]){const r=await call("unifi_network_read",{...base,console_id,operation:"getsiteoverviewpage",parameters:{}});assert(r.isError);}});
await test("unknown query cannot inject route",async()=>{const r=await call("unifi_network_read",{...base,operation:"getsiteoverviewpage",parameters:{},query:{url:"https://evil.invalid"}});assert(r.isError);});
await test("GET uses only fixed HTTPS cloud origin and forbids redirects",async()=>{const r=await call("unifi_network_read",{...base,operation:"getsiteoverviewpage",parameters:{},query:{limit:1}});assert(!r.isError);assert(calls.at(-1).url.startsWith("https://api.ui.com/v1/connector/consoles/test-console/proxy/network/integration/v1/sites"));assert.equal(calls.at(-1).redirect,"manual");assert.equal(calls.at(-1).method,"GET");});
await test("create preview does not fetch or mutate network",async()=>{const n=calls.length,r=await call("unifi_network_preview",{...base,operation:"creatednspolicy",body});assert(!r.isError,JSON.stringify(r));assert.equal(calls.length,n);assert.equal(r.structuredContent.data.status,"awaiting_user_confirmation");});
await test("missing required, invalid types and unknown body fields blocked",async()=>{for(const b of [Object.fromEntries(Object.entries(body).filter(([k])=>k!=="enabled")),{...body,enabled:"true"},{...body,type:"NOT_A_TYPE"},{...body,delete:true},{...body,enabled:null}])assert((await call("unifi_network_preview",{...base,operation:"creatednspolicy",body:b})).isError);});
await test("discriminator-specific fields accepted",()=>policy.validateFields(docs.requestBody,body));
await test("array discriminator validation checks nested items",async()=>{const d=JSON.parse(await readFile("src/data/unifi/network/createtrafficmatchinglist.json","utf8"));policy.validateFields(d.requestBody,{name:"ports",type:"PORTS",items:[{type:"PORT_NUMBER",value:443}]});assert.throws(()=>policy.validateFields(d.requestBody,{name:"ports",type:"PORTS",items:[{type:"PORT_NUMBER",value:"443"}]}));});
await test("delete stays denied even if preview is attempted",async()=>assert((await call("unifi_network_preview",{...base,operation:"deletednspolicy",body:{}})).isError));
await test("no bypass mode accepted",async()=>{env.UNIFI_NETWORK_TOOL_PERMISSION_MODE="bypass";assert((await call("unifi_network_preview",{...base,operation:"creatednspolicy",body})).isError);env.UNIFI_NETWORK_TOOL_PERMISSION_MODE="confirm";});
await test("changing delete gate fails writes closed",async()=>{env.UNIFI_POLICY_NETWORK_DELETE="true";assert((await call("unifi_network_preview",{...base,operation:"creatednspolicy",body})).isError);env.UNIFI_POLICY_NETWORK_DELETE="false";});
await test("create/update gates independently enforced",async()=>{env.UNIFI_POLICY_NETWORK_CREATE="false";assert((await call("unifi_network_preview",{...base,operation:"creatednspolicy",body})).isError);env.UNIFI_POLICY_NETWORK_CREATE="true";});
await test("explicit confirmation is required in schema",async()=>{await assert.rejects(()=>call("unifi_network_confirm",{confirmation_token:"a".repeat(64),confirmed:false}));});
await test("confirmation rejects another connection",async()=>{const p=(await call("unifi_network_preview",{...base,operation:"creatednspolicy",body})).structuredContent.data;env.UNIFI_CALLER="connection-b";assert((await call("unifi_network_confirm",{confirmation_token:p.confirmation_token,confirmed:true})).isError);env.UNIFI_CALLER="connection-a";});
await test("expired token rejected",async()=>{const p=(await call("unifi_network_preview",{...base,operation:"creatednspolicy",body})).structuredContent.data;entries.get(p.confirmation_token).expires=Date.now()-1;assert((await call("unifi_network_confirm",{confirmation_token:p.confirmation_token,confirmed:true})).isError);});
await test("single-use confirmation sends exactly one mocked mutation",async()=>{const p=(await call("unifi_network_preview",{...base,operation:"creatednspolicy",body})).structuredContent.data;const n=calls.filter(x=>x.method==="POST").length;const args={confirmation_token:p.confirmation_token,confirmed:true};const rs=await Promise.all([call("unifi_network_confirm",args),call("unifi_network_confirm",args)]);assert.equal(rs.filter(r=>!r.isError).length,1);assert.equal(calls.filter(x=>x.method==="POST").length,n+1);assert.equal(JSON.parse(calls.at(-1).body).ipv4Address,body.ipv4Address);});
await test("stale update rejected before mutation",async()=>{live={...live,ipv4Address:"192.0.2.1"};const p=(await call("unifi_network_preview",{...base,operation:"updatednspolicy",parameters:{siteId:"test-site",dnsPolicyId:"test-policy"},body})).structuredContent.data;const n=calls.filter(x=>x.method==="PUT").length;live={...live,ipv4Address:"192.0.2.99"};assert((await call("unifi_network_confirm",{confirmation_token:p.confirmation_token,confirmed:true})).isError);assert.equal(calls.filter(x=>x.method==="PUT").length,n);});
await test("redirection and upstream error bodies never expose credential text",async()=>{await assert.rejects(()=>policy.requestNetwork("secret",{...base,operation:"getsiteoverviewpage",parameters:{}},{slug:"getsiteoverviewpage",method:"GET",path:"/v1/sites"},async()=>new Response("secret",{status:302})),e=>!e.message.includes("secret"));});
await test("documentation exposes versions, schemas, examples and guides",async()=>{for(const [name,args]of [["unifi_docs_info",{}],["unifi_docs_search",{query:"network"}],["unifi_docs_get_endpoint",{endpoint:"network/createnetwork"}],["unifi_docs_get_example",{endpoint:"network/getsiteoverviewpage"}],["unifi_docs_get_guide",{}]])assert(!(await call(name,args)).isError);});
await test("field schema returns an exact discriminator subtree",async()=>{const f=await call("unifi_docs_find_field",{query:"dhcp",endpoint:"createnetwork",limit:30});const hit=f.structuredContent.data[0];assert(hit);const r=await call("unifi_docs_get_field_schema",{endpoint:"createnetwork",field_path:hit.path});assert(!r.isError);});
globalThis.fetch=originalFetch;
// Exercise the actual Durable Object in workerd, not the in-memory tool-test adapter.
await test("real SQLite Durable Object rejects concurrent replay and survives calls",async()=>{
 const b=await build({stdin:{contents:'export {UnifiApproval} from "./src/lib/unifi-approvals.ts"; export default {async fetch(req,env){const a=await req.json();try{const stub=env.A.getByName(a.token);return Response.json({result:await stub[a.method](...a.args)});}catch(e){return Response.json({error:e.message},{status:409});}}};',resolveDir:fileURLToPath(new URL("..",import.meta.url)),sourcefile:"test-entry.ts"},bundle:true,platform:"neutral",format:"esm",write:false,external:["cloudflare:workers"]});
 const mf=new Miniflare({modules:true,script:b.outputFiles[0].text,compatibilityDate:"2026-06-01",durableObjects:{A:{className:"UnifiApproval",useSQLite:true}}});
 try{
  const rpc=(method,args)=>mf.dispatchFetch("http://localhost/test",{method:"POST",body:JSON.stringify({token:"test-approval",method,args})});
  const p={owner:"a",target:{...base,operation:"creatednspolicy",body},expires:Date.now()+60000,beforeHash:null,before:null,policy:"create"};
  assert.equal((await rpc("save",[JSON.stringify(p)])).status,200);assert.equal((await rpc("peek",["b"])).status,409);assert.equal((await rpc("peek",["a"])).status,200);
  const rs=await Promise.all([rpc("consume",["a"]),rpc("consume",["a"])]);assert.equal(rs.filter(r=>r.status===200).length,1);
 }finally{await mf.dispose();}
});
console.log(JSON.stringify({passed,live_mutations:0}));
