# Verification history — Auren 0.1.0 to Aurum 0.3.1

These records describe checks performed for each update. Historical installer paths, sizes, and hashes refer to those specific builds; the public 0.3.1 artifact is recorded at the end.

## Update: restoring running games — October 14, 2026

After Aurum closes and reopens, game status is restored from real Java processes whose exact `--gameDir` belongs to an existing instance. Relaunching or modifying a running instance is blocked; **Stop** works for restored processes. Status updates automatically when a game exits. Command lines and tokens are not persisted. On Windows, stopping checks process creation time on the same HANDLE used for termination, protecting against PID reuse.

- 46 regular Rust tests passed, including a check that a mismatched creation time never terminates a process. Workspace/all-target Clippy with `-D warnings` passed.
- Three Java tests were explicitly run with `AURUM_PROCESS_TEST_JAVA=C:\Program Files\Java\jdk-25.0.2\bin\java.exe`: restoration after a new Engine is created and targeted stopping without killing unrelated Java; removal of exited games without stale status after reopening; and two processes for one instance. They are normally ignored because they require a JDK. The explicit command `cargo test -p auren-core --test process_recovery -- --ignored` passed.
- Production TypeScript/Vite build and four main-interface Playwright tests passed.
- `scripts/native-session-smoke.mjs` passed using real WebView2/IPC: launching an owned Java fixture through normal game launch, closing through **Close Aurum**, preserving the game process, reopening with **Running**/**Stop**, stopping through the UI, then a second launch/close/reopen cycle and automatic status removal after external termination of the test process. No real Minecraft instance was launched in this test. Result: `.test-data/native-session-1791932698089/result.json`; screenshot: `docs/screenshots/session-restored-native.png`. User games were not stopped.

The corrected Aurum was opened with normal data. Four Java processes present before changing the window retained their PIDs and start times. Installer: `target/skins-build/release/bundle/nsis/Aurum Launcher_0.3.1_x64-setup.exe`, 6,462,105 bytes. SHA256: `85B015355B4919024916EEF990857A0F04EDEE2260D3490329237C20F02DBF60`.

## Update: import progress and speed — October 14, 2026

The global progress card is hidden while the Modrinth dialog is open. Import progress moved into a persistent footer next to **Stop**. Copied data is shown in decimal MB separately from percentage; file counters for other operations retain their units. Both themes and 960×680 layout were checked, including actual button accessibility and cancellation with the correct operation ID.

Local copying uses one blocking worker, a reusable 1 MiB buffer, and progress updates every 150 ms. Repeated parent-directory creation, Tokio scheduling for every read/write, and forced `sync_all` for each file were removed in favor of ordinary writes through the OS file cache. Originals are preserved; staged data is committed only after checking for source changes. Cancellation removes the current partial copy. After a power failure, the copy can be retried from the original.

For the same synthetic instance (1,000 JSON configurations and a 128 MiB file), import time fell from 4.527 to 0.373 seconds, and progress events from 1,520 to 5. Measurements used a local Windows temporary directory with file caching; they do not guarantee the same speed on a user's drive or for a 15,740 MB instance.

12 Rust import tests and workspace/all-target Clippy with `-D warnings` passed. Four import Playwright tests passed. Real WebView2/Rust IPC also copied two isolated instances while preserving originals: `.test-data/native-modrinth-1791930263983/result.json`. The user's import was not interrupted. Screenshots: `docs/screenshots/modrinth-progress-light.png` and `modrinth-progress-dark.png`.

Installer: `target/skins-build/release/bundle/nsis/Aurum Launcher_0.3.1_x64-setup.exe`, 6,435,544 bytes. SHA256: `77D766D06ED2A9D8DF0394DA02E2895C4435C5F28B580EB97B8E5393B85E7E53`. The updated executable was opened with normal user data only after confirming that the import had finished or stopped.

## Update: skin library — Aurum 0.3.0

On October 14, 2026, a dedicated **Skins & capes** tab added saved appearances, nine default characters (18 textures for both arm types), manual rotation, a ground plane instead of a glow effect, and seven animation modes. The library is stored separately in `skin-library.json`; existing account PNGs are preserved.

- Production TypeScript/Vite build and 6 Vitest tests passed.
- 40 Rust tests passed, including 7 new library checks: all 18 default textures, PNG limits, multiple saved skins/capes, persistence across restart, editing/deletion, legacy PNGs, and preservation of a corrupted library.
- Workspace/all-target Clippy with `-D warnings` passed.
- All 17 UI Playwright tests passed. The three skin checks passed again after the final editor-size adjustment. Coverage included adding multiple skins, changing arms/capes, applying, reloading, deleting, both themes, and 960×680 layout. In still mode, frames 750 ms apart matched; dragging changed the view.
- `scripts/native-skins-smoke.mjs` passed with real WebView2 and Rust IPC without mocks: saving two skins and a local cape, applying a slim-arm appearance, editing its name, verifying PNG/JSON on disk, restarting, and applying another wide-arm appearance. Result: `.test-data/native-skins-1791928140111/result.json`. The test used a separate application identifier and data directory; the user's launcher was not stopped.
- Screenshots: `docs/screenshots/skins-light.png`, `skins-dark.png`, `skins-native.png`, `skin-editor-light.png`, and `skin-editor-dark.png`.

Selecting Microsoft-owned capes and rejecting arbitrary local capes for application were checked through UI/mocks. Real authenticated skin/cape mutations in Minecraft Services were not performed. Offline skins and local capes remain launcher previews.

Windows x64 installer: `target/skins-build/release/bundle/nsis/Aurum Launcher_0.3.0_x64-setup.exe`, 6,419,400 bytes. SHA256: `BAE3929E754F5550C8934CB16D7DAC4093EB9BE21723A074AB50730B4C24D407`. The isolated build avoids overwriting an executable locked by a running launcher.

## Update: Modrinth import — Aurum 0.2.1

On October 13, 2026, import was checked against legacy JSON, the classic SQLite `profiles` schema, and the current `instances`/`instance_content_sets` schema, including JSONB and a custom data directory. Modrinth source code was not copied; only storage-format field names and structure were used.

- Production TypeScript/Vite build and 3 Vitest tests passed.
- 28 Rust tests passed, including 9 new import tests: multiple profiles, worlds/settings/disabled mods/custom folders, unchanged source SQLite databases, cancellation, partial success, malformed metadata, path traversal, and an open world on Windows.
- `clippy --workspace --all-targets -- -D warnings` passed.
- All 7 UI Playwright checks passed. The dialog was checked in both themes and at 960×680; its title and buttons remained visible, selections survived filtering, and retries after errors included only failed profiles.
- `scripts/native-modrinth-smoke.mjs` checked real WebView2/IPC: automatic discovery, selecting two test instances, import, library entries, world/settings/disabled-mod files, and unchanged originals. It used a separate test application identifier and `.test-data/native-modrinth-1791924437433`; CDP port 9233 was closed afterward. Real user instances were not imported, and synthetic mods were not launched in-game.

Release code compiled, but the normal open launcher prevented replacement of `target/release/aurum.exe`. A separate NSIS bundle was created from the compiled Cargo artifact using `tauri bundle` with `CARGO_TARGET_DIR=target/modrinth-package`. Installer: `target/modrinth-package/release/bundle/nsis/Aurum Launcher_0.2.1_x64-setup.exe`, 5,637,802 bytes. SHA256: `21797A75BBF71F8FFFDFACB546FAE543F6EE4B4B47DDFD9183555A1000987EA7`.

## Original 0.1.0 verification environment

Date: October 13, 2026. Environment: Windows x64, WebView2, Node.js 22.21, local Rust GNU 1.99, and LLVM-MinGW. All real installations used `.test-data/live`, separate from user data, with the offline profile AurenTest. The implementation is independent; third-party launchers were neither run nor copied.

### Automated checks

| Check | Result |
| --- | --- |
| TypeScript + production Vite build | Passed |
| Vitest | 3 tests passed: compatibility and search keys |
| Rust core | 18 tests passed |
| Clippy workspace / all targets / deny warnings | No warnings |
| Playwright Chromium | 3 tests passed: navigation and theme persistence, dialogs and focus, 960×680 without horizontal overflow |
| npm audit, including development dependencies | 0 detected vulnerabilities at the time of this check |
| Windows Credential Manager | Real temporary write/read/delete passed; the test secret was removed |

Rust tests cover instance isolation and recoverable world deletion, offline UUIDs, local content management, archive traversal protection, import rollback, mrpack override precedence, checksums, corrupted databases without reset, cancellation, unique operation IDs, data copying that preserves the source, Maven classifiers/extensions, loader-library inheritance, argument rules, and token redaction in logs. These verify behavior with temporary files, not availability of external services.

### Real Minecraft installation and launch

`live_smoke` retrieves actual manifests, downloads files, installs the loader and Java, starts a Java process, and waits for an OpenAL, sound-engine, or texture-atlas initialization line in the game log. It then stops the process. This confirms client startup through initialization; world creation and extended gameplay were not tested.

| Minecraft | Loader | Java | Result |
| --- | --- | --- | --- |
| 1.21.1 | Vanilla | Temurin 21 | Installation, initialization, and stop passed |
| 1.21.1 | Fabric 0.19.5 + Sodium 0.8.13 | Temurin 21 | Installation of a real compatible Modrinth project and launch passed |
| 1.21.1 | Forge 52.1.19 | Temurin 21 | Official installer, libraries, and launch passed |
| 1.21.1 | NeoForge 21.1.259 | Temurin 21 | Official installer, libraries, and launch passed |
| 1.21.1 | Quilt 0.20.0-beta.9 | Temurin 21 | Installation, initialization, and stop passed |
| 26.3 — the Mojang manifest's current release on the verification date | Vanilla | Automatically installed Temurin 25 | Downloading 5,147 assets, initialization, and stop passed |

Checks exposed and helped fix loss of Forge client/universal classifiers during library inheritance and a NeoForge module conflict caused by the client JAR name. The regression test preserves both classifiers; the client JAR is published under the installed version's name. Quilt logs an unavailable telemetry-beacon warning, and the offline client logs Realms authentication warnings. Neither prevented initialization.

### Real desktop window

`scripts/native-smoke.mjs` passed on the final `target/release/auren.exe`. It controls Tauri WebView2 through local CDP and invokes real Rust commands, without mocked IPC or API responses. Checks covered:

- State and offline-account loading.
- Real Modrinth search for Sodium and project details.
- Instance creation through the UI.
- Minecraft 1.21.1 installation and launch through the interface.
- Stopping the game process through the UI.
- 3D canvas and the accounts screen.
- Persistence of light/dark theme settings.
- Deleting the test instance.
- No JavaScript errors in the checked scenario.

Results are written to `.test-data/native-smoke-result.json`. `screenshots/native-*.png` were captured from the actual window using test profiles, not prefilled user data. `screenshots/light.png`, `dark.png`, and `settings.png` show browser preview without a native backend.

`scripts/native-content-smoke.mjs` also passed on the release app: installing real Iris 1.8.8 with required Sodium in a clean instance, updating to the latest compatible version, disabling/enabling, removal, and rejecting a Fabric mod in Vanilla. Files were genuinely downloaded and SHA1-verified. This confirms content management; gameplay with Iris was not tested. Result: `.test-data/native-content-result.json`.

A separate Rust test verified uploading a PNG skin with the Alex model and retaining it after an Engine restart. Corrupted PNGs and invalid dimensions are rejected while preserving the previously saved skin.

### Release artifacts

Production Rust/Tauri build and NSIS generation succeeded. Installer: `target/release/bundle/nsis/Auren_0.1.0_x64-setup.exe` (approximately 4.05 MiB).

SHA256: `EAEDA8549612E0065B7DBC3DC3208D2F36E6ED90A2EA8CAE3A736BC806F0F6D6`.

After the initial window-position fix, the release was rebuilt and launched. Win32 checks measured a center offset from the monitor's work area of 0 px horizontally and 3.5 px vertically (window frame). `center: true` applies on every window creation regardless of its previous position.

The release executable ran with the normal system PATH, without Rust/MinGW directories. A second instance exited while the first continued; concurrent native instances are not permitted. The app and local CDP were closed after testing. Keep `WebView2Loader.dll` alongside the executable when distributing without an installer.

### Remaining verification

At this stage, Microsoft device flow, refresh, entitlement checks, and skin upload were implemented, but a complete successful flow required a registered OAuth Client ID with Minecraft Services access and an account owning the game. Those credentials were not supplied, and another application's Client ID was not used. The Windows vault check was separate and did not confirm Microsoft sign-in. Subsequent OAuth updates are recorded below.

CurseForge uses its official API and stores its key in the OS credential vault. Requests, installation, and dependencies with a real key were not verified because no key was supplied. A missing download URL is handled as a distribution restriction; URLs are not guessed.

Not verified: macOS/Linux, every historical Minecraft/loader version, complete real third-party mrpack/CurseForge modpacks, large sets of conflicting mods, extended gameplay, and multiplayer. mrpack import and ZIP safety used temporary local archives. Offline skins are previews only and are not automatically applied in Vanilla.

The release has no publisher signature. Generating an NSIS package does not verify installation/removal on a clean Windows machine; that requires a separate machine. The 3D preview bundle loads when opening accounts and produces Vite's chunk-size warning above 500 kB; the main app is separated from Three.js.

### Reproduction

Main commands are in the README. Additional checks:

```powershell
./scripts/cargo.ps1 -CargoArguments @('run','-p','auren-core','--example','live_smoke','--','vanilla','latest')
./scripts/cargo.ps1 -CargoArguments @('run','-p','auren-core','--example','vault_smoke')
```

Run real smoke tests using `.test-data/live` sequentially: the standalone core example does not share the native application's instance lock. Normal Auren permits one application instance. CDP is disabled during normal launch; close the test app and local port afterward.

## Microsoft sign-in — October 14, 2026

Device Code Flow was replaced with Authorization Code and PKCE, using an automatic localhost return from the system browser. The owner's Client ID was embedded in the build; player configuration fields and manual code entry were removed. The interface shares the home pattern and displays phases, cancellation, errors, retry, and successful connection.

Checks passed: 4 OAuth tests (the independent RFC 7636 PKCE vector, state/path/ambiguous-parameter validation, a real local HTTP callback rejecting unrelated sessions, cancellation and timeout), 19 existing core tests, 9 import tests, 3 frontend tests, `cargo check --workspace`, and `clippy --workspace --all-targets -- -D warnings`. Six Playwright tests cover success with automatic account selection, denial/cancellation, a fresh retry session, browser errors, no Client ID in settings, and the full dialog at 960×680 in both themes. Screenshots: `docs/screenshots/microsoft-*.png`.

Automated checks do not confirm real Microsoft sign-in or the registered application's Minecraft Services access. Entra needs a native `http://localhost` redirect, and an owner of Minecraft Java needs to sign in. See [MICROSOFT-LOGIN.md](MICROSOFT-LOGIN.md).

## Embedded Microsoft window — October 14, 2026

Sign-in now opens in an owned WebView2 window inside Aurum. The `http://localhost` native redirect and PKCE remain. A valid response closes the window; closing it manually cancels sign-in. Launcher RPC, external windows, and downloads are blocked for this remote window. Only Microsoft identity hosts and the current-port callback are allowed.

Allowed/spoofed-address unit checks, six UI scenarios, TypeScript, `cargo check`, and Clippy passed. A real isolated Tauri/WebView2 smoke confirmed creation, focus restoration, close/cancellation, and no added accounts. Credentials were not entered; complete Microsoft/Minecraft sign-in remains a separate manual check.

## Installation on creation and instance folders — October 14, 2026

Creating an instance through the UI now immediately installs Minecraft, the selected loader, and suitable Java. The instance is saved before downloading and remains available after an error or cancellation. **Folder** works during installation. The native command first creates a missing directory and normalizes its path for File Explorer. The import menu's Modrinth logo uses `currentColor` and the active theme.

Checks passed: 21 core tests, TypeScript, Clippy, five UI creation/error/cancellation/theme scenarios, and three Modrinth import scenarios. The isolated `scripts/native-profile-creation-smoke.mjs` on real WebView2 confirmed recreating an old empty instance's folder, opening a path containing spaces and Cyrillic, automatic UI-triggered installation, opening the folder during download, and retaining the instance after cancellation without launching the game. The full download was intentionally cancelled; the existing installer was unchanged for that check.

## Public build 0.3.1 — October 14, 2026

Before publication, the current source was built into the production application and NSIS installer with `scripts/desktop.ps1 -Mode build`. Checks passed:

- TypeScript and Vite production build.
- 6 frontend Vitest tests and 26 UI Playwright scenarios.
- 50 Rust workspace tests, including 3 process-restoration scenarios with `AURUM_PROCESS_TEST_JAVA` and `--include-ignored`. Java fixtures were isolated from user instances.
- `clippy --workspace --all-targets -- -D warnings`.
- README links, exclusion of local instructions/data/build output from Git's index, and a history check for common private-key and token formats.

Release `v0.3.1` artifact: `Aurum-Launcher_x64-setup.exe`, **6,462,111 bytes** (6.16 MiB). SHA256:

```text
03c8e98dbfb29227b340c67428c91de583e2957a1db5722879d9677865e6fcf3
```

The installer and `SHA256SUMS.txt` are published in GitHub Releases, separate from the source tree. There is no publisher signature. Successful build verification does not confirm clean-Windows installation/removal or complete Microsoft/Minecraft sign-in.
