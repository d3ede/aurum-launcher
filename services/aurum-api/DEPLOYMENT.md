# Cloudflare deployment — 2026-10-23

- Account authenticated; new workers.dev subdomain registered: `aurum-launcher`.
- User selected workers.dev; `buywell.pro` and its DNS were left unchanged.
- Staging: https://aurum-api-staging.aurum-launcher.workers.dev
  - Version: `ae7ddd3a-4970-4a2a-bb27-66526f50cd9a`
- Production: https://api.aurum-launcher.workers.dev
  - Worker: `api`; version: `938559b1-f736-470a-beb9-69503f645789`
  - Renamed endpoint verified: health, config and live CurseForge search returned 200.
  - Previous `aurum-api.aurum-launcher.workers.dev` remains online for compatibility.
- Cloudflare confirms `workers.dev` enabled for both scripts.
- Both have `CURSEFORGE_API_KEY` stored as `secret_text`; `CURSEFORGE_ENABLED` is true.
- Direct CurseForge search with the supplied project key returned HTTP 200.
- The temporary ignored secret file was deleted after upload. No key is embedded in source, the desktop origin configuration, or this document.

At initial verification, HTTPS on both newly created hostnames failed during TLS handshake. After subdomain activation, both hostnames passed HTTPS verification without bypasses.

Verified on both staging and production: `/health`, `/v1/config` (CurseForge enabled), live search, categories, project metadata, description, file list and individual file metadata returned 200. An oversized pageSize returned 400/invalid_request. The verified production origin is configured by `AURUM_API_URL` in `.env.example`; future launcher builds use it by default. Previously installed binaries must be rebuilt/updated or configured via AURUM_API_URL.

The opt-in native core integration test `curseforge_gateway` passed against production: all four content types searched/categories loaded, a real compatible Fabric mod downloaded with hash verification and installed into a temporary profile, metadata/update checks completed, toggles/removal worked, and a CurseForge ZIP containing the real project/file imported without missing files. Temporary data was removed automatically. UI tests additionally cover CurseForge catalog requests, project opening, version selection and installation dispatch. Arbitrary public modpacks and manually restricted downloads are not claimed to be universally verified.
