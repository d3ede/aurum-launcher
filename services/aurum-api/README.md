# Aurum API

Cloudflare Worker for public launcher configuration and a read-only CurseForge gateway. The website stays on GitHub Pages; downloads and signed updater artifacts stay on GitHub Releases. No database is needed.

## Local checks

Use Node 24.22+ (the pinned `cf` beta requires `^22.23.0 || ^24.22.0 || ^26.12.0`). The Cloudflare toolchain is isolated in this directory. Run commands here:

```powershell
npm ci
npm run check
npm test
npm run dry-run
npm run dev
```

`cf` and the matching Cloudflare Vite plugin use beta programmatic configuration. Lockfiles pin the tested dependency tree. Tests run the Worker in Miniflare/workerd with an intercepted upstream; they do not require credentials or contact CurseForge. CI checks and builds only; it never publishes.

## HTTP contract

| Route | Result |
| --- | --- |
| `GET /health` | Service liveness, `apiVersion: 1` |
| `GET /v1/config` | `{ apiVersion: 1, features: { curseforge: boolean } }` |
| `GET /v1/curseforge/categories` | Minecraft categories |
| `GET /v1/curseforge/mods/search` | Search with validated filters |
| `GET /v1/curseforge/mods/:id` | Project metadata |
| `GET /v1/curseforge/mods/:id/description` | Project description |
| `GET /v1/curseforge/mods/:id/files` | File versions |
| `GET /v1/curseforge/mods/:id/files/:fileId` | File metadata used by installation/import |

CurseForge response shapes are preserved, including missing download URLs for restricted files. Only GET and the listed routes/parameters are supported. Downloads go directly to the provider URLs returned by the existing launcher logic.

Errors are `{ error: { code: string } }`, with 400 for invalid input, 404 for missing resources, 405 for unsupported methods, 429 with Retry-After, 503 when CurseForge is disabled, and 502 for upstream failure. Every response has a fresh `X-Request-ID`. Only successful public JSON responses are cached for 60 seconds; responses are bounded to 2 MiB and upstream requests time out after 10 seconds. Requests have a per-IP rate limit of 120/minute per Cloudflare location. This is an approximate platform limit, not a global quota or client authentication. Review namespace IDs 73101/73102 for collisions in the target account before deployment.

No client Authorization, cookies, or API keys are forwarded. The server key comes only from Workers secrets. Logs contain request ID/status, not headers, bodies, or search queries. CORS is unnecessary for the native Rust client and is not used as authentication.

## Enable and publish

The deployment and verified production/staging endpoints are recorded in [DEPLOYMENT.md](DEPLOYMENT.md). For another account, complete Cloudflare login and inspect account/zones before publishing. MCP OAuth and `cf` login are separate credentials.

The default feature flag is OFF, even when a key exists. Obtain a project key and verify that your approval/terms cover this launcher gateway before enabling it. Keep local development values in ignored `.dev.vars` (template: `.dev.vars.example`). Keep production secrets in a separate ignored `secrets.json`, e.g. an object with the `CURSEFORGE_API_KEY` property, or an external secret file. Never put secrets in command arguments, source, CI logs, or the desktop build.

After account access and key setup, the preparation for staging is:

```powershell
npx cf auth login
$env:AURUM_CURSEFORGE_ENABLED = 'true'
npm run deploy:preview -- --secrets-file ./secrets.json
```

Staging uses `aurum-api-staging`; production uses `api` at https://api.aurum-launcher.workers.dev. The flag must also be set for every subsequent enabled deployment; otherwise it intentionally disables the gateway. Verify `/health`, `/v1/config`, search, file installation, and restricted-download behavior with the real key. Deploy production with `npm run deploy -- --secrets-file ./secrets.json` only after those checks. Choose the account explicitly via `CLOUDFLARE_ACCOUNT_ID` if multiple accounts are available.

Both modes allow the assigned workers.dev address. Do not guess its hostname. After inspecting the account's active zone and existing DNS records, add the exact `api.<domain>` custom-domain trigger to `cloudflare.config.ts`, preview changes, and verify HTTPS. GitHub Pages currently has no custom domain, so it does not provide a domain to reuse.

## Launcher connection

The public `AURUM_API_URL` is set in `../../.env.example` to `https://api.aurum-launcher.workers.dev`. Copy the example to `.env` to override locally. The core build script reads the example, then `.env`, then the build environment, and embeds only this public origin. Changes trigger a rebuild. A desktop process environment override takes priority, including an empty value to disable CurseForge. HTTPS origins only, without paths, credentials, fragments, or query strings. Keep the CurseForge project key only in Workers secrets, never in the launcher's env files.

The launcher always uses the Worker for CurseForge search, categories, details, file metadata and imports. Personal key entry, storage commands and direct CurseForge authentication have been removed: users should not need developer credentials to browse the catalog. Legacy personal keys are never read or sent. `/v1/config` controls the availability indicator, cached for one minute, with a three-second timeout. With no origin or an unavailable API, CurseForge reports an error; other providers and local operations remain available.

Rollback: deploy the previous known-good Worker source/lockfile/config. To disable only the server gateway, rebuild/deploy with `AURUM_CURSEFORGE_ENABLED` unset. Check `/v1/config` returns false and gateway requests return 503; already-running launchers can retain their availability indicator for up to one minute. Keep the previous release and endpoint operational while desktop versions migrate.
