/** Shared HTTP utilities for all service clients. */

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
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new ApiError(
      res.status,
      text,
      `HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * Format an error for MCP tool output.
 */
export function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return `Error ${err.status}: ${err.body.slice(0, 500)}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Unknown error: ${String(err)}`;
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
