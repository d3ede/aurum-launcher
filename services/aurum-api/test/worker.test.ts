import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, type V4MiniflareOptions } from "miniflare";

const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const script = bundle.outputFiles[0].text;
const createMiniflare = (options: V4MiniflareOptions) => new Miniflare(convertV4MiniflareOptions(options));

test("public contract remains usable without a key; restricted routes reject input", async () => {
  const mf = createMiniflare({ modules: true, script, compatibilityDate: "2026-10-23", bindings: { CURSEFORGE_ENABLED: "false" } });
  try {
    const health = await mf.dispatchFetch("https://api.test/health");
    assert.equal(health.status, 200);
    assert.ok(health.headers.get("x-request-id"));
    assert.deepEqual(await (await mf.dispatchFetch("https://api.test/v1/config")).json(), { apiVersion: 1, features: { curseforge: false } });
    assert.equal((await mf.dispatchFetch("https://api.test/v1/curseforge/mods/1")).status, 503);
    assert.equal((await mf.dispatchFetch("https://api.test/health", { method: "POST" })).status, 405);
    for (const path of ["/mods/1?url=https://evil.test", "/mods/search?gameId=1", "/mods/search?pageSize=1000", "/mods/search?index=10001", "/mods/search?pageSize=2&pageSize=3", "/mods/1/download-url", "/mods/search?searchFilter=" + "a".repeat(201)]) {
      assert.equal((await mf.dispatchFetch("https://api.test/v1/curseforge" + path)).status, 400, path);
    }
    assert.equal((await mf.dispatchFetch("https://api.test/unknown")).status, 404);
  } finally { await mf.dispose(); }
});

test("gateway keeps credentials server-side, normalizes cache keys and sanitizes errors", async () => {
  let calls = 0;
  const mf = createMiniflare({
    modules: true, script, compatibilityDate: "2026-10-23",
    bindings: { CURSEFORGE_ENABLED: "true", CURSEFORGE_API_KEY: "fixture-server-key" },
    ratelimits: { RATE_LIMITER: { namespace_id: "73101", simple: { limit: 120, period: 60 } } },
    outboundService: async (request) => {
      calls++;
      assert.equal(new URL(request.url).origin, "https://api.curseforge.com");
      assert.equal(request.headers.get("x-api-key"), "fixture-server-key");
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("cookie"), null);
      if (request.url.includes("/mods/2")) return new Response("private error fixture-server-key", { status: 403 });
      if (request.url.includes("/mods/3")) return new Response("redirect", { status: 302, headers: { Location: "https://evil.test" } });
      if (request.url.includes("/mods/4")) return new Response("quota", { status: 429 });
      if (request.url.includes("/mods/5")) return new Response("not json", { headers: { "Content-Type": "application/json" } });
      return Response.json({ data: { id: 1, downloadUrl: null } }, { headers: { "Set-Cookie": "private=1" } });
    },
  });
  try {
    const response = await mf.dispatchFetch("https://api.test/v1/curseforge/mods/search?searchFilter=test&pageSize=24", {
      headers: { Authorization: "Bearer client-token", Cookie: "client=1", "x-api-key": "client-key" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { data: { id: 1, downloadUrl: null } });
    // Cache writes use waitUntil, so allow the background task to finish.
    await new Promise(resolve => setTimeout(resolve, 50));
    const cached = await mf.dispatchFetch("https://api.test/v1/curseforge/mods/search?pageSize=24&searchFilter=test");
    assert.equal(cached.status, 200);
    assert.equal(calls, 1);
    for (const [id, status] of [[2, 502], [3, 502], [4, 429], [5, 502]]) {
      const failed = await mf.dispatchFetch(`https://api.test/v1/curseforge/mods/${id}`);
      assert.equal(failed.status, status);
      assert.equal(failed.headers.get("cache-control"), "no-store");
      assert.ok(!(await failed.text()).includes("fixture-server-key"));
    }
    const before = calls;
    await mf.dispatchFetch("https://api.test/v1/curseforge/mods/2");
    assert.equal(calls, before + 1, "errors must not be cached");
  } finally { await mf.dispose(); }
});

test("rate limiting applies before upstream and cache", async () => {
  const mf = createMiniflare({
    modules: true, script, compatibilityDate: "2026-10-23",
    bindings: { CURSEFORGE_ENABLED: "true", CURSEFORGE_API_KEY: "fixture" },
    ratelimits: { RATE_LIMITER: { namespace_id: "73103", simple: { limit: 1, period: 60 } } },
    outboundService: () => Response.json({ data: [] }),
  });
  try {
    assert.equal((await mf.dispatchFetch("https://api.test/v1/curseforge/mods/1")).status, 200);
    const limited = await mf.dispatchFetch("https://api.test/v1/curseforge/mods/1");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  } finally { await mf.dispose(); }
});
