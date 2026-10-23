export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface DocField { name:string; required?:boolean; type?:string|null; description?:string|null; children?:DocField[]|null; discriminator?:{value:string;schema?:DocField[]|null}[]|null }
export interface ApiDoc { slug:string; h1?:string; method?:string; path?:string; description?:string; type?:string; content?:string; sourceUrl?:string; pathParameters?:DocField[]; queryParameters?:DocField[]; requestBody?:DocField[]; responses?:unknown; examples?:Record<string,Record<string,string>>; responseSample?:string|null; [key:string]:unknown }
export const READ_ANNOTATIONS = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
export function canonical(value:unknown):string {
 if(value===null || typeof value!=="object") return JSON.stringify(value);
 if(Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
 return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
}
export async function digest(value:unknown):Promise<string> {const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");}
export function safeId(value:unknown):string {
 if(typeof value!=="string" || !/^[a-zA-Z0-9_:.-]{1,256}$/.test(value) || value==="." || value==="..") throw Error("Invalid identifier. Use the ID returned by a live inventory read.");
 return value;
}
export function operationPolicy(doc:ApiDoc):"read"|"create"|"update"|"denied" {
 if(!doc.path?.startsWith("/v1/") || doc.slug.startsWith("connector") || /delete|remove/i.test(doc.slug)) return "denied";
 if(doc.method==="GET")return "read";
 if(doc.method==="POST" && /^create[a-z]+$/.test(doc.slug))return "create";
 if((doc.method==="PUT" || doc.method==="PATCH") && /^(update|patch)[a-z]+$/.test(doc.slug))return "update";
 return "denied";
}
export function validateFields(fields:DocField[],data:Record<string,unknown>,partial=false,prefix="body"):void {
 const effective=new Map(fields.map(f=>[f.name,f]));
 for(const f of fields){if(data[f.name]!==undefined && f.discriminator?.length){const variant=f.discriminator.find(d=>d.value===data[f.name]);if(!variant)throw Error("Invalid discriminator: "+prefix+"."+f.name);for(const x of variant.schema??[])effective.set(x.name,x);}}
 for(const key of Object.keys(data))if(!effective.has(key))throw Error("Unknown "+prefix+" field: "+key+". Inspect the endpoint schema.");
 for(const f of effective.values()){
  const value=data[f.name],path=prefix+"."+f.name,type=(f.type??"").toLowerCase();
  if(value===undefined){if(f.required&&!partial)throw Error("Missing required field: "+path);continue;}
  if(value===null){if(f.required)throw Error(path+" cannot be null.");continue;}
  if(type.startsWith("string")&&typeof value!=="string")throw Error(path+" must be a string.");
  if(type.startsWith("boolean")&&typeof value!=="boolean")throw Error(path+" must be boolean.");
  if(type.startsWith("integer")&&!Number.isInteger(value))throw Error(path+" must be an integer.");
  if(type.startsWith("number")&&(typeof value!=="number"||!Number.isFinite(value)))throw Error(path+" must be numeric.");
  if(type.startsWith("array")&&!Array.isArray(value))throw Error(path+" must be an array.");
  if(type.startsWith("object")&&(typeof value!=="object"||Array.isArray(value)))throw Error(path+" must be an object.");
  if(f.children?.length && Array.isArray(value)){for(const [i,item]of value.entries()){if(!item||typeof item!=="object"||Array.isArray(item))throw Error(path+" requires object items.");validateFields(f.children,item as Record<string,unknown>,partial,path+"["+i+"]");}}
  else if(f.children?.length && typeof value==="object")validateFields(f.children,value as Record<string,unknown>,partial,path);
 }
}
export function resolvePath(doc:ApiDoc,parameters:Record<string,string>):string {
 const expected=[...(doc.path??"").matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
 if(Object.keys(parameters).some(k=>!expected.includes(k)))throw Error("Unexpected path parameter.");
 return (doc.path??"").replace(/\{([^}]+)\}/g,(_,key)=>encodeURIComponent(safeId(parameters[key])));
}
export interface NetworkTarget {console_id:string;operation:string;parameters:Record<string,string>;query:Record<string,string|number|boolean>;body?:Record<string,Json>}
export function connectorUrl(target:NetworkTarget,doc:ApiDoc):URL {
 const path=resolvePath(doc,target.parameters);
 const url=new URL("https://api.ui.com/v1/connector/consoles/"+encodeURIComponent(safeId(target.console_id))+"/proxy/network/integration"+path);
 const known=new Set((doc.queryParameters??[]).map(p=>p.name));
 for(const [key,value]of Object.entries(target.query)){
  if(!known.has(key))throw Error("Unsupported query parameter: "+key);
  if(typeof value==="string"&&value.length>2048)throw Error("Query value is too long.");
  url.searchParams.set(key,String(value));
 }
 if(url.search.length>8000)throw Error("Query is too long.");
 return url;
}
export async function boundedJson(response:Response):Promise<Json>{
 if(!response.ok){await response.body?.cancel();throw Error("UniFi cloud API returned HTTP "+response.status+". Check console compatibility, API-key scope, and Network version. No automatic retries were made.");}
 const reader=response.body?.getReader();if(!reader)throw Error("UniFi returned an empty body.");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>4*1024*1024){await reader.cancel();throw Error("Response exceeds 4 MiB. Request a smaller page.");}chunks.push(v.value);}}finally{reader.releaseLock();}
 const all=new Uint8Array(size);let n=0;for(const v of chunks){all.set(v,n);n+=v.length;}
 try{return JSON.parse(new TextDecoder().decode(all));}catch{throw Error("UniFi returned invalid JSON.");}
}
export async function requestNetwork(key:string,target:NetworkTarget,doc:ApiDoc,fetcher:typeof fetch=fetch):Promise<Json>{
 const method=doc.method??"GET";const policy=operationPolicy(doc);
 if(policy==="denied"||method==="DELETE")throw Error("Operation denied by policy. Delete and device/client/port action endpoints are unavailable.");
 const url=connectorUrl(target,doc);
 return boundedJson(await fetcher(url,{method,headers:{"X-API-Key":key,"Accept":"application/json",...(target.body?{"Content-Type":"application/json"}:{})},...(target.body?{body:JSON.stringify(target.body)}:{}),redirect:"manual",signal:AbortSignal.timeout(20000)}));
}
