import type { InferEnv } from "cf/config";
import type { apiBindings } from "../cloudflare.config";
export type ApiEnv = InferEnv<{ env: typeof apiBindings }>;

const prefix = "/v1/curseforge";
const upstreamOrigin = "https://api.curseforge.com";
const upstreamPrefix = "/v1";

function enabled(env: ApiEnv): boolean {
  return env.CURSEFORGE_ENABLED === "true" && !!env.CURSEFORGE_API_KEY?.trim();
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function error(code: string, status: number): Response {
  return json({ error: { code } }, status, status === 429 ? { "Retry-After": "60" } : {});
}

// The launcher only needs these read-only routes. Never accept a target URL.
export function upstreamUrl(input: URL): URL | null {
  const path = input.pathname.slice(prefix.length);
  const search = path === "/mods/search";
  const categories = path === "/categories";
  const files = /^\/mods\/[1-9]\d{0,14}\/files$/.test(path);
  const detail = /^\/mods\/[1-9]\d{0,14}(?:\/description|\/files\/[1-9]\d{0,14})?$/.test(path);
  if (!input.pathname.startsWith(prefix + "/") || !(search || categories || files || detail)) return null;
  const allowed = search
    ? ["gameId", "classId", "searchFilter", "pageSize", "index", "sortField", "sortOrder", "gameVersion", "categoryId", "modLoaderType"]
    : categories ? ["gameId", "classId"]
    : files ? ["pageSize", "index", "gameVersion", "modLoaderType"] : [];
  const target = new URL(upstreamPrefix + path, upstreamOrigin);
  for (const [key, value] of input.searchParams) {
    if (!allowed.includes(key) || input.searchParams.getAll(key).length !== 1 || value.length > 200) return null;
    if (key === "gameId" && value !== "432") return null;
    if (key === "pageSize" && (!/^\d+$/.test(value) || +value < 1 || +value > 50)) return null;
    if (key === "index" && (!/^\d+$/.test(value) || +value > 10000)) return null;
    if (["classId", "categoryId", "sortField", "modLoaderType"].includes(key) && !/^\d{1,10}$/.test(value)) return null;
    if (key === "sortOrder" && !["asc", "desc"].includes(value)) return null;
    if (key === "gameVersion" && !/^[\w. -]{1,50}$/.test(value)) return null;
    target.searchParams.set(key, value);
  }
  if (search || categories) target.searchParams.set("gameId", "432");
  if (search || files) target.searchParams.set("pageSize", target.searchParams.get("pageSize") ?? "24");
  target.searchParams.sort();
  return target;
}

async function route(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET") return json({ error: { code: "method_not_allowed" } }, 405, { Allow: "GET" });
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ status: "ok", service: "aurum-api", apiVersion: 1 });
  if (url.pathname === "/v1/config") return json({ apiVersion: 1, features: { curseforge: enabled(env) } });
  if (!url.pathname.startsWith(prefix + "/")) return error("not_found", 404);
  if (request.url.length > 2048) return error("invalid_request", 400);
  const target = upstreamUrl(url);
  if (!target) return error("invalid_request", 400);
  if (!enabled(env)) return error("curseforge_unavailable", 503);
  // CF-Connecting-IP is set by Cloudflare. Missing IPs share a conservative bucket.
  if (!(await env.RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" })).success) return error("rate_limited", 429);
  const key = new Request(new URL(prefix + target.pathname.slice(upstreamPrefix.length) + target.search, url.origin));
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) return cached;
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { "x-api-key": env.CURSEFORGE_API_KEY!, Accept: "application/json", "User-Agent": "AurumAPI/1.0 (+https://github.com/d3ede/aurum-launcher)" },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return error("upstream_unavailable", 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    return error(response.status === 429 ? "upstream_rate_limited" : response.status === 404 ? "not_found" : "upstream_error", response.status === 429 ? 429 : response.status === 404 ? 404 : 502);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel();
    return error("invalid_upstream_response", 502);
  }
  // Buffer at most 2 MiB so caching cannot amplify an unbounded upstream response.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2 * 1024 * 1024) { await reader.cancel(); return error("upstream_response_too_large", 502); }
        chunks.push(value);
      }
    } catch { return error("upstream_unavailable", 502); }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { JSON.parse(new TextDecoder().decode(bytes)); } catch { return error("invalid_upstream_response", 502); }
  const result = new Response(bytes, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
  ctx.waitUntil(cache.put(key, result.clone()).catch(() => { console.warn(JSON.stringify({ event: "cache_write_failed" })); }));
  return result;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const requestId = crypto.randomUUID();
    let response: Response;
    try { response = await route(request, env, ctx); }
    catch { response = error("internal_error", 500); }
    const result = new Response(response.body, response);
    result.headers.set("X-Request-ID", requestId);
    result.headers.set("X-Content-Type-Options", "nosniff");
    // Never log query strings, request headers, keys, or upstream bodies.
    console.log(JSON.stringify({ event: "request", requestId, status: result.status }));
    return result;
  },
} satisfies ExportedHandler<ApiEnv>;
