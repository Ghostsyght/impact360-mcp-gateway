#!/usr/bin/env python3
"""
impact360-mcp-gateway — Deployment Smoke Test
==============================================
Mimics the JSON-RPC handshake that Claude Desktop performs via mcp-remote,
then validates tool availability and fires a real tool call for each
configured service.

Usage:
    python test_gateway.py

Set these environment variables before running (or edit the CONFIG block):
    MCP_GATEWAY_URL    https://impact360-mcp-gateway.<account>.workers.dev/mcp
    MCP_ACCESS_TOKEN   the bearer token you set as a Cloudflare secret

The script does NOT require any service credentials — it only needs the
gateway URL and the MCP_ACCESS_TOKEN.  Tool calls that require real
credentials (HaloPSA, SentinelOne, etc.) are only attempted if the tool
appears in the tools/list response, and errors from the upstream APIs are
shown but do not fail the test.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Edit these directly or set them as environment variables.

GATEWAY_URL   = os.environ.get("MCP_GATEWAY_URL",   "https://impact360-mcp-gateway.ghostsyght.workers.dev/mcp")
ACCESS_TOKEN  = os.environ.get("MCP_ACCESS_TOKEN",  "")   # ← required

# Timeout (seconds) for each HTTP request
REQUEST_TIMEOUT = 30

# ── COLOURS ───────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):   print(f"  {GREEN}✓{RESET}  {msg}")
def fail(msg): print(f"  {RED}✗{RESET}  {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET}  {msg}")
def info(msg): print(f"  {CYAN}·{RESET}  {msg}")

# ── HTTP HELPER ───────────────────────────────────────────────────────────────

def post(payload: dict) -> tuple[dict, float]:
    """Send a JSON-RPC request to the gateway and return (response_dict, elapsed_seconds)."""
    body = json.dumps(payload).encode()
    req  = urllib.request.Request(
        GATEWAY_URL,
        data    = body,
        headers = {
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Accept":        "application/json, text/event-stream",
        },
        method  = "POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        raw = resp.read().decode()
    elapsed = time.perf_counter() - t0

    # The MCP Streamable-HTTP transport may return SSE lines or plain JSON.
    # Extract the first JSON object we can find.
    data = _parse_mcp_response(raw)
    return data, elapsed


def _parse_mcp_response(raw: str) -> dict:
    """Extract a JSON-RPC object from either a plain JSON or SSE response body."""
    raw = raw.strip()
    if raw.startswith("{"):
        return json.loads(raw)

    # SSE: lines like "data: {...}"
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            candidate = line[5:].strip()
            if candidate and candidate != "[DONE]":
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    pass

    raise ValueError(f"Could not parse MCP response:\n{raw[:500]}")


def healthz() -> tuple[bool, float]:
    """Hit /healthz (no auth required). Returns (ok, elapsed)."""
    url = GATEWAY_URL.replace("/mcp", "/healthz")
    req = urllib.request.Request(url, method="GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            body = json.loads(resp.read())
        elapsed = time.perf_counter() - t0
        return body.get("status") == "ok", elapsed
    except Exception as exc:
        return False, time.perf_counter() - t0


# ── JSON-RPC HELPERS ──────────────────────────────────────────────────────────

_id = 0
def next_id() -> int:
    global _id
    _id += 1
    return _id


def rpc(method: str, params: dict | None = None) -> dict:
    return {
        "jsonrpc": "2.0",
        "id":      next_id(),
        "method":  method,
        **({"params": params} if params else {}),
    }


# ── TEST STEPS ────────────────────────────────────────────────────────────────

results: list[dict] = []   # {name, passed, elapsed, note}

def record(name: str, passed: bool, elapsed: float, note: str = ""):
    results.append({"name": name, "passed": passed, "elapsed": elapsed, "note": note})
    ms = f"{elapsed * 1000:.0f} ms"
    if passed:
        ok(f"{name}  [{ms}]{('  — ' + note) if note else ''}")
    else:
        fail(f"{name}  [{ms}]{('  — ' + note) if note else ''}")


def step_healthz():
    passed, elapsed = healthz()
    record("GET /healthz", passed, elapsed,
           "endpoint reachable" if passed else "unreachable or wrong status")


def step_initialize() -> dict | None:
    """MCP initialize handshake — required before any other method."""
    try:
        resp, elapsed = post(rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities":    {},
            "clientInfo":      {"name": "impact360-smoke-test", "version": "1.0"},
        }))
        if "result" in resp:
            server_info = resp["result"].get("serverInfo", {})
            note = f"server={server_info.get('name','?')} v{server_info.get('version','?')}"
            record("initialize", True, elapsed, note)
            return resp["result"]
        else:
            err = resp.get("error", {})
            record("initialize", False, elapsed, str(err))
            return None
    except Exception as exc:
        record("initialize", False, 0, str(exc))
        return None


def step_tools_list() -> list[str]:
    """Fetch the tool list and report how many tools are registered per service."""
    try:
        resp, elapsed = post(rpc("tools/list"))
        if "result" in resp:
            tools = resp["result"].get("tools", [])
            names = [t["name"] for t in tools]

            # Group by service prefix
            prefixes = {}
            for n in names:
                prefix = n.split("_")[0]
                prefixes[prefix] = prefixes.get(prefix, 0) + 1

            summary = ", ".join(f"{p}×{c}" for p, c in sorted(prefixes.items()))
            record("tools/list", True, elapsed, f"{len(tools)} tools ({summary})")
            return names
        else:
            err = resp.get("error", {})
            record("tools/list", False, elapsed, str(err))
            return []
    except Exception as exc:
        record("tools/list", False, 0, str(exc))
        return []


def step_call_tool(tool_name: str, arguments: dict, label: str | None = None):
    """Call a tool and record the result. API errors from upstream are a warning, not a failure."""
    label = label or f"tools/call → {tool_name}"
    try:
        resp, elapsed = post(rpc("tools/call", {
            "name":      tool_name,
            "arguments": arguments,
        }))
        if "error" in resp and "result" not in resp:
            # JSON-RPC level error (method not found, invalid params, etc.)
            err = resp["error"]
            record(label, False, elapsed, f"JSON-RPC error {err.get('code')}: {err.get('message')}")
            return

        result = resp.get("result", {})
        content = result.get("content", [])
        is_error = result.get("isError", False)
        text = content[0].get("text", "") if content else ""

        if is_error:
            # Tool returned isError=true — typically an upstream API credential problem.
            # This means the gateway is working; credentials just aren't set.
            snippet = text[:120].replace("\n", " ")
            warn(f"{label}  [{elapsed*1000:.0f} ms]  — upstream error (credentials not set?): {snippet}")
            results.append({"name": label, "passed": "warn", "elapsed": elapsed,
                            "note": f"upstream error: {snippet}"})
        else:
            snippet = text[:80].replace("\n", " ")
            record(label, True, elapsed, f"got {len(text)} chars — {snippet}…" if len(text) > 80 else snippet)

    except urllib.error.HTTPError as exc:
        body = exc.read().decode()[:200]
        record(label, False, 0, f"HTTP {exc.code}: {body}")
    except Exception as exc:
        record(label, False, 0, str(exc))


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    print()
    print(f"{BOLD}{'─' * 60}{RESET}")
    print(f"{BOLD}  impact360-mcp-gateway  —  Deployment Smoke Test{RESET}")
    print(f"{'─' * 60}")
    print(f"  URL:    {GATEWAY_URL}")
    print(f"  Token:  {'(set)' if ACCESS_TOKEN else f'{RED}NOT SET — export MCP_ACCESS_TOKEN=...{RESET}'}")
    print(f"{'─' * 60}")
    print()

    if not ACCESS_TOKEN:
        print(f"{RED}ERROR: MCP_ACCESS_TOKEN is not set.{RESET}")
        print("  Export it before running:")
        print("    export MCP_ACCESS_TOKEN=your_token_here")
        print("  Or on Windows PowerShell:")
        print("    $env:MCP_ACCESS_TOKEN = 'your_token_here'")
        sys.exit(1)

    print(f"{BOLD}Step 1 — Health check{RESET}")
    step_healthz()
    print()

    print(f"{BOLD}Step 2 — MCP initialize handshake{RESET}")
    server_info = step_initialize()
    print()

    if server_info is None:
        print(f"{RED}Initialize failed — skipping further tests.{RESET}")
        _print_summary()
        sys.exit(1)

    print(f"{BOLD}Step 3 — Enumerate registered tools{RESET}")
    tool_names = step_tools_list()
    print()

    # ── Tool call probes ─────────────────────────────────────────────────────
    print(f"{BOLD}Step 4 — Tool call probes{RESET}")
    info("(upstream API errors are warnings, not failures — they just mean credentials aren't set yet)")
    print()

    # SentinelOne — list sites (lightest read endpoint)
    if "s1_list_sites" in tool_names:
        step_call_tool("s1_list_sites", {"limit": 1, "format": "summary"},
                       label="s1_list_sites (SentinelOne)")
    elif any(n.startswith("s1_") for n in tool_names):
        warn("SentinelOne tools present but s1_list_sites not found — skipping S1 probe")
    else:
        info("SentinelOne tools not registered (S1_BASE_URL / S1_API_TOKEN not set)")

    # HaloPSA — list agents (lightest read endpoint)
    if "halo_list_agents" in tool_names:
        step_call_tool("halo_list_agents", {"page_size": 1, "format": "summary"},
                       label="halo_list_agents (HaloPSA)")
    elif any(n.startswith("halo_") for n in tool_names):
        warn("HaloPSA tools present but halo_list_agents not found — skipping Halo probe")
    else:
        info("HaloPSA tools not registered (HALO_* vars not set)")

    # N-able — list customers
    if "nable_list_customers" in tool_names:
        step_call_tool("nable_list_customers", {"format": "summary"},
                       label="nable_list_customers (N-able)")
    else:
        info("N-able tools not registered (NABLE_* vars not set)")

    # UniFi — list hosts
    if "unifi_list_hosts" in tool_names:
        step_call_tool("unifi_list_hosts", {"format": "summary"},
                       label="unifi_list_hosts (UniFi)")
    else:
        info("UniFi tools not registered (UNIFI_API_KEY not set)")

    # Meraki — list organizations
    if "meraki_list_organizations" in tool_names:
        step_call_tool("meraki_list_organizations", {"format": "summary"},
                       label="meraki_list_organizations (Meraki)")
    else:
        info("Meraki tools not registered (MERAKI_API_KEY not set)")

    print()
    _print_summary()


def _print_summary():
    print(f"{'─' * 60}")
    print(f"{BOLD}  Results Summary{RESET}")
    print(f"{'─' * 60}")

    passed  = [r for r in results if r["passed"] is True]
    warned  = [r for r in results if r["passed"] == "warn"]
    failed  = [r for r in results if r["passed"] is False]
    total_t = sum(r["elapsed"] for r in results)

    for r in results:
        ms     = f"{r['elapsed']*1000:>6.0f} ms"
        status = (f"{GREEN}PASS{RESET}" if r["passed"] is True
                  else f"{YELLOW}WARN{RESET}" if r["passed"] == "warn"
                  else f"{RED}FAIL{RESET}")
        note   = f"  {r['note']}" if r.get("note") else ""
        print(f"  [{status}]  {ms}  {r['name']}{note}")

    print(f"{'─' * 60}")
    print(f"  {GREEN}{len(passed)} passed{RESET}  |  "
          f"{YELLOW}{len(warned)} warnings{RESET}  |  "
          f"{RED}{len(failed)} failed{RESET}  |  "
          f"total {total_t*1000:.0f} ms")
    print(f"{'─' * 60}")
    print()

    if failed:
        print(f"{RED}{BOLD}  ✗ Deployment has issues — check failed steps above.{RESET}")
    elif warned and not passed:
        print(f"{YELLOW}{BOLD}  ⚠ Gateway is reachable but no tools could call upstream APIs.{RESET}")
        print(f"    Add your service secrets with: npx wrangler secret put <NAME>")
    elif warned:
        print(f"{GREEN}{BOLD}  ✓ Gateway is LIVE.{RESET}  "
              f"{YELLOW}Some upstream APIs returned errors — add secrets for those services.{RESET}")
        print(f"    Run: npx wrangler secret put S1_API_TOKEN  (etc.)")
    else:
        print(f"{GREEN}{BOLD}  ✓ All checks passed — gateway is fully operational!{RESET}")
    print()


if __name__ == "__main__":
    main()
