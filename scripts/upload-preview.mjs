// Cloudflare Builds only: upload compiled code with the *serving* binding set.
// Never deploy traffic, infer migrations, export secrets or inherit an arbitrary latest preview.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

if (process.env.IMPACT360_CLOUD_CHECK !== "1") throw new Error("Preview uploads must run in the approved Cloudflare build workflow.");
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const credential = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !/^[a-f0-9]{32}$/.test(account) || !credential) throw new Error("Cloudflare build account/token configuration is missing.");
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
if (!/^[a-z0-9-]+$/.test(config.name)) throw new Error("Invalid Worker name.");

async function api(path, method = "GET", body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  if (!response.ok) { await response.body?.cancel().catch(()=>{}); throw new Error(`Cloudflare preview API returned HTTP ${response.status}; no automatic retry.`); }
  const data = await response.json();
  if (!data.success) throw new Error("Cloudflare rejected preview upload; inspect the authenticated control plane. No automatic retry.");
  return data.result;
}
const script = `/accounts/${account}/workers/scripts/${config.name}`;
const versions = `/accounts/${account}/workers/workers/${config.name}/versions`;
const getServing = async () => {
  const deployment = await api(`${script}/deployments`);
  const active = deployment.deployments?.[0]?.versions;
  if (active?.length !== 1 || active[0].percentage !== 100) throw new Error("This preview workflow requires one unambiguous serving baseline.");
  return active[0].version_id;
};
const servingId = await getServing();
const baseline = await api(`${versions}/${servingId}`);
const baselineBindings = baseline.bindings;
if (!Array.isArray(baselineBindings) || !baselineBindings.length) throw new Error("Serving bindings were not available; refusing an incomplete preview.");
const servingNames = new Map(baselineBindings.map(binding=>[binding.name,binding]));

for (const [name, value] of Object.entries(config.vars ?? {})) {
  const existing = servingNames.get(name);
  if (existing?.type !== "plain_text" || existing.text !== String(value)) throw new Error(`Configuration change for ${name} needs a separate reviewed rollout.`);
}
for (const binding of config.durable_objects?.bindings ?? []) {
  const existing = servingNames.get(binding.name);
  if (existing?.type !== "durable_object_namespace" || existing.class_name !== binding.class_name) throw new Error(`Durable Object change for ${binding.name} needs a separate migration rollout.`);
}
if (config.compatibility_date !== baseline.compatibility_date || JSON.stringify(config.compatibility_flags ?? []) !== JSON.stringify(baseline.compatibility_flags ?? [])) {
  throw new Error("Runtime compatibility changes need a separate reviewed rollout.");
}
const compiled = await readFile("dist/index.js");
if (!compiled.length) throw new Error("Compiled Worker is empty.");
const sourceHash = createHash("sha256").update(compiled).digest("hex");
const sourceCommit = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? "unknown";
const upload = {
  main_module: "index.js", compatibility_date: baseline.compatibility_date,
  compatibility_flags: baseline.compatibility_flags ?? [], usage_model: baseline.usage_model,
  modules: [{name:"index.js",content_type:"application/javascript+module",content_base64:compiled.toString("base64")}],
  // The beta API supports a specific version here. No secret values are read.
  bindings: baselineBindings.map(binding=>({name:binding.name,type:"inherit",version_id:servingId})),
  annotations: {"workers/message":`Cloud-validated code; inherit serving configuration ${servingId}; commit ${sourceCommit}`},
};
for (const field of ["placement", "limits"]) if (baseline[field]) upload[field] = baseline[field];
if (await getServing() !== servingId) throw new Error("Serving baseline changed during build; refusing preview upload.");
const created = await api(versions, "POST", upload);
const actual = await api(`${versions}/${created.id}`);
function bindingSignature(bindings) {
  return bindings.map(binding=>({
    name:binding.name,type:binding.type,
    ...(binding.type === "plain_text" ? {text:binding.text} : {}),
    ...(binding.type === "json" ? {json:binding.json} : {}),
    ...(binding.type === "durable_object_namespace" ? {namespace_id:binding.namespace_id,class_name:binding.class_name,script_name:binding.script_name} : {}),
  })).sort((a,b)=>a.name.localeCompare(b.name));
}
if (JSON.stringify(bindingSignature(actual.bindings ?? [])) !== JSON.stringify(bindingSignature(baselineBindings))) throw new Error("Uploaded preview binding parity failed. Do not promote this version.");
if (await getServing() !== servingId) throw new Error("Serving version changed during validation. Review before promotion.");
const evidence = {
  preview_upload:"passed",version_id:created.id,serving_version:servingId,serving_unchanged:true,
  binding_parity:true,binding_count:baselineBindings.length,compiled_sha256:sourceHash,
  configuration_inherited_from:servingId,secret_values_exported:0,production_deployments:0,
};
await mkdir(".wrangler", {recursive:true});
await writeFile(".wrangler/preview-upload-evidence.json", JSON.stringify(evidence,null,2)+"\n");
console.log(JSON.stringify(evidence));
