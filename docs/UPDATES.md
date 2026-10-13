# Launcher updates

## For players

Aurum 0.3.2 and later check for updates ten seconds after launch and every six hours while open. You can also check under **Settings → Launcher updates**.

Choose **Update and restart** to download a new version, verify its signature, and install it automatically. **Later** hides the banner for the current session; the update remains available in Settings. Finish running games and launcher tasks before installing. If a check or download fails, keep using the current version and retry later.

Version 0.3.1 has no updater. Install 0.3.2 once from [GitHub Releases](https://github.com/d3ede/aurum-launcher/releases/latest) to enable future in-app updates.

## Release pipeline

The public endpoint is:

```text
https://github.com/d3ede/aurum-launcher/releases/latest/download/latest.json
```

Tauri performs native HTTPS requests, compares SemVer versions, and verifies the downloaded installer against the public key embedded in `src-tauri/tauri.conf.json`. No GitHub token is shipped to players. Updater permissions apply only to the local main window, not the remote Microsoft sign-in window. The Windows installer uses passive mode and restarts the application after installation.

Signatures bind the release version as well as the installer bytes. The release preparation tool rejects a signature for a different version, and the native updater rejects an altered manifest version.

`.github/workflows/release.yml` builds Windows x64 releases from version tags. It runs checks, creates the signed NSIS installer, and calls `scripts/prepare-release.mjs` to generate:

- `Aurum-Launcher_x64-setup.exe`
- `Aurum-Launcher_x64-setup.exe.sig`
- `latest.json`, with an immutable version-specific installer URL
- `SHA256SUMS.txt`

All assets are uploaded to a draft before it becomes the latest public release. The workflow refuses to overwrite published releases. `latest.json` must be present on every future latest release so existing clients can check for updates.

## Publishing the next version

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. Update `package-lock.json` and `Cargo.lock` as needed. The UI reads its version from `package.json`.
2. Add English release notes at `docs/releases/vX.Y.Z.md`.
3. Commit using Conventional Commits and push the source.
4. Create and push the matching `vX.Y.Z` tag. The workflow builds and publishes it automatically. A failed draft can be resumed using the workflow's manual dispatch for the same tag.

The repository secret `TAURI_SIGNING_PRIVATE_KEY` must contain the private key matching the configured public key. Never commit or print it. The current key has no password; the workflow explicitly supplies an empty signing password. Back up the key securely: replacing it without a migration prevents existing clients from accepting future updates.

For a local signed build, set `TAURI_SIGNING_PRIVATE_KEY` to the key path and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to an empty string, then build normally and run:

```powershell
$env:RELEASE_TAG = 'vX.Y.Z'
node scripts/prepare-release.mjs
```

Use the existing isolated-toolchain scripts if working in the original development workspace. A build without the private key may be used for development, but it must never be published as an update.

The updater signature is separate from a Windows Authenticode publisher signature; it does not remove SmartScreen warnings.
