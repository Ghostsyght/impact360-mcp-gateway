import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { documents, docsMetadata } from "../data/unifi/index.js";
import { READ_ANNOTATIONS, operationPolicy, type ApiDoc, type DocField } from "../lib/unifi-policy.js";

export const docMap = new Map(documents.map(d => [d.slug, d]));
export const MAX_RESULT_BYTES = 32 * 1024;
const DEFAULT_DOC_BYTES = 8 * 1024;
const MAX_DOC_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const schemaCoverage = "Pinned documentation fields, enums and discriminator variants only; not complete OpenAPI or live console compatibility validation.";

export function getDoc(slug: string): ApiDoc {
  const doc = docMap.get(slug.replace(/^network\//, ""));
  if (!doc) throw Error("Unknown Network endpoint. Search the documentation or operation catalog first.");
  return doc;
}
export function fieldHits(doc: ApiDoc, query: string): { path: string; schema: DocField }[] {
  const hits: { path: string; schema: DocField }[] = [];
  const needle = query.toLowerCase();
  function walk(fields: DocField[], prefix: string) {
    for (const f of fields) {
      const path = prefix + "." + f.name;
      if (f.name.toLowerCase().includes(needle)) hits.push({ path, schema: f });
      walk(f.children ?? [], path);
      for (const variant of f.discriminator ?? []) walk(variant.schema ?? [], path + "[" + variant.value + "]");
    }
  }
  for (const section of ["pathParameters", "queryParameters", "requestBody"] as const) walk(doc[section] ?? [], section);
  for (const [i, response] of ((doc.responses ?? []) as { fields?: DocField[] }[]).entries()) walk(response.fields ?? [], "responses." + i);
  return hits;
}
function byteLength(value: unknown): number { return encoder.encode(JSON.stringify(value)).byteLength; }

// Compact JSON remains a complete fallback for clients without structuredContent.
// Both representations share one data budget. Never silently truncate inventory.
export function result(value: unknown) {
  let output: { data: unknown } = { data: value };
  const actualBytes = byteLength(output);
  const oversized = actualBytes > MAX_RESULT_BYTES;
  // Network confirm emits this status only after consuming the approval token and
  // submitting the write. A display budget cannot turn that into a retryable error.
  const submission = value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).status === "submitted"
    ? value as Record<string, unknown> : null;
  if (oversized && submission) {
    const parameters = submission.parameters;
    const boundedParameters = parameters && typeof parameters === "object" && !Array.isArray(parameters)
      && Object.keys(parameters).length <= 16
      && Object.keys(parameters).every(name => name.length <= 100)
      && Object.values(parameters).every(id => typeof id === "string" && id.length <= 256)
      ? parameters : undefined;
    output = { data: {
      status: "submitted", token_consumed: true, retry_allowed: false,
      operation: typeof submission.operation === "string" ? submission.operation.slice(0, 100) : null,
      console_id: typeof submission.console_id === "string" ? submission.console_id.slice(0, 256) : null,
      ...(boundedParameters ? { parameters: boundedParameters } : {}),
      details_omitted: true, readback_available: false,
      actual_bytes: actualBytes, maximum_bytes: MAX_RESULT_BYTES,
      guidance: "The write was submitted and its confirmation token was consumed. Response and readback bodies are omitted only because they exceed the display budget. Do not retry the mutation or create another preview to repeat it. Use a read-only request to inspect the live resource and verify its state."
    } };
  } else if (oversized) output = { data: {
      status: "result_too_large", actual_bytes: actualBytes, maximum_bytes: MAX_RESULT_BYTES,
      guidance: "No partial result is returned. Request a smaller page, narrower field, or bounded documentation section. Do not claim complete coverage from this response."
    } };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
    ...(oversized && !submission ? { isError: true as const } : {})
  };
}
export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "UniFi operation failed.";
  return { content: [{ type: "text" as const, text: message.slice(0, 2048) }], isError: true as const };
}
function projectField(field: DocField, depth: number): Record<string, unknown> {
  const children = field.children ?? [];
  const variants = field.discriminator ?? [];
  return {
    name: field.name, required: !!field.required, type: field.type ?? null,
    ...(field.description ? { description: field.description.slice(0, 384) } : {}),
    ...(field.enum ? { enum: field.enum } : {}),
    ...(children.length ? { child_count: children.length, ...(depth > 0 ? { children: children.map(f => projectField(f, depth - 1)) } : {}) } : {}),
    ...(variants.length ? { discriminator: variants.map(v => ({
      value: v.value, field_count: v.schema?.length ?? 0,
      ...(depth > 0 ? { schema: (v.schema ?? []).map(f => projectField(f, depth - 1)) } : {})
    })) } : {})
  };
}
interface ViewOptions { depth: number; max_bytes: number; offset: number; limit: number }
function viewOptions(args: Record<string, any>): ViewOptions {
  return { depth: args.depth, max_bytes: args.max_bytes, offset: args.offset, limit: args.limit };
}
function boundedView(build: (depth: number, limit: number) => Record<string, unknown>, options: ViewOptions) {
  let depth = options.depth;
  let limit = options.limit;
  for (;;) {
    const view = {
      ...build(depth, limit), requested_depth: options.depth, returned_depth: depth,
      budget_bytes: options.max_bytes, truncated: depth < options.depth || limit < options.limit,
      schema_coverage: schemaCoverage
    };
    if (byteLength({ data: view }) <= options.max_bytes) return view;
    if (depth > 0) { depth--; continue; }
    if (limit > 1) { limit = Math.max(1, Math.floor(limit / 2)); continue; }
    return {
      status: "documentation_exceeds_budget", budget_bytes: options.max_bytes, truncated: true,
      guidance: "Use documentation search and an exact field path, or request fewer fields. No complete schema is implied.",
      schema_coverage: schemaCoverage
    };
  }
}
const docSections = ["summary", "path", "query", "request", "response", "all"] as const;
type DocSection = typeof docSections[number];
export function endpointView(doc: ApiDoc, section: DocSection, options: ViewOptions) {
  return boundedView((depth, limit) => {
    const base = {
      endpoint: "network/" + doc.slug, title: doc.h1, method: doc.method, path: doc.path,
      source: doc.sourceUrl, execution_policy: operationPolicy(doc), section,
      description: doc.description?.slice(0, 1024), available_sections: docSections,
      guidance: "Retrieve request/response sections or an exact field path for detail; examples and guides have separate tools. Omitted children are identified by child_count or field_count."
    };
    const page = (fields: DocField[], fieldDepth = depth) => ({
      fields: fields.slice(options.offset, options.offset + limit).map(f => projectField(f, fieldDepth)),
      total_fields: fields.length, offset: options.offset, limit,
      has_more: options.offset + limit < fields.length
    });
    if (section === "summary") return {
      ...base, request: page(doc.requestBody ?? [], 0), path_parameters: page(doc.pathParameters ?? [], 0),
      query_parameters: page(doc.queryParameters ?? [], 0), response_count: Array.isArray(doc.responses) ? doc.responses.length : 0
    };
    if (section === "path") return { ...base, ...page(doc.pathParameters ?? []) };
    if (section === "query") return { ...base, ...page(doc.queryParameters ?? []) };
    if (section === "request") return { ...base, ...page(doc.requestBody ?? []) };
    const responses = ((doc.responses ?? []) as { statuses?: unknown; fields?: DocField[] }[])
      .map(response => ({ statuses: response.statuses, ...page(response.fields ?? []) }));
    if (section === "response") return { ...base, responses };
    return { ...base, request: page(doc.requestBody ?? []), path_parameters: page(doc.pathParameters ?? []), query_parameters: page(doc.queryParameters ?? []), responses };
  }, options);
}

