/** Bounded, credential-safe HTTP utilities for service clients. No mutation retries. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Perform a JSON fetch. Throws ApiError on non-2xx responses.
 */
export interface JsonRequestInit extends RequestInit {
  responseMode?: "json" | "acknowledgement";
}

async function discardBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* Cleanup cannot replace a known status. */ }
}

export async function fetchJson<T = unknown>(
  url: string,
  init: JsonRequestInit = {}
): Promise<T> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) {
    throw new ApiError(0, "", "Upstream URL must use HTTPS without embedded credentials.");
  }
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const deadline = AbortSignal.timeout(20000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  try {
    const { responseMode = "json", ...requestInit } = init;
    const res = await fetch(target, { ...requestInit, headers, signal, redirect: "manual" });
    if (!res.ok) {
      await discardBody(res);
      throw new ApiError(res.status, "", `Upstream returned HTTP ${res.status}. No automatic retries were made.`);
    }
    if (res.status === 204) return {} as T;
    // Some command endpoints acknowledge with an empty/text 200 or 202 body.
    // Status acceptance is enough for those callers; never reinterpret it as failure.
    if (responseMode === "acknowledgement") {
      await discardBody(res);
      return { accepted: true, status: res.status } as T;
    }
    const maximum = 4 * 1024 * 1024;
    if (Number(res.headers.get("Content-Length")) > maximum) {
      await discardBody(res);
      throw new ApiError(res.status, "", "Upstream response exceeds 4 MiB. Request a smaller page.");
    }
    const reader = res.body?.getReader();
    if (!reader) throw new ApiError(res.status, "", "Upstream returned an empty JSON response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) {
          try { await reader.cancel(); } catch { /* Preserve the size-limit error. */ }
          throw new ApiError(res.status, "", "Upstream response exceeds 4 MiB. Request a smaller page.");
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
    catch { throw new ApiError(res.status, "", "Upstream returned invalid JSON. If this was a write, it may already have occurred; inspect live state before retrying."); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "", signal.aborted
      ? "Upstream request timed out or was cancelled. Inspect live state before retrying a write."
      : "Upstream request failed. Inspect live state before retrying a write.");
  }
}

/**
 * Format an error for MCP tool output.
 */
export function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return `Error: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return "Unknown integration error. No automatic retries were made.";
}

/**
 * Collect all pages from a paginated endpoint.
 * Calls fetcher(page) starting at page 1; stops when an empty array is returned.
 */
export async function paginate<T>(
  fetcher: (page: number) => Promise<T[]>
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const items = await fetcher(page);
    if (items.length === 0) break;
    all.push(...items);
    page++;
    if (items.length < 100) break; // typical page size sentinel
  }
  return all;
}
