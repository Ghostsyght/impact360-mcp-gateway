export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface DocField { name:string; required?:boolean; type?:string|null; description?:string|null; children?:DocField[]|null; discriminator?:{value:string;schema?:DocField[]|null}[]|null; enum?:Json[]|null; [key:string]:unknown }
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
const supportedFieldKeys=new Set(["name","required","type","description","children","discriminator","enum"]);
type FieldKind="string"|"boolean"|"integer"|"number"|"object";
function fieldKind(type:string,path:string):FieldKind {
 const match=/^(string|boolean|integer|number|object)(?:\s*\([^)]*\))?$/.exec(type.trim().toLowerCase());
 if(!match)throw Error("Unsupported documented type at "+path+". This snapshot validator is not a complete OpenAPI validator.");
 return match[1] as FieldKind;
}
function validatePrimitive(kind:FieldKind,value:unknown,path:string):void {
 if(kind==="string"&&typeof value!=="string")throw Error(path+" must be a string.");
 if(kind==="boolean"&&typeof value!=="boolean")throw Error(path+" must be boolean.");
 if(kind==="integer"&&!Number.isSafeInteger(value))throw Error(path+" must be a safe integer.");
 if(kind==="number"&&(typeof value!=="number"||!Number.isFinite(value)))throw Error(path+" must be numeric.");
 if(kind==="object"&&(!value||typeof value!=="object"||Array.isArray(value)))throw Error(path+" must be an object.");
}
// Supports the explicit field types, enums and discriminator schemas in the pinned
// documentation snapshot. New schema constraints fail closed; API-side semantic
// validation, formats and cross-field rules are not claimed by this validator.
export function validateFields(fields:DocField[],data:Record<string,unknown>,partial=false,prefix="body"):void {
 const effective=new Map(fields.map(f=>[f.name,f]));
 for(const f of fields){if(data[f.name]!==undefined && f.discriminator?.length){
  const variant=f.discriminator.find(d=>d.value===data[f.name]);
  if(!variant)throw Error("Invalid discriminator: "+prefix+"."+f.name);
  // Scraped pages repeat the initially selected variant at the top level. Do not
  // accidentally allow those fields when a different discriminator is selected.
  for(const alternative of f.discriminator)for(const x of alternative.schema??[])if(x.name!==f.name)effective.delete(x.name);
  for(const x of variant.schema??[])effective.set(x.name,x);
 }}
 for(const key of Object.keys(data))if(!effective.has(key))throw Error("Unknown "+prefix+" field: "+key+". Inspect the endpoint schema.");
 for(const f of effective.values()){
  const value=data[f.name],path=prefix+"."+f.name;
  if(value===undefined){if(f.required&&!partial)throw Error("Missing required field: "+path);continue;}
  for(const key of Object.keys(f))if(!supportedFieldKeys.has(key))throw Error("Unsupported documented constraint "+key+" at "+path+". Inspect the schema before enabling this write.");
  if(f.enum!=null){
   if(!Array.isArray(f.enum)||!f.enum.length)throw Error("Unsupported documented enum at "+path+".");
   if(!f.enum.some(allowed=>canonical(allowed)===canonical(value)))throw Error("Invalid enum value: "+path);
  }
  if(value===null){if(f.required)throw Error(path+" cannot be null.");continue;}
  const type=(f.type??"").trim().toLowerCase();
  const arrayType=/^array\s+of\s+(.+)$/.exec(type);
  if(arrayType||type==="array"){
   if(!Array.isArray(value))throw Error(path+" must be an array.");
   const itemKind=arrayType?fieldKind(arrayType[1],path):f.children?.length?"object":null;
   if(!itemKind)throw Error("Unsupported array item schema at "+path+".");
   if(itemKind!=="object"&&f.children?.length)throw Error("Conflicting documented array schema at "+path+".");
   for(const [i,item]of value.entries()){
    const itemPath=path+"["+i+"]";validatePrimitive(itemKind,item,itemPath);
    if(itemKind==="object"&&f.children?.length)validateFields(f.children,item as Record<string,unknown>,partial,itemPath);
   }
  }else{
   const kind=fieldKind(type,path);validatePrimitive(kind,value,path);
   if(kind!=="object"&&f.children?.length)throw Error("Conflicting documented field schema at "+path+".");
   if(kind==="object"&&f.children?.length)validateFields(f.children,value as Record<string,unknown>,partial,path);
  }
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