export function registerDocs(server: McpServer) {
  const register = (name: string, description: string, inputSchema: z.ZodRawShape, handler: (args: Record<string, any>) => unknown) =>
    server.registerTool(name, { description, inputSchema, annotations: { ...READ_ANNOTATIONS, openWorldHint: false } }, async args => {
      try { return result(handler(args)); } catch (error) { return failure(error); }
    });
  const endpoint = z.string().max(100).describe("Endpoint slug from documentation search, e.g. network/getnetworkdetails.");
  const viewSchema = {
    depth: z.number().int().min(0).max(4).default(1).describe("Nested schema depth. Large views reduce depth to fit the byte budget and report the returned depth."),
    max_bytes: z.number().int().min(1024).max(MAX_DOC_BYTES).default(DEFAULT_DOC_BYTES).describe("Maximum UTF-8 bytes for the documentation data envelope."),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(20)
  };
  register("unifi_docs_info", "Network API documentation version, source, and freshness. Documentation describes supported API shapes; it does not establish live console compatibility.", {}, () => ({ ...docsMetadata, repository: "KallistoX/mcp-unifi-applications", endpointCount: documents.filter(d => d.method).length, scope: "Network only", schema_coverage: schemaCoverage, liveNetworkPolicy: { create: "preview then confirm", update: "preview then confirm", delete: "denied" } }));
  register("unifi_docs_search", "Search Network API endpoints by title, description, path, or method. Documentation for a delete operation is reference material only and cannot authorize execution.", { query: z.string().max(200), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(), limit: z.number().int().min(1).max(50).default(15) }, a => documents.filter(d => d.method && (!a.method || d.method === a.method) && [d.h1, d.path, d.description, d.slug].some(v => v?.toLowerCase().includes(a.query.toLowerCase()))).slice(0, a.limit).map(d => ({ endpoint: "network/" + d.slug, title: d.h1, method: d.method, path: d.path, execution_policy: operationPolicy(d), source: d.sourceUrl })));
  register("unifi_docs_list_endpoints", "Browse documented Network API endpoints with pagination.", { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(25), method: z.string().optional() }, a => { const docs = documents.filter(d => d.method && (!a.method || d.method === a.method)); return { data: docs.slice(a.offset, a.offset + a.limit).map(d => ({ endpoint: "network/" + d.slug, title: d.h1, method: d.method, path: d.path, execution_policy: operationPolicy(d) })), total: docs.length, offset: a.offset, limit: a.limit }; });
  register("unifi_docs_get_endpoint", "Get a compact Network endpoint summary by default. Request a bounded schema section and depth for details before preparing create/update; examples are fetched separately.", { endpoint, section: z.enum(docSections).default("summary"), ...viewSchema }, a => endpointView(getDoc(a.endpoint), a.section, viewOptions(a)));
  register("unifi_docs_get_endpoint_group", "List documented operations for a Network resource, such as networks or firewall policies.", { resource: z.string().min(1).max(100) }, a => documents.filter(d => d.method && d.path?.toLowerCase().includes(a.resource.toLowerCase())).map(d => ({ endpoint: d.slug, title: d.h1, method: d.method, path: d.path, policy: operationPolicy(d) })));
  register("unifi_docs_get_example", "Get one documented API code example. Examples are never executed; Orbit mutations must use preview/confirm tools.", { endpoint, language: z.enum(["curl", "go", "nodejs", "python", "ansible"]).default("nodejs"), mode: z.enum(["local", "remote"]).default("remote") }, a => ({ endpoint: a.endpoint, language: a.language, mode: a.mode, example: getDoc(a.endpoint).examples?.[a.mode]?.[a.language] ?? null }));
  register("unifi_docs_get_response_sample", "Get a documented example response, clearly distinguished from live network state.", { endpoint }, a => ({ sample: getDoc(a.endpoint).responseSample ?? null, source: getDoc(a.endpoint).sourceUrl, live: false }));
  register("unifi_docs_find_field", "Find documented fields by name across Network API schemas. Returns shallow field summaries; use the exact path for bounded detail.", { query: z.string().min(1).max(100), endpoint: endpoint.optional(), limit: z.number().int().min(1).max(30).default(15) }, a => (a.endpoint ? [getDoc(a.endpoint)] : documents.filter(d => d.method)).flatMap(d => fieldHits(d, a.query).map(hit => ({ endpoint: d.slug, path: hit.path, schema: projectField(hit.schema, 0) }))).slice(0, a.limit));
  register("unifi_docs_get_field_schema", "Return a bounded field subtree using its exact path from unifi_docs_find_field. Reports omitted children and any depth reduction.", { endpoint, field_path: z.string().min(1).max(500), ...viewSchema }, a => {
    const doc = getDoc(a.endpoint);
    const name = a.field_path.split(".").pop()?.replace(/\[.*$/, "") ?? "";
    const hit = fieldHits(doc, name).find(h => h.path === a.field_path);
    if (!hit) throw Error("Field path not found. Use unifi_docs_find_field for exact paths.");
    return boundedView(depth => ({ endpoint: doc.slug, path: hit.path, schema: projectField(hit.schema, depth) }), viewOptions(a));
  });
  register("unifi_docs_get_guide", "Read a Network API guide for authentication, filtering, or errors.", { guide: z.string().max(100).default("gettingstarted") }, a => { const doc = getDoc(a.guide); if (doc.type !== "guide") throw Error("Choose a guide slug: gettingstarted, filtering, or error-handling."); return doc; });
}
