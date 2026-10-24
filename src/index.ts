import baseline, { handleAuthorized } from "./live-baseline.js";
import { authenticateGateway, type GatewayAuthEnv } from "./lib/gateway-auth.js";
import { digest } from "./lib/unifi-policy.js";
import type { UnifiEnv } from "./services/unifi-network.js";
export { UnifiApproval } from "./lib/unifi-approvals.js";
export default {
 async fetch(request:Request,env:UnifiEnv & GatewayAuthEnv,ctx:ExecutionContext):Promise<Response>{
  if(new URL(request.url).pathname==="/healthz")return baseline.fetch(request,env,ctx);
  const principal=await authenticateGateway(request,env);
  if(!principal)return Response.json({error:"Unauthorized"},{status:401});
  // The current portal supplies a service credential. Only a separately verified
  // Access assertion may establish an employee identity; raw forwarded headers may not.
  const caller=await digest({principal,session:request.headers.get("Mcp-Session-Id")??""});
  return handleAuthorized(request,{...env,UNIFI_CALLER:caller},ctx);
 }
} satisfies ExportedHandler<UnifiEnv & GatewayAuthEnv>;
