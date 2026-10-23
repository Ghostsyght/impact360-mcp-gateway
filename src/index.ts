import baseline, { isAuthorized } from "./live-baseline.js";
import { digest } from "./lib/unifi-policy.js";
import type { UnifiEnv } from "./services/unifi-network.js";
export { UnifiApproval } from "./lib/unifi-approvals.js";
export default {
 async fetch(request:Request,env:UnifiEnv,ctx:ExecutionContext):Promise<Response>{
  if(new URL(request.url).pathname==="/mcp" && await isAuthorized(request,env)){
   // Orbit uses a shared backend credential. Scope confirmation tokens to that
   // authenticated connection; do not claim a distinct end-user identity.
   const caller=await digest({authorization:request.headers.get("Authorization")??"",assertion:request.headers.get("Cf-Access-Jwt-Assertion")??"",session:request.headers.get("Mcp-Session-Id")??""});
   return baseline.fetch(request,{...env,UNIFI_CALLER:caller},ctx);
  }
  return baseline.fetch(request,env,ctx);
 }
} satisfies ExportedHandler<UnifiEnv>;
