import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { documents, docsMetadata } from "../data/unifi/index.js";
import { getDoc, registerDocs, result, failure } from "./unifi-docs.js";
import { READ_ANNOTATIONS, operationPolicy, connectorUrl, requestNetwork, digest, validateFields, type ApiDoc, type NetworkTarget, type Json } from "../lib/unifi-policy.js";
import type { UnifiApproval, Preview } from "../lib/unifi-approvals.js";
export interface UnifiEnv {UNIFI_API_KEY:string;UNIFI_CALLER?:string;UNIFI_APPROVALS:DurableObjectNamespace<UnifiApproval>;UNIFI_NETWORK_TOOL_PERMISSION_MODE?:string;UNIFI_POLICY_NETWORK_CREATE?:string;UNIFI_POLICY_NETWORK_UPDATE?:string;UNIFI_POLICY_NETWORK_DELETE?:string}
const targetSchema={
 console_id:z.string().min(1).max(256).describe("Exact console/host ID from unifi_list_hosts. Never infer a console from its display name."),
 operation:z.string().min(1).max(100).describe("Allowed endpoint slug from unifi_network_catalog."),
 parameters:z.record(z.string(),z.string().max(256)).default({}).describe("Path parameter names and IDs from the endpoint schema."),
 query:z.record(z.string(),z.union([z.string().max(2048),z.number().finite(),z.boolean()])).default({}).describe("Only documented query parameters; preserve filters while paging.")
};
function checkedDoc(target:NetworkTarget):ApiDoc{const d=getDoc(target.operation);connectorUrl(target,d);return d;}
function assertWrite(env:UnifiEnv,policy:string){
 if(policy!=="create"&&policy!=="update")throw Error("Policy denies this operation. Delete and device/client/port actions are unavailable.");
 if(env.UNIFI_NETWORK_TOOL_PERMISSION_MODE!=="confirm")throw Error("Mutation permission mode must be confirm.");
 if(env.UNIFI_POLICY_NETWORK_DELETE!=="false")throw Error("Delete policy must remain explicitly false.");
 if(env[policy==="create"?"UNIFI_POLICY_NETWORK_CREATE":"UNIFI_POLICY_NETWORK_UPDATE"]!=="true")throw Error(policy+" is disabled by policy.");
}
function matchingRead(doc:ApiDoc):ApiDoc|undefined{return documents.find(d=>d.method==="GET"&&d.path===doc.path&&operationPolicy(d)==="read");}
function owner(env:UnifiEnv):string{if(!env.UNIFI_CALLER)throw Error("Authenticated connection context is missing.");return env.UNIFI_CALLER;}
async function beforeState(env:UnifiEnv,target:NetworkTarget,doc:ApiDoc):Promise<Json>{
 const read=matchingRead(doc);if(!read)throw Error("This update has no supported read-before-write endpoint and is unavailable.");
 return requestNetwork(env.UNIFI_API_KEY,{...target,operation:read.slug,query:{},body:undefined},read);
}
export function registerExpandedUnifiTools(server:McpServer,env:UnifiEnv){
 registerDocs(server);
 server.registerTool("unifi_network_catalog",{description:"Discover live Network cloud operations, API schemas, and permission gates. Reads execute directly; create/update require preview then explicit user confirmation; delete/actions denied. Console firmware >=5.0.3 and compatible Network API/key scope required.",inputSchema:{query:z.string().max(100).default(""),policy:z.enum(["read","create","update","all"]).default("all"),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(30)},annotations:READ_ANNOTATIONS},async a=>{
  const matches=documents.filter(d=>d.method&&operationPolicy(d)!=="denied"&&(a.policy==="all"||operationPolicy(d)===a.policy)&&[d.h1,d.path,d.slug].some(x=>x?.toLowerCase().includes(a.query.toLowerCase())));
  return result({operations:matches.slice(a.offset,a.offset+a.limit).map(d=>({operation:d.slug,title:d.h1,method:d.method,path:d.path,policy:operationPolicy(d),path_parameters:d.pathParameters,query_parameters:d.queryParameters,source:d.sourceUrl})),total:matches.length,offset:a.offset,limit:a.limit,docs:docsMetadata,permissions:{mode:"confirm",create:env.UNIFI_POLICY_NETWORK_CREATE==="true",update:env.UNIFI_POLICY_NETWORK_UPDATE==="true",delete:false},coverage:"Cloud Integration API only; not all sirkirby legacy/session operations are supported."});
 });
 server.registerTool("unifi_network_read",{description:"Run one documented, allowlisted read-only Network cloud API operation. Use catalog/schema first. Returns one upstream page only. Available on compatible consoles; never falls back to a mutation or local endpoint.",inputSchema:targetSchema,annotations:READ_ANNOTATIONS},async a=>{try{
  const doc=checkedDoc(a);if(operationPolicy(doc)!=="read")throw Error("Read tool accepts GET operations only. Use mutation preview for create/update; delete is denied.");
  return result({source:"UniFi Network cloud Connector",fetched_at:new Date().toISOString(),console_id:a.console_id,operation:doc.slug,page:await requestNetwork(env.UNIFI_API_KEY,a,doc),coverage:"One page. Inspect offset/limit/totalCount and continue until exhausted."});
 }catch(e){return failure(e);}});
 server.registerTool("unifi_network_preview",{description:"Prepare an allowlisted create/update without changing UniFi. Returns target, current state where available, proposed body, and an expiring single-use confirmation token. Show the full preview and ask the user to approve before calling unifi_network_confirm. Delete, reboot, adoption, removal, client and port actions are denied.",inputSchema:{...targetSchema,body:z.record(z.string(),z.json()).describe("Exact documented request fields. Inspect endpoint schema before preparing.")},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:true}},async a=>{try{
  const doc=checkedDoc(a);const policy=operationPolicy(doc);assertWrite(env,policy);
  if(Object.keys(a.query).length)throw Error("Mutation query parameters are disabled.");
  if(!doc.requestBody?.length)throw Error("Operation has no supported documented body.");
  if(JSON.stringify(a.body).length>128*1024)throw Error("Mutation body exceeds 128 KiB.");
  validateFields(doc.requestBody,a.body,doc.method==="PATCH");
  const before=policy==="update"?await beforeState(env,a,doc):null;
  const token=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
  const expires=Date.now()+10*60*1000;
  const preview:Preview={owner:owner(env),target:a,expires,beforeHash:before===null?null:await digest(before),before,policy:policy as "create"|"update"};
  await env.UNIFI_APPROVALS.getByName(token).save(JSON.stringify(preview));
  return result({status:"awaiting_user_confirmation",confirmation_token:token,expires_at:new Date(expires).toISOString(),console_id:a.console_id,operation:doc.slug,method:doc.method,path:doc.path,parameters:a.parameters,before,proposed:a.body,instructions:"Present this exact change to the user. Wait for explicit approval, then call unifi_network_confirm with this token and confirmed=true. Nothing has changed in UniFi."});
 }catch(e){return failure(e);}});
 server.registerTool("unifi_network_confirm",{description:"Apply ONE exact create/update preview ONLY after the user has explicitly approved it. Never call automatically after preview. Uses an expiring single-use token and rejects stale update state. Delete and arbitrary actions are denied. A timed-out result is uncertain; inspect live state before any new preview.",inputSchema:{confirmation_token:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}},async a=>{try{
  const stub=env.UNIFI_APPROVALS.getByName(a.confirmation_token);const p:Preview=JSON.parse(await stub.peek(owner(env)));const doc=checkedDoc(p.target);assertWrite(env,operationPolicy(doc));
  if(p.beforeHash!==null && await digest(await beforeState(env,p.target,doc))!==p.beforeHash)throw Error("Live configuration changed after the preview. Create a new preview and obtain approval again.");
  await stub.consume(owner(env));
  let response;try{response=await requestNetwork(env.UNIFI_API_KEY,p.target,doc);}catch{throw Error("Mutation response is uncertain or failed. The token is consumed and will not be retried. Read the live resource before preparing another change.");}
  let readback:unknown=null;if(p.policy==="update"){try{readback=await beforeState(env,p.target,doc);}catch{readback={status:"readback_failed",guidance:"Inspect live state before further writes."};}}
  return result({status:"submitted",operation:doc.slug,console_id:p.target.console_id,response,readback,readback_available:readback!==null && !(readback as {status?:string}).status,coverage:"No packet-level behavior or network enforcement was tested."});
 }catch(e){return failure(e);}});
}
