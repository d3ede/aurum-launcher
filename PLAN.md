# Aurum API — implemented scope

2026-10-23. Cloudflare Worker and launcher integration are implemented. Production: https://api.aurum-launcher.workers.dev; staging: https://aurum-api-staging.aurum-launcher.workers.dev. Deployment details are in services/aurum-api/DEPLOYMENT.md.

## Why personal keys were removed

CurseForge requests now pass through Aurum's read-only gateway. The project credential is stored exclusively as a Worker secret, so launcher users no longer need developer API keys. The personal-key form, IPC mutation command, key-state field, direct upstream authentication and BYOK fallback have been removed. Existing local credentials are not read or transmitted.

The user requested no replacement technical UI: the integrations/key block is simply removed. Catalog behavior, local operations and other providers remain as before.

## Configuration

The public AURUM_API_URL defaults to the verified workers.dev endpoint in .env.example. The core build script reads .env.example, then optional .env, then the build environment. A process environment value takes priority at runtime. Only the public origin is embedded. No CurseForge credentials belong in these files. Empty origin means CurseForge unavailable; there is no direct-key fallback.

## Service

GET /health and /v1/config; allowlisted CurseForge search, categories, project/description and file metadata routes. Parameter validation, upstream timeout, bounded JSON, response caching, per-IP rate limiting and redacted errors. No Microsoft tokens or game downloads pass through the Worker. Signed launcher updates remain in GitHub Releases. The static website remains on GitHub Pages. The user selected workers.dev; buywell.pro was not modified.

## Verification and limits

Live HTTPS health, config, CurseForge search/categories/project/description/files and invalid-query behavior were verified on staging and production. Worker runtime tests intercept upstream in Miniflare. The opt-in native core smoke test passed real mod installation/download verification, metadata/update checks, toggles/removal and CurseForge ZIP import using isolated temporary data. The catalog's coming-soon placeholder and search/category guards are removed; UI regressions cover catalog requests, details/versions and installation dispatch. No installer release or Git push is included in this work.
