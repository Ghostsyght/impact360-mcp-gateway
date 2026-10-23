import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
const mf=new Miniflare({modules:true,script:await readFile("dist/index.js","utf8"),compatibilityDate:"2026-06-01",compatibilityFlags:["nodejs_compat"],bindings:{MCP_ACCESS_TOKEN:"test-bearer",UNIFI_API_KEY:"test-key",UNIFI_NETWORK_TOOL_PERMISSION_MODE:"confirm",UNIFI_POLICY_NETWORK_CREATE:"true",UNIFI_POLICY_NETWORK_UPDATE:"true",UNIFI_POLICY_NETWORK_DELETE:"false"},durableObjects:{UNIFI_APPROVALS:{className:"UnifiApproval",useSQLite:true}}});
const parse=async r=>{const t=await r.text();try{return JSON.parse(t);}catch{return JSON.parse(t.split("\n").find(l=>l.startsWith("data: ")).slice(6));}};
try {
 const unauth=await mf.dispatchFetch("http://localhost/mcp",{method:"POST",body:"{}"});assert.equal(unauth.status,401);
 const req=async(method,params)=>{const r=await mf.dispatchFetch("http://localhost/mcp",{method:"POST",headers:{Authorization:"Bearer test-bearer","Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});assert.equal(r.status,200);return parse(r);};
 const init=await req("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"orbit-verification",version:"1"}});assert.equal(init.result.serverInfo.name,"impact360-mcp-gateway");
 const listed=await req("tools/list",{});const names=listed.result.tools.map(t=>t.name);
 assert.equal(names.filter(n=>n.startsWith("unifi_")).length,18);for(const name of ["unifi_list_hosts","unifi_list_sites","unifi_list_devices","unifi_connection_health","unifi_network_read","unifi_network_confirm"])assert(names.includes(name));
 const docs=await req("tools/call",{name:"unifi_docs_info",arguments:{}});assert(!docs.result.isError);
 const denied=await req("tools/call",{name:"unifi_network_read",arguments:{console_id:"test-console",operation:"deletenetwork",parameters:{siteId:"s",networkId:"n"}}});assert(denied.result.isError);
 console.log(JSON.stringify({full_worker_http:"passed",unauthenticated_status:401,unifi_tools:18,docs_call:"passed",delete_denial:"passed",live_mutations:0}));
} finally {await mf.dispose();}
