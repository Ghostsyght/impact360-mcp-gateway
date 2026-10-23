import { DurableObject } from "cloudflare:workers";
import type { NetworkTarget, Json } from "./unifi-policy.js";
export interface Preview {owner:string;target:NetworkTarget;expires:number;beforeHash:string|null;before:Json;policy:"create"|"update"}
export class UnifiApproval extends DurableObject {
 async save(serialized:string):Promise<void>{
  const preview:Preview=JSON.parse(serialized);
  if(await this.ctx.storage.get("preview"))throw Error("Approval already exists.");
  await this.ctx.storage.put("preview",preview);
  await this.ctx.storage.setAlarm(preview.expires);
 }
 async peek(owner:string):Promise<string>{
  const p=await this.ctx.storage.get<Preview>("preview");
  if(!p || p.owner!==owner || p.expires<Date.now())throw Error("Confirmation is missing, expired, or belongs to another connection.");
  return JSON.stringify(p);
 }
 async consume(owner:string):Promise<string>{
  return this.ctx.storage.transaction(async txn=>{
   const p=await txn.get<Preview>("preview");
   if(!p || p.owner!==owner || p.expires<Date.now())throw Error("Confirmation is missing, expired, or was already consumed.");
   await txn.delete("preview");
   return JSON.stringify(p);
  });
 }
 async alarm():Promise<void>{await this.ctx.storage.deleteAll();}
}
