# Horizon integration — 0.5.1 test build

This is a local test build, not a published release. Horizon is an optional
native engine selected in the new-instance loader menu. Existing profiles
default to the Java engine without a migration. Horizon currently targets
Minecraft Java Edition 26.3 on Windows x64; the selected Microsoft account must
own Java Edition. Local offline accounts cannot install or start it.

## Installation and launch

- No Horizon binaries or Minecraft resources are shipped with Aurum. Opening
  Aurum or creating a Java instance does not query or download Horizon.
- Installation obtains the current `nightly` from `horizon-rust/horizon`, verifies
  `SHA256SUMS.v2.sig` with the upstream Ed25519 public key, binding the date and
  commit from the release title, and verifies the archive's SHA-256 before extraction.
  Extraction rejects traversal paths, links and oversized archives.
- The complete build is stored in `horizon/builds/<date-commit-digest>`. Prepared
  resources are shared by profiles using that exact build. A successful profile
  retains its build on repair; it is not silently upgraded on Play.
- Both executables are interrogated through `--launch-api`. Unsupported API
  versions, missing required options and a different Minecraft version stop the
  operation with an error. The integration currently supports API 0.1.x.
- Minecraft files reuse Aurum's checksummed Mojang downloads. Preparation invokes
  the build's `horizon-prepare` with explicit paths to the version JSON, client,
  libraries, assets, server jar and JDK. JSON progress is displayed and cancellation
  terminates the preparer. The profile is marked installed only after preparation
  finishes successfully.
- Before each start, Aurum verifies the selected account's Java Edition entitlements
  and checks resource readiness. Its session is sent over standard input, never
  through command-line arguments or a persistent session file.
- Each instance has its own saves, settings, screenshots and logs. Aurum supervises
  the native process through the same stop/log/crash path as Java and recognizes
  `horizon-client --game-dir` when recovering running games after restart.

## Compatibility and limits

Horizon has its own mod system. Aurum does not install Java catalog mods into a
native instance. Use the instance folder for compatible Horizon content and the
game's resource-pack settings. Java memory/JVM options are hidden for native
profiles. Existing Java modpacks cannot be switched to Horizon through settings.

The Launch API and upstream Nightlies remain experimental. Old Nightly downloads
may disappear from GitHub; existing complete local installations remain usable.
Repair of a missing build may select the current signed Nightly. There is no
separate native-build updater or rollback selector in this first integration.

The upstream Windows Nightly dated 2026-11-05 (`66f3981`) was downloaded and both
executables returned Launch API 0.1.0, Minecraft 26.3, with JDK 25 for preparation.
Full authenticated gameplay still requires a manual check with an owning Microsoft
account; automated tests do not sign in as a real user or touch their game data.

See [upstream launch guide](https://github.com/horizon-rust/horizon/blob/main/docs/api/launch-guide.md)
and [asset provenance](../src/assets/loaders/README.md).

## Local verification — 2026-11-05

- Production frontend build and 19 frontend unit tests passed.
- Regular `cargo test --workspace` and Clippy with warnings denied passed.
  Existing opt-in network/JDK/shortcut tests remain opt-in.
- All 115 Playwright UI scenarios passed with two workers, including both themes,
  Horizon's account requirement, switching back to Java, and persistence of
  tintable loader symbols. The initial ten-worker run was interrupted after
  resource-related timeouts; the complete two-worker run passed.
- The downloaded Windows Nightly's Ed25519 v2 signature and archive SHA-256 were
  independently verified. The archive digest was
  `0e3157a74c56249573f42624d64bc87774324dec1cd20ba6518c784b7293eda0`.
- `scripts/native-horizon-smoke.mjs` passed against the actual optimized 0.5.1
  executable and its real Tauri bridge on an isolated `.test-data` root. It checked
  six branded selector options, fixed Minecraft version, account guidance,
  persisted native engine and tintable symbol, and rejection before downloads for
  an unowned installation.
- A local NSIS installer was built (7.88 MiB) and installed successfully over the
  existing user's Aurum. The installed executable reports 0.5.1, is 24.79 MiB,
  matches the tested build's SHA-256, and includes the four loader license/provenance
  resources. No GitHub release or update manifest was published.

Authenticated first-time resource preparation and playing a world with an owning
Microsoft account remain manual verification items. The smoke test does not claim
to cover authenticated gameplay.
